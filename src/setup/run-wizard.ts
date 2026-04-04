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
import { determineActions, promptAndInstall, runAuth, type ProvisionResult } from "../installer/index.js";

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
		log(`  \u2717 Not symlinked (will be created in Phase 5)`);
	}

	log("");
	log("Config:");
	log(`  Machine: ${report.configs.machineConfigExists ? "\u2713 exists" : "\u2717 not found (will be created)"}`);
	log(`  Project: ${report.configs.projectConfigExists ? "\u2713 exists" : "- not found (optional)"}`);
	log("");

	if (!report.prerequisites.pi.ok) {
		log("\u2717 Pi is not installed.");
		log("  Install Pi first: https://github.com/mariozechner/pi-mono");
		log("  Then re-run: npm run wizard");
		process.exit(1);
	}

	// Phase 3: provider install selection
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

	const prompter = createPrompter();
	let installResults: ProvisionResult[] = [];

	try {
		if (actions.install.length > 0) {
			log("Available for installation:");
			installResults = await promptAndInstall(actions.install, prompter, log);
			log("");
		}

		// Phase 4: interactive auth
		// After installs, re-scan to pick up newly installed providers that need auth
		if (installResults.some((r) => r.action === "installed")) {
			log("Re-scanning after installations...");
			report = await scanEnvironment({ packageRoot: PACKAGE_ROOT });
			// Recalculate auth needs based on fresh scan
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

		// Phase 5: extension and machine config
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

		// Phase 6: final verification — re-scan from live state
		log("");
		log("Final verification...");
		report = await scanEnvironment({ packageRoot: PACKAGE_ROOT });

		// Build selections from live state, not from attempted actions alone.
		// Failed auth should keep an installed provider in config as disabled,
		// while skipped/failed installs should be omitted entirely.
		const selections = buildSelectionsFromProvisionResults(report, installResults);

		const config = buildMachineConfig(report, policy, selections);

		// Show policy per enabled agent
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
