import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentUserConfig, AuthResult, Provider, ProviderPermissions, ResolvedCommand, SpawnConfig } from "./types.js";
import { acpSmokeTest } from "./smoke-test.js";

const PRIMARY_COMMAND = "claude-agent-acp";
const VARIANT_COMMANDS = ["claude-code-acp"];

const BYPASS_ENV: Record<string, string> = {
	ACP_PERMISSION_MODE: "bypassPermissions",
	CLAUDE_CODE_PERMISSION_MODE: "bypassPermissions",
};

export class ClaudeProvider implements Provider {
	readonly name = "claude";
	readonly label = "Claude";
	readonly color = "#4a9eff";

	supportedPlatforms(): NodeJS.Platform[] {
		return ["darwin", "linux", "win32"];
	}

	async resolveCommand(): Promise<ResolvedCommand | null> {
		// 1. Check node_modules/.bin
		const localBin = join("node_modules", ".bin", PRIMARY_COMMAND);
		if (existsSync(localBin)) {
			return { path: localBin, source: "node_modules" };
		}

		// 2. Check PATH for primary command
		const primaryPath = this.whichSync(PRIMARY_COMMAND);
		if (primaryPath) {
			return { path: primaryPath, source: "path" };
		}

		// 3. Check PATH for variant commands
		for (const variant of VARIANT_COMMANDS) {
			const variantPath = this.whichSync(variant);
			if (variantPath) {
				return { path: variantPath, source: "variant" };
			}
		}

		return null;
	}

	installInstructions(_platform: NodeJS.Platform): string {
		return "npm install -g @agentclientprotocol/claude-agent-acp";
	}

	async checkAuth(command: string): Promise<AuthResult> {
		const result = await acpSmokeTest({
			command,
			args: [],
			env: { ...BYPASS_ENV },
		});

		return {
			ok: result.ok,
			checkedAt: new Date().toISOString(),
			error: result.error,
			loginCommand: "claude login",
		};
	}

	spawnConfig(
		resolved: ResolvedCommand,
		userOverrides?: AgentUserConfig,
		permissionPolicy?: "full" | "restricted",
	): SpawnConfig {
		const policy = permissionPolicy ?? "full";

		const args = userOverrides?.args ?? [];
		const providerEnv = policy === "full" ? { ...BYPASS_ENV } : {};
		const userEnv = userOverrides?.env ?? {};

		return {
			command: resolved.path,
			args,
			env: { ...providerEnv, ...userEnv },
		};
	}

	permissionModes(): string[] {
		return ["bypassPermissions"];
	}

	describePermissions(policy: "full" | "restricted"): ProviderPermissions {
		if (policy === "full") {
			return {
				policy: "full",
				effectiveMode: "provider_full",
				notes: [
					"ACP bypass mode set via setSessionMode and setSessionConfigOption",
					"ACP_PERMISSION_MODE and CLAUDE_CODE_PERMISSION_MODE env vars set to bypassPermissions",
					"[ACP:PERMISSION:BYPASS] marker included in prompt templates",
				],
			};
		}

		return {
			policy: "restricted",
			effectiveMode: "provider_restricted",
			notes: [
				"Default mode with approval prompts for tool use",
				"No bypass env vars or permission markers applied",
			],
		};
	}

	private whichSync(cmd: string): string | null {
		try {
			return execSync(`which ${cmd} 2>/dev/null`, { encoding: "utf-8" }).trim() || null;
		} catch {
			return null;
		}
	}
}
