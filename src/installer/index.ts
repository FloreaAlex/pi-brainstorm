import { spawnSync } from "node:child_process";
import type { ProviderAuthCommand, ProviderInstallSpec } from "../providers/types.js";
import type { Prompter } from "../setup/primitives.js";
import type { EnvironmentReport } from "../setup/environment.js";
import { getProviders } from "../providers/registry.js";

export interface ProvisionResult {
	provider: string;
	action: "installed" | "skipped" | "failed" | "already_present" | "authenticated";
	error?: string;
}

export interface ProviderSelections {
	install: string[];
	auth: string[];
}

export function determineActions(report: EnvironmentReport): {
	install: Array<{ name: string; label: string; spec: ProviderInstallSpec }>;
	auth: Array<{ name: string; label: string; loginCommand: string; authCommand: ProviderAuthCommand }>;
	ready: Array<{ name: string; label: string }>;
	unsupported: Array<{ name: string; label: string }>;
	manual: Array<{ name: string; label: string; summary: string }>;
} {
	const install: Array<{ name: string; label: string; spec: ProviderInstallSpec }> = [];
	const auth: Array<{ name: string; label: string; loginCommand: string; authCommand: ProviderAuthCommand }> = [];
	const ready: Array<{ name: string; label: string }> = [];
	const unsupported: Array<{ name: string; label: string }> = [];
	const manual: Array<{ name: string; label: string; summary: string }> = [];

	for (const provider of getProviders()) {
		const state = report.providers[provider.name];

		if (!state.supported) {
			unsupported.push({ name: provider.name, label: provider.label });
			continue;
		}

		if (state.installed && state.authenticated) {
			ready.push({ name: provider.name, label: provider.label });
			continue;
		}

		if (state.installed && !state.authenticated) {
			if (!state.resolved) {
				manual.push({
					name: provider.name,
					label: provider.label,
					summary: "Installed state is missing a resolved command",
				});
				continue;
			}

			auth.push({
				name: provider.name,
				label: provider.label,
				authCommand: provider.getAuthCommand(state.resolved.path),
				loginCommand: state.loginCommand ?? "Authenticate manually",
			});
			continue;
		}

		// Not installed
		if (state.installSpec?.autoInstallable && state.installSpec.command) {
			install.push({
				name: provider.name,
				label: provider.label,
				spec: state.installSpec,
			});
		} else {
			manual.push({
				name: provider.name,
				label: provider.label,
				summary: state.installSpec?.summary ?? "Manual installation required",
			});
		}
	}

	return { install, auth, ready, unsupported, manual };
}

export function runInstall(spec: ProviderInstallSpec): { ok: boolean; error?: string } {
	if (!spec.command || !spec.args) {
		return { ok: false, error: "No install command available" };
	}

	const result = spawnSync(spec.command, spec.args, {
		stdio: "inherit",
		timeout: 300_000,
	});

	if (result.status !== 0) {
		const msg = result.error?.message ?? `Exit code ${result.status}`;
		return { ok: false, error: msg };
	}

	return { ok: true };
}

export async function promptAndInstall(
	providers: Array<{ name: string; label: string; spec: ProviderInstallSpec }>,
	prompter: Prompter,
	log: (msg: string) => void,
): Promise<ProvisionResult[]> {
	const results: ProvisionResult[] = [];

	for (const { name, label, spec } of providers) {
		const answer = await prompter.ask(`  Install ${label}? (${spec.summary}) [Y/n] `);
		if (answer.toLowerCase() === "n" || answer.toLowerCase() === "no") {
			results.push({ provider: name, action: "skipped" });
			continue;
		}

		log(`  Installing ${label}...`);
		const outcome = runInstall(spec);

		if (outcome.ok) {
			log(`  \u2713 ${label} installed`);
			results.push({ provider: name, action: "installed" });
		} else {
			log(`  \u2717 ${label} install failed: ${outcome.error}`);
			const retry = await prompter.ask(`  Retry? [y/N] `);
			if (retry.toLowerCase() === "y" || retry.toLowerCase() === "yes") {
				log(`  Retrying ${label}...`);
				const retryOutcome = runInstall(spec);
				if (retryOutcome.ok) {
					log(`  \u2713 ${label} installed`);
					results.push({ provider: name, action: "installed" });
				} else {
					log(`  \u2717 ${label} retry failed: ${retryOutcome.error}`);
					results.push({ provider: name, action: "failed", error: retryOutcome.error });
				}
			} else {
				results.push({ provider: name, action: "failed", error: outcome.error });
			}
		}
	}

	return results;
}

export function runAuth(
	providers: Array<{ name: string; label: string; loginCommand: string; authCommand: ProviderAuthCommand }>,
	prompter: Prompter,
	log: (msg: string) => void,
): ProvisionResult[] {
	const results: ProvisionResult[] = [];
	for (const { name, label, loginCommand, authCommand } of providers) {
		log(`\n  Authenticating ${label}...`);
		log(`  Running: ${loginCommand}`);

		prompter.pause();
		try {
			const outcome = spawnSync(authCommand.command, authCommand.args, {
				stdio: "inherit",
				env: authCommand.env ? { ...process.env, ...authCommand.env } : process.env,
				timeout: 120_000,
			});
			if (outcome.status !== 0) {
				const msg = outcome.error?.message ?? `Exit code ${outcome.status}`;
				log(`  \u2717 ${label} auth failed: ${msg}`);
				results.push({ provider: name, action: "failed", error: msg });
			} else {
				log(`  \u2713 ${label} authenticated`);
				results.push({ provider: name, action: "authenticated" });
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			log(`  \u2717 ${label} auth failed: ${msg}`);
			results.push({ provider: name, action: "failed", error: msg });
		} finally {
			prompter.resume();
		}
	}
	return results;
}
