import { join } from "node:path";
import { homedir } from "node:os";
import { writeMachineConfig } from "../config.js";
import { getProviders } from "../providers/registry.js";
import { PACKAGE_ROOT, scanEnvironment } from "./environment.js";
import {
	createPrompter,
	ensureExtensionSymlink,
	promptPermissionPolicy,
	buildMachineConfig,
	type ProviderSelection,
} from "./primitives.js";
import { determineActions, promptAndInstall, runAuth, runInstall, type ProvisionResult } from "../installer/index.js";
import { findOnPath } from "../providers/resolve.js";
import type { CliDependency } from "../providers/types.js";

function log(msg: string): void {
	console.log(msg);
}

export function buildSelectionsFromProvisionResults(
	report: Awaited<ReturnType<typeof scanEnvironment>>,
	results: ProvisionResult[],
): Record<string, ProviderSelection> {
	const selections: Record<string, ProviderSelection> = {};

	for (const result of results) {
		if (result.action !== "skipped" && result.action !== "failed") {
			continue;
		}

		const providerState = report.providers[result.provider];
		if (!providerState?.installed || !providerState.resolved) {
			selections[result.provider] = { include: false };
		}
	}

	return selections;
}

export async function runWizard(): Promise<void> {
	log("");
	log("pi-brainstorm wizard");
	log("====================");
	log("");

	// Phase 1: initial scan
	log("Scanning environment...");
	let report = await scanEnvironment({ packageRoot: PACKAGE_ROOT });
	log("");

	// Phase 2: prerequisite summary
	log("Prerequisites:");
	for (const [name, check] of Object.entries(report.prerequisites)) {
		const icon = check.ok ? "\u2713" : "\u2717";
		log(`  ${icon} ${name} ${check.version ?? (check.ok ? "available" : "not found")}`);
	}

	log("");
	log("Extension:");
	if (report.extension.symlinked && report.extension.targetOk) {
		log(`  \u2713 Symlinked at ${report.extension.symlinkPath}`);
	} else {
		log(`  \u2717 Not symlinked (will be set up later)`);
	}

	log("");
	log("Config:");
	log(`  Machine: ${report.configs.machineConfigExists ? "\u2713 exists" : "\u2717 not found (will be created)"}`);
	log(`  Project: ${report.configs.projectConfigExists ? "\u2713 exists" : "- not found (optional)"}`);
	log("");

	if (!report.prerequisites.pi.ok) {
		log("\u2717 Pi is not installed.");
		log("  Install Pi first: npm install -g @mariozechner/pi-coding-agent");
		log("  Then re-run: npm run wizard");
		process.exit(1);
	}

	// Phase 3: install CLI tools globally (claude, codex)
	const missingClis: Array<{ provider: string; dep: CliDependency }> = [];
	for (const provider of getProviders()) {
		if (!provider.supportedPlatforms().includes(process.platform)) continue;
		const dep = provider.getCliDependency();
		if (!dep) continue;
		if (findOnPath(dep.command)) continue;
		missingClis.push({ provider: provider.name, dep });
	}

	const prompter = createPrompter();
	let installResults: ProvisionResult[] = [];

	try {
		if (missingClis.length > 0) {
			log("CLI tools:");
			for (const { dep } of missingClis) {
				const answer = await prompter.ask(`  Install ${dep.label}? (${dep.installSpec.summary}) [Y/n] `);
				if (answer.toLowerCase() === "n" || answer.toLowerCase() === "no") {
					log(`  - ${dep.label} skipped`);
					continue;
				}
				log(`  Installing ${dep.label} globally...`);
				const result = runInstall(dep.installSpec);
				if (result.ok) {
					log(`  \u2713 ${dep.label} installed`);
				} else {
					log(`  \u2717 ${dep.label} failed: ${result.error}`);
				}
			}
			log("");
		}

		// Phase 4: install ACP bridges globally
		const actions = determineActions(report);

		if (actions.ready.length > 0) {
			log("Ready:");
			for (const { label } of actions.ready) {
				log(`  \u2713 ${label} (installed and authenticated)`);
			}
			log("");
		}

		if (actions.unsupported.length > 0) {
			log("Unsupported on this platform:");
			for (const { label } of actions.unsupported) {
				log(`  - ${label}`);
			}
			log("");
		}

		if (actions.manual.length > 0) {
			log("Requires manual installation:");
			for (const { label, summary } of actions.manual) {
				log(`  - ${label}: ${summary}`);
			}
			log("");
		}

		if (actions.install.length > 0) {
			log("ACP bridges:");
			installResults = await promptAndInstall(actions.install, prompter, log);
			log("");
		}

		// Phase 5: interactive auth
		if (installResults.some((r) => r.action === "installed")) {
			log("Re-scanning after installations...");
			report = await scanEnvironment({ packageRoot: PACKAGE_ROOT });
			const freshActions = determineActions(report);
			if (freshActions.auth.length > 0) {
				const authResults = runAuth(freshActions.auth, prompter, log);
				installResults.push(...authResults);
				log("");
			}
		} else if (actions.auth.length > 0) {
			log("Authentication needed:");
			for (const { label, loginCommand } of actions.auth) {
				log(`  - ${label}: ${loginCommand}`);
			}
			log("");
			const authResults = runAuth(actions.auth, prompter, log);
			installResults.push(...authResults);
			log("");
		}

		// Phase 6: extension and machine config
		log("Setting up extension...");
		try {
			ensureExtensionSymlink(PACKAGE_ROOT);
			log(`  \u2713 Symlinked`);
		} catch (e) {
			log(`  \u2717 ${e instanceof Error ? e.message : String(e)}`);
			throw e;
		}
		log("");

		const policy = await promptPermissionPolicy(prompter);

		// Phase 7: final verification
		log("");
		log("Final verification...");
		report = await scanEnvironment({ packageRoot: PACKAGE_ROOT });

		const selections = buildSelectionsFromProvisionResults(report, installResults);
		const config = buildMachineConfig(report, policy, selections);

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

		log("");
		log("Summary:");

		if (installResults.length > 0) {
			for (const r of installResults) {
				const icon = (r.action === "installed" || r.action === "authenticated") ? "\u2713" : r.action === "skipped" ? "-" : "\u2717";
				log(`  ${icon} ${r.provider}: ${r.action}${r.error ? ` (${r.error})` : ""}`);
			}
		}

		log(`  Enabled: ${enabledNames || "none"} (${enabledCount} of ${totalCount} agents)`);
		log("");
		log("Next: start pi in any project and run /brainstorm");
	} finally {
		prompter.close();
	}
}
