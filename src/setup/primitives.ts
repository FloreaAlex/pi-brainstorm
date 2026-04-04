import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { writeMachineConfig } from "../config.js";
import type { BrainstormConfig, MachineAgentState } from "../providers/types.js";
import { EnvironmentReport } from "./environment.js";
import { getProviders } from "../providers/registry.js";

const EXTENSION_DIR = join(homedir(), ".pi", "agent", "extensions");
const SYMLINK_PATH = join(EXTENSION_DIR, "pi-brainstorm");

export interface ProviderSelection {
	include?: boolean;
	enabled?: boolean;
}

export interface Prompter {
	ask(question: string): Promise<string>;
	pause(): void;
	resume(): void;
	close(): void;
}

export function createPrompter(): Prompter {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	return {
		ask: (question) =>
			new Promise((resolve) => {
				rl.question(question, (answer) => resolve(answer.trim()));
			}),
		pause: () => rl.pause(),
		resume: () => rl.resume(),
		close: () => rl.close(),
	};
}

export function ensureExtensionSymlink(packageRoot: string): void {
	if (existsSync(SYMLINK_PATH)) {
		const stat = lstatSync(SYMLINK_PATH);
		if (stat.isSymbolicLink()) {
			const target = resolve(dirname(SYMLINK_PATH), readlinkSync(SYMLINK_PATH));
			if (target === packageRoot) {
				return;
			}
			unlinkSync(SYMLINK_PATH);
		} else {
			throw new Error("Cannot create symlink \u2014 path exists and is not a symlink");
		}
	}

	mkdirSync(EXTENSION_DIR, { recursive: true });
	symlinkSync(packageRoot, SYMLINK_PATH);
}

export async function promptPermissionPolicy(prompter?: Prompter): Promise<"full" | "restricted"> {
	const isInteractive = process.stdin.isTTY;
	if (isInteractive) {
		const p = prompter ?? createPrompter();
		const answer = await p.ask("Permission policy: full access for all agents [Y/n] ");
		if (!prompter) p.close();
		if (answer.toLowerCase() === "n" || answer.toLowerCase() === "no") {
			return "restricted";
		}
	}
	return "full";
}

export function buildMachineConfig(
	report: EnvironmentReport,
	policy: "full" | "restricted",
	selections?: Record<string, ProviderSelection>,
): BrainstormConfig {
	const agents: Record<string, MachineAgentState> = {};

	for (const provider of getProviders()) {
		const providerState = report.providers[provider.name];
		if (!providerState.supported) continue;
		if (!providerState.installed || !providerState.resolved) continue;
		if (selections?.[provider.name]?.include === false) continue;

		agents[provider.name] = {
			enabled: selections?.[provider.name]?.enabled ?? providerState.authenticated,
			command: providerState.resolved.path,
			commandSource: providerState.resolved.source,
			auth: {
				ok: providerState.authenticated,
				checkedAt: new Date().toISOString(),
				error: providerState.authError,
			},
		};
	}

	return {
		version: 1,
		permissions: { defaultPolicy: policy },
		agents,
	};
}
