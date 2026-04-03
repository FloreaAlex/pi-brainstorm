import { execSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { getProviders } from "../providers/registry.js";
import { writeMachineConfig } from "../config.js";
import type { BrainstormConfig, MachineAgentState } from "../providers/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "..", "..");
const EXTENSION_DIR = join(homedir(), ".pi", "agent", "extensions");
const SYMLINK_PATH = join(EXTENSION_DIR, "pi-brainstorm");

function log(msg: string): void {
	console.log(msg);
}

function ok(msg: string): void {
	console.log(`  \u2713 ${msg}`);
}

function fail(msg: string): void {
	console.log(`  \u2717 ${msg}`);
}

async function prompt(question: string): Promise<string> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer.trim());
		});
	});
}

function checkPi(): string | null {
	try {
		const version = execSync("pi --version 2>&1", { encoding: "utf-8" }).trim();
		return version || null;
	} catch {
		return null;
	}
}

function ensureSymlink(): void {
	if (existsSync(SYMLINK_PATH)) {
		const stat = lstatSync(SYMLINK_PATH);
		if (stat.isSymbolicLink()) {
			const target = resolve(dirname(SYMLINK_PATH), readlinkSync(SYMLINK_PATH));
			if (target === PACKAGE_ROOT) {
				ok(`Symlink exists: ${SYMLINK_PATH} \u2192 ${PACKAGE_ROOT}`);
				return;
			}
			// Points elsewhere -- remove and recreate
			log(`  Symlink points to ${target}, updating...`);
			unlinkSync(SYMLINK_PATH);
		} else {
			// Not a symlink (regular file or directory)
			fail(`${SYMLINK_PATH} exists but is not a symlink. Remove it manually.`);
			process.exit(1);
		}
	}

	// Create parent directory and symlink
	mkdirSync(EXTENSION_DIR, { recursive: true });
	symlinkSync(PACKAGE_ROOT, SYMLINK_PATH);
	ok(`Symlinked: ${SYMLINK_PATH} \u2192 ${PACKAGE_ROOT}`);
}

export async function runSetup(): Promise<void> {
	log("");
	log("pi-brainstorm setup");
	log("===================");
	log("");

	// 1. Check Pi
	log("Checking Pi...");
	const piVersion = checkPi();
	if (!piVersion) {
		fail("Pi is not installed.");
		log("  Install Pi first: https://github.com/mariozechner/pi-mono");
		process.exit(1);
	}
	ok(`Pi ${piVersion}`);
	log("");

	// 2. Symlink extension
	log("Symlinking extension...");
	ensureSymlink();
	log("");

	// 3. Detect providers
	log("Detecting agents...");
	log("");

	const agents: Record<string, MachineAgentState> = {};

	for (const provider of getProviders()) {
		const platforms = provider.supportedPlatforms();
		if (!platforms.includes(process.platform as NodeJS.Platform)) {
			log(`  ${provider.label} (${provider.name})`);
			log(`    Platform: \u2717 unsupported on ${process.platform}`);
			log("");
			continue;
		}

		log(`  ${provider.label} (${provider.name})`);

		// Resolve command
		const resolved = await provider.resolveCommand();
		if (!resolved) {
			log(`    Installed: \u2717 not found`);
			log(`    Install:   ${provider.installInstructions(process.platform as NodeJS.Platform)}`);
			log("");
			continue;
		}

		log(`    Installed: \u2713 ${resolved.path} (${resolved.source})`);

		// Auth smoke test
		const auth = await provider.checkAuth(resolved.path);
		if (auth.ok) {
			log(`    Auth:      \u2713 Ready`);
		} else {
			log(`    Auth:      \u2717 ${auth.error ?? "Failed"}`);
			log(`    Fix:       ${auth.loginCommand}`);
		}

		agents[provider.name] = {
			enabled: auth.ok,
			command: resolved.path,
			commandSource: resolved.source,
			auth: {
				ok: auth.ok,
				checkedAt: auth.checkedAt,
				error: auth.error,
			},
		};

		log("");
	}

	// 4. Permission policy
	const isInteractive = process.stdin.isTTY;
	let policy: "full" | "restricted" = "full";

	if (isInteractive) {
		const answer = await prompt("Permission policy: full access for all agents [Y/n] ");
		if (answer.toLowerCase() === "n" || answer.toLowerCase() === "no") {
			policy = "restricted";
		}
	}

	// Show policy notes per enabled agent
	for (const provider of getProviders()) {
		const agentState = agents[provider.name];
		if (!agentState?.enabled) continue;
		const perms = provider.describePermissions(policy);
		log(`  ${provider.label}: ${policy} \u2192 ${perms.notes[0]}`);
	}

	log("");

	// 5. Write config
	const config: BrainstormConfig = {
		version: 1,
		permissions: { defaultPolicy: policy },
		agents,
	};

	writeMachineConfig(undefined, config);
	const configPath = join(homedir(), ".pi", "brainstorm", "config.json");
	log(`Config written to ${configPath}`);

	const enabledCount = Object.values(agents).filter((a) => a.enabled).length;
	const totalCount = getProviders().length;
	const enabledNames = Object.entries(agents)
		.filter(([, a]) => a.enabled)
		.map(([n]) => n)
		.join(", ");

	log(`Enabled: ${enabledNames || "none"} (${enabledCount} of ${totalCount} agents ready)`);
	log("");
	log("Next: start pi in any project and run /brainstorm");
}
