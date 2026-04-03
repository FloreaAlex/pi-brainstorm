import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentUserConfig, AuthResult, Provider, ProviderPermissions, ResolvedCommand, SpawnConfig } from "./types.js";
import { acpSmokeTest } from "./smoke-test.js";

const COMMAND = "codex-acp";

function baseEnv(): Record<string, string> {
	return {
		CODEX_CLI_AUTH_CREDENTIALS_STORE: "file",
		CODEX_HOME: `${process.env.HOME}/.codex`,
	};
}

export class CodexProvider implements Provider {
	readonly name = "codex";
	readonly label = "Codex";
	readonly color = "#10b981";

	supportedPlatforms(): NodeJS.Platform[] {
		return ["darwin", "linux"];
	}

	async resolveCommand(): Promise<ResolvedCommand | null> {
		// Check node_modules/.bin first
		const nmBin = join("node_modules", ".bin", COMMAND);
		if (existsSync(nmBin)) {
			return { path: nmBin, source: "node_modules" };
		}

		// Check PATH
		try {
			const resolved = execFileSync("which", [COMMAND], { encoding: "utf-8" }).trim();
			if (resolved) {
				return { path: resolved, source: "path" };
			}
		} catch {
			// not found on PATH
		}

		return null;
	}

	installInstructions(platform: NodeJS.Platform): string {
		if (platform === "darwin") {
			return `brew install zed-industries/codex-acp`;
		}
		return `See https://github.com/zed-industries/codex-acp for installation instructions.`;
	}

	async checkAuth(command: string): Promise<AuthResult> {
		const result = await acpSmokeTest({
			command,
			args: [],
			env: baseEnv(),
		});

		return {
			ok: result.ok,
			checkedAt: new Date().toISOString(),
			error: result.error,
			loginCommand: "codex auth",
		};
	}

	spawnConfig(
		resolved: ResolvedCommand,
		userOverrides?: AgentUserConfig,
		permissionPolicy?: "full" | "restricted",
	): SpawnConfig {
		const policy = permissionPolicy ?? "full";

		const policyArgs: string[] =
			policy === "full"
				? ["-c", 'sandbox_mode="danger-full-access"', "-c", 'approval_policy="never"']
				: [];

		const userArgs = userOverrides?.args ?? [];
		const userEnv = userOverrides?.env ?? {};

		return {
			command: resolved.path,
			args: [...policyArgs, ...userArgs],
			env: { ...baseEnv(), ...userEnv },
		};
	}

	permissionModes(): string[] {
		return [];
	}

	describePermissions(policy: "full" | "restricted"): ProviderPermissions {
		if (policy === "full") {
			return {
				policy: "full",
				effectiveMode: "provider_full",
				notes: [
					'sandbox_mode="danger-full-access" — disables all sandbox restrictions',
					"approval_policy=never — no tool-use approval prompts",
					"CODEX_CLI_AUTH_CREDENTIALS_STORE=file — file-based auth to avoid keychain issues",
				],
			};
		}

		return {
			policy: "restricted",
			effectiveMode: "provider_restricted",
			notes: [
				"Uses default sandbox — Codex applies its built-in restrictions",
			],
		};
	}
}
