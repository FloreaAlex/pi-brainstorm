import type {
	AgentUserConfig,
	AuthResult,
	Provider,
	ProviderInstallSpec,
	ProviderPermissions,
	ResolveContext,
	ResolvedCommand,
	SpawnConfig,
} from "./types.js";
import { acpSmokeTest } from "./smoke-test.js";
import { findOnPath, resolveManagedCommand, resolvePackageCommand } from "./resolve.js";

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

	async resolveCommand(context: ResolveContext): Promise<ResolvedCommand | null> {
		const managed = resolveManagedCommand(PRIMARY_COMMAND, context);
		if (managed) {
			return managed;
		}

		const localBin = resolvePackageCommand(PRIMARY_COMMAND, context);
		if (localBin) {
			return localBin;
		}

		const primaryPath = findOnPath(PRIMARY_COMMAND);
		if (primaryPath) {
			return { path: primaryPath, source: "path" };
		}

		for (const variant of VARIANT_COMMANDS) {
			const variantPath = findOnPath(variant);
			if (variantPath) {
				return { path: variantPath, source: "variant" };
			}
		}

		return null;
	}

	getInstallSpec(_platform: NodeJS.Platform, context: ResolveContext): ProviderInstallSpec {
		return {
			kind: "npm",
			summary: `npm install --prefix ${context.managedToolsRoot} @agentclientprotocol/claude-agent-acp`,
			command: "npm",
			args: ["install", "--prefix", context.managedToolsRoot, "@agentclientprotocol/claude-agent-acp"],
			autoInstallable: true,
		};
	}

	getAuthCommand(_command: string): { command: string; args: string[] } {
		return {
			command: "claude",
			args: ["login"],
		};
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

}
