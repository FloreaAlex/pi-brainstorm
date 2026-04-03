import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentUserConfig, AuthResult, Provider, ProviderPermissions, ResolvedCommand, SpawnConfig } from "./types.js";
import { acpSmokeTest } from "./smoke-test.js";
import { findOnPath } from "./resolve.js";

export class GeminiProvider implements Provider {
	readonly name = "gemini";
	readonly label = "Gemini";
	readonly color = "#f59e0b";

	supportedPlatforms(): NodeJS.Platform[] {
		return ["darwin", "linux", "win32"];
	}

	async resolveCommand(): Promise<ResolvedCommand | null> {
		const cmd = "gemini";

		// Check node_modules/.bin first
		const nmBin = join(process.cwd(), "node_modules", ".bin", cmd);
		if (existsSync(nmBin)) {
			return { path: nmBin, source: "node_modules" };
		}

		// Check PATH
		try {
			const resolved = findOnPath(cmd);
			if (resolved) {
				return { path: resolved, source: "path" };
			}
		} catch {
			// not found in PATH
		}

		return null;
	}

	installInstructions(_platform: NodeJS.Platform): string {
		return "npm install -g @google/gemini-cli";
	}

	async checkAuth(command: string): Promise<AuthResult> {
		const checkedAt = new Date().toISOString();
		const result = await acpSmokeTest({
			command,
			args: ["--acp"],
			env: {},
		});
		return {
			ok: result.ok,
			checkedAt,
			error: result.error,
			loginCommand: "gemini auth",
		};
	}

	spawnConfig(
		resolved: ResolvedCommand,
		userOverrides?: AgentUserConfig,
		permissionPolicy?: "full" | "restricted",
	): SpawnConfig {
		const policy = permissionPolicy ?? "full";

		const baseArgs = policy === "full" ? ["--acp", "--approval-mode=yolo"] : ["--acp"];
		const baseEnv: Record<string, string> = policy === "full" ? { GEMINI_SANDBOX: "false" } : {};

		const userArgs = userOverrides?.args ?? [];
		const userEnv = userOverrides?.env ?? {};

		return {
			command: resolved.path,
			args: [...baseArgs, ...userArgs],
			env: { ...baseEnv, ...userEnv },
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
					"--approval-mode=yolo",
					"GEMINI_SANDBOX=false disables filesystem sandboxing",
				],
			};
		}
		return {
			policy: "restricted",
			effectiveMode: "provider_restricted",
			notes: [
				"Default approval mode with optional sandboxing",
			],
		};
	}
}
