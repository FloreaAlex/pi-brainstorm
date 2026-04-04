import { loadMachineConfig, loadProjectConfig, mergeConfigs } from "../config.js";
import { getProviders } from "../providers/registry.js";
import type { BrainstormConfig } from "../providers/types.js";
import { MACHINE_CONFIG_PATH, scanEnvironment, type EnvironmentReport } from "./environment.js";

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

export async function runDoctor(options?: { json?: boolean; cwd?: string }): Promise<DoctorResult> {
	const cwd = options?.cwd ?? process.cwd();
	const report = await scanEnvironment({ cwd });
	const checks: DoctorCheck[] = [];

	checks.push(checkPrerequisite("node", report.prerequisites.node));
	checks.push(checkPrerequisite("npm", report.prerequisites.npm));
	checks.push(checkPrerequisite("git", report.prerequisites.git));
	checks.push(checkPrerequisite("pi", report.prerequisites.pi));
	checks.push(checkSymlink(report));
	checks.push(checkMachineConfig(report));
	checks.push(checkProjectConfig(report));

	const machineConfig = loadMachineConfig();
	const projectConfig = loadProjectConfig(cwd);
	const mergedConfig = machineConfig ? mergeConfigs(machineConfig, projectConfig) : null;
	checks.push(...checkProviders(report, mergedConfig));

	const result: DoctorResult = {
		ok: checks.every((check) => check.status !== "fail"),
		checks,
	};

	if (options?.json) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		printHumanReadable(result);
	}

	return result;
}

function checkPrerequisite(
	name: string,
	check: { ok: boolean; version?: string },
): DoctorCheck {
	if (!check.ok) {
		return {
			name,
			status: "fail",
			message: `${name} not found`,
		};
	}

	return {
		name,
		status: "ok",
		message: `${name} ${check.version ?? "available"}`,
	};
}

function checkSymlink(report: EnvironmentReport): DoctorCheck {
	if (!report.extension.symlinked) {
		return {
			name: "symlink",
			status: "fail",
			message: "Extension not symlinked",
			detail: `Expected symlink at ${report.extension.symlinkPath}`,
		};
	}

	if (!report.extension.targetOk) {
		return {
			name: "symlink",
			status: "warn",
			message: `Symlink points to ${report.extension.target ?? "unknown target"}`,
			detail: `Expected current package root at ${report.extension.symlinkPath}`,
		};
	}

	return {
		name: "symlink",
		status: "ok",
		message: "pi-brainstorm (symlinked)",
	};
}

function checkMachineConfig(report: EnvironmentReport): DoctorCheck {
	if (!report.configs.machineConfigExists) {
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
		message: `Machine config: ${report.configs.machineConfigPath}`,
	};
}

function checkProjectConfig(report: EnvironmentReport): DoctorCheck {
	if (!report.configs.projectConfigExists) {
		return {
			name: "project-config",
			status: "ok",
			message: "Project config: not found (optional)",
			detail: `No brainstorm.config.json at ${report.configs.projectConfigPath}`,
		};
	}

	return {
		name: "project-config",
		status: "ok",
		message: `Project config: ${report.configs.projectConfigPath}`,
	};
}

function checkProviders(
	report: EnvironmentReport,
	mergedConfig: BrainstormConfig | null,
): DoctorCheck[] {
	const checks: DoctorCheck[] = [];
	const policy = mergedConfig?.permissions?.defaultPolicy ?? "full";

	for (const provider of getProviders()) {
		const providerState = report.providers[provider.name];

		if (!providerState.supported) {
			checks.push({
				name: `provider:${provider.name}`,
				status: "ok",
				message: `${provider.label} unsupported on ${process.platform}`,
			});
			continue;
		}

		if (!providerState.installed || !providerState.resolved) {
			checks.push({
				name: `provider:${provider.name}`,
				status: "fail",
				message: `${provider.label} not found`,
				detail: providerState.installSpec?.summary,
			});
			continue;
		}

		const agentState = mergedConfig?.agents?.[provider.name];
		const enabled = agentState?.enabled ?? false;
		const perms = provider.describePermissions(policy);
		const permNote = perms.notes[0] ?? "";
		const authStatus = providerState.authenticated ? "authenticated" : "auth failed";
		const enabledStatus = enabled ? "enabled" : "disabled";
		const detail = providerState.authenticated
			? undefined
			: [providerState.authError, providerState.loginCommand && `Run ${providerState.loginCommand}`]
				.filter(Boolean)
				.join("; ");

		checks.push({
			name: `provider:${provider.name}`,
			status: providerState.authenticated ? "ok" : "fail",
			message: [
				padRight(provider.label, 10),
				padRight(providerState.resolved.path, 40),
				padRight(authStatus, 16),
				padRight(enabledStatus, 10),
				providerState.authenticated ? `${policy} via ${permNote}` : "-> authenticate",
			].join(" ").trimEnd(),
			detail: detail || undefined,
		});
	}

	return checks;
}

function padRight(value: string, width: number): string {
	if (value.length >= width) {
		return value;
	}

	return value + " ".repeat(width - value.length);
}

function printHumanReadable(result: DoctorResult): void {
	const lines: string[] = [];

	lines.push("");
	lines.push("pi-brainstorm doctor");
	lines.push("====================");
	lines.push("");

	const providerChecks = result.checks.filter((check) => check.name.startsWith("provider:"));
	const generalChecks = result.checks.filter((check) => !check.name.startsWith("provider:"));

	for (const check of generalChecks) {
		lines.push(formatCheck(check));
	}

	if (providerChecks.length > 0) {
		lines.push("");
		lines.push("Agents:");
		for (const check of providerChecks) {
			lines.push(formatCheck(check));
		}
	}

	const failCount = result.checks.filter((check) => check.status === "fail").length;
	const warnCount = result.checks.filter((check) => check.status === "warn").length;

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
	const icon = check.status === "ok" ? " ✓" : check.status === "warn" ? " !" : " ✗";
	return `${icon} ${check.message}`;
}
