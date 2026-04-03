import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadMachineConfig, loadProjectConfig, mergeConfigs } from "../config.js";
import { getProviders } from "../providers/registry.js";
import type { BrainstormConfig } from "../providers/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "..", "..");
const SYMLINK_PATH = join(homedir(), ".pi", "agent", "extensions", "pi-brainstorm");

const MACHINE_CONFIG_PATH = join(homedir(), ".pi", "brainstorm", "config.json");

export interface DoctorCheck {
	name: string;
	status: "ok" | "warn" | "fail";
	message: string;
	detail?: string;
}

export interface DoctorResult {
	ok: boolean;
	checks: DoctorCheck[];
}

/**
 * Run diagnostics to validate the live environment.
 * Re-checks everything from scratch (does not rely on cached config).
 */
export async function runDoctor(options?: { json?: boolean; cwd?: string }): Promise<DoctorResult> {
	const cwd = options?.cwd ?? process.cwd();
	const checks: DoctorCheck[] = [];

	// 1. Pi version
	checks.push(checkPiVersion());

	// 2. Extension symlink
	checks.push(checkSymlink());

	// 3. Machine config
	const machineConfig = loadMachineConfig();
	checks.push(checkMachineConfig(machineConfig));

	// 4. Project config
	const projectConfig = loadProjectConfig(cwd);
	checks.push(checkProjectConfig(projectConfig, cwd));

	// 5. Each provider
	const mergedConfig = machineConfig ? mergeConfigs(machineConfig, projectConfig) : null;
	const providerChecks = await checkProviders(mergedConfig);
	checks.push(...providerChecks);

	const result: DoctorResult = {
		ok: checks.every((c) => c.status !== "fail"),
		checks,
	};

	if (options?.json) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		printHumanReadable(result);
	}

	return result;
}

function checkPiVersion(): DoctorCheck {
	try {
		const version = execFileSync("pi", ["--version"], { encoding: "utf-8", timeout: 10_000 }).trim();
		return { name: "pi", status: "ok", message: `Pi ${version}` };
	} catch {
		return { name: "pi", status: "fail", message: "Pi not found", detail: "'pi --version' failed or pi is not in PATH" };
	}
}

function checkSymlink(): DoctorCheck {
	if (!existsSync(SYMLINK_PATH)) {
		return {
			name: "symlink",
			status: "fail",
			message: "Extension not symlinked",
			detail: `Expected symlink at ${SYMLINK_PATH}`,
		};
	}

	try {
		const stat = lstatSync(SYMLINK_PATH);
		if (!stat.isSymbolicLink()) {
			return {
				name: "symlink",
				status: "warn",
				message: "Extension path exists but is not a symlink",
				detail: `${SYMLINK_PATH} is not a symbolic link`,
			};
		}

		const target = resolve(dirname(SYMLINK_PATH), readlinkSync(SYMLINK_PATH));
		const normalizedTarget = resolve(target);
		const normalizedRoot = resolve(PACKAGE_ROOT);

		if (normalizedTarget !== normalizedRoot) {
			return {
				name: "symlink",
				status: "warn",
				message: `Symlink points to ${normalizedTarget}`,
				detail: `Expected ${normalizedRoot}, got ${normalizedTarget}`,
			};
		}

		return { name: "symlink", status: "ok", message: "pi-brainstorm (symlinked)" };
	} catch (err) {
		return {
			name: "symlink",
			status: "fail",
			message: "Failed to read symlink",
			detail: err instanceof Error ? err.message : String(err),
		};
	}
}

function checkMachineConfig(config: BrainstormConfig | null): DoctorCheck {
	if (!config) {
		return {
			name: "machine-config",
			status: "fail",
			message: "Machine config not found",
			detail: `Expected at ${MACHINE_CONFIG_PATH}. Run npm run setup to create it.`,
		};
	}
	return {
		name: "machine-config",
		status: "ok",
		message: `Machine config: ${MACHINE_CONFIG_PATH}`,
	};
}

function checkProjectConfig(config: Partial<BrainstormConfig> | null, cwd: string): DoctorCheck {
	const path = join(cwd, "brainstorm.config.json");
	if (!config) {
		return {
			name: "project-config",
			status: "ok",
			message: "Project config: not found (optional)",
			detail: `No brainstorm.config.json at ${path}`,
		};
	}
	return {
		name: "project-config",
		status: "ok",
		message: `Project config: ${path}`,
	};
}

