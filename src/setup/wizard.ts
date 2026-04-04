import { join } from "node:path";
import { homedir } from "node:os";
import { getProviders } from "../providers/registry.js";
import { writeMachineConfig } from "../config.js";
import { PACKAGE_ROOT, scanEnvironment } from "./environment.js";
import { ensureExtensionSymlink, promptPermissionPolicy, buildMachineConfig } from "./primitives.js";

function log(msg: string): void {
	console.log(msg);
}

function ok(msg: string): void {
	console.log(`  \u2713 ${msg}`);
}

function fail(msg: string): void {
	console.log(`  \u2717 ${msg}`);
}

export async function runSetup(): Promise<void> {
	log("");
	log("pi-brainstorm setup");
	log("===================");
	log("");

	const report = await scanEnvironment({ packageRoot: PACKAGE_ROOT });

	log("Checking Pi...");
	if (!report.prerequisites.pi.ok) {
		fail("Pi is not installed.");
		log("  Install Pi first: https://github.com/mariozechner/pi-mono");
		throw new Error("Pi is not installed");
	}
	ok(`Pi ${report.prerequisites.pi.version ?? "available"}`);
	log("");

	log("Symlinking extension...");
	try {
		ensureExtensionSymlink(PACKAGE_ROOT);
		ok(`Symlink ensured`);
	} catch (e) {
		fail(e instanceof Error ? e.message : String(e));
		throw e;
	}
	log("");

	log("Detecting agents...");
	log("");

	for (const provider of getProviders()) {
		const providerState = report.providers[provider.name];
		if (!providerState.supported) {
			log(`  ${provider.label} (${provider.name})`);
			log(`    Platform: \u2717 unsupported on ${process.platform}`);
			log("");
			continue;
		}

		log(`  ${provider.label} (${provider.name})`);

		if (!providerState.installed || !providerState.resolved) {
			log(`    Installed: \u2717 not found`);
			log(`    Install:   ${providerState.installSpec?.summary ?? "Manual installation required"}`);
			log("");
			continue;
		}

		log(`    Installed: \u2713 ${providerState.resolved.path} (${providerState.resolved.source})`);

		if (providerState.authenticated) {
			log(`    Auth:      \u2713 Ready`);
		} else {
			log(`    Auth:      \u2717 ${providerState.authError ?? "Failed"}`);
			log(`    Fix:       ${providerState.loginCommand ?? "Authenticate manually"}`);
		}
		log("");
	}

	const policy = await promptPermissionPolicy();

	// Show policy notes per enabled agent
	const config = buildMachineConfig(report, policy);
	for (const provider of getProviders()) {
		const agentState = config.agents[provider.name];
		if (!agentState?.enabled) continue;
		const perms = provider.describePermissions(policy);
		log(`  ${provider.label}: ${policy} \u2192 ${perms.notes[0]}`);
	}

	log("");

	writeMachineConfig(undefined, config);
	const configPath = join(homedir(), ".pi", "brainstorm", "config.json");
	log(`Config written to ${configPath}`);

	const enabledCount = Object.values(config.agents).filter((a) => a.enabled).length;
	const totalCount = getProviders().length;
	const enabledNames = Object.entries(config.agents)
		.filter(([, a]) => a.enabled)
		.map(([n]) => n)
		.join(", ");

	log(`Enabled: ${enabledNames || "none"} (${enabledCount} of ${totalCount} agents ready)`);
	log("");
	log("Next: start pi in any project and run /brainstorm");
}