async function checkProviders(mergedConfig: BrainstormConfig | null): Promise<DoctorCheck[]> {
	const checks: DoctorCheck[] = [];
	const platform = process.platform;
	const providers = getProviders();

	for (const provider of providers) {
		// Skip unsupported platforms
		if (!provider.supportedPlatforms().includes(platform)) {
			checks.push({
				name: `provider:${provider.name}`,
				status: "ok",
				message: `${provider.label}  unsupported on ${platform}`,
			});
			continue;
		}

		// Resolve command live (not from cached config)
		const resolved = await provider.resolveCommand();
		if (!resolved) {
			checks.push({
				name: `provider:${provider.name}`,
				status: "fail",
				message: `${provider.label}  not found`,
				detail: provider.installInstructions(platform),
			});
			continue;
		}

		// Run auth check live
		let authStatus: string;
		let authOk = false;
		let authDetail: string | undefined;
		try {
			const authResult = await provider.checkAuth(resolved.path);
			authOk = authResult.ok;
			authStatus = authResult.ok ? "authenticated" : "auth failed";
			if (!authResult.ok && authResult.error) {
				authDetail = authResult.error;
			}
		} catch (err) {
			authStatus = "BROKEN STARTUP";
			authDetail = err instanceof Error ? err.message : String(err);
		}

		// Determine enabled/disabled from merged config
		const agentState = mergedConfig?.agents?.[provider.name];
		const enabled = agentState?.enabled ?? false;
		const enabledStr = enabled ? "enabled" : "disabled";

		// Get permission info
		const policy = mergedConfig?.permissions?.defaultPolicy ?? "full";
		const perms = provider.describePermissions(policy);
		const permNote = perms.notes[0] ?? "";
		const policyStr = `${policy} via ${permNote}`;

		const status = authOk ? "ok" as const : "fail" as const;
		const parts = [
			padRight(provider.label, 10),
			padRight(resolved.path, 40),
			padRight(authStatus, 16),
			padRight(enabledStr, 10),
		];

		if (authOk) {
			parts.push(policyStr);
		} else {
			parts.push("\u2192 check runtime / version");
		}

		checks.push({
			name: `provider:${provider.name}`,
			status,
			message: parts.join(" ").trimEnd(),
			detail: authDetail,
		});
	}

	return checks;
}

function padRight(str: string, width: number): string {
	if (str.length >= width) return str;
	return str + " ".repeat(width - str.length);
}

function printHumanReadable(result: DoctorResult): void {
	const lines: string[] = [];

	lines.push("");
	lines.push("pi-brainstorm doctor");
	lines.push("====================");
	lines.push("");

	const providerChecks: DoctorCheck[] = [];
	const generalChecks: DoctorCheck[] = [];

	for (const check of result.checks) {
		if (check.name.startsWith("provider:")) {
			providerChecks.push(check);
		} else {
			generalChecks.push(check);
		}
	}

	// General checks
	for (const check of generalChecks) {
		lines.push(formatCheck(check));
	}

	// Provider checks
	if (providerChecks.length > 0) {
		lines.push("");
		lines.push("Agents:");
		for (const check of providerChecks) {
			lines.push(formatCheck(check));
		}
	}

	// Summary
	const failCount = result.checks.filter((c) => c.status === "fail").length;
	const warnCount = result.checks.filter((c) => c.status === "warn").length;

	lines.push("");
	if (failCount === 0 && warnCount === 0) {
		lines.push("All checks passed.");
	} else {
		const issues: string[] = [];
		if (failCount > 0) {
			issues.push(`${failCount} issue${failCount !== 1 ? "s" : ""}`);
		}
		if (warnCount > 0) {
			issues.push(`${warnCount} warning${warnCount !== 1 ? "s" : ""}`);
		}
		lines.push(`${issues.join(", ")}. Run npm run setup to fix.`);
	}

	lines.push("");
	console.log(lines.join("\n"));
}

function formatCheck(check: DoctorCheck): string {
	const icon = check.status === "ok" ? " \u2713" : check.status === "warn" ? " !" : " \u2717";
	return `${icon} ${check.message}`;
}
