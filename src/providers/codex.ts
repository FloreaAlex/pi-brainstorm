import type {
	AgentUserConfig,
	AuthResult,
	CliDependency,
	Provider,
	ProviderInstallSpec,
	ProviderPermissions,
	ResolveContext,
	ResolvedCommand,
	SpawnConfig,
} from "./types.js";
import { acpSmokeTest } from "./smoke-test.js";
import { findOnPath, resolveManagedCommand, resolvePackageCommand } from "./resolve.js";

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

	async resolveCommand(context: ResolveContext): Promise<ResolvedCommand | null> {
		const managed = resolveManagedCommand(COMMAND, context);
		if (managed) {
			return managed;
		}

		const nmBin = resolvePackageCommand(COMMAND, context);
		if (nmBin) {
			return nmBin;
		}

		const resolved = findOnPath(COMMAND);
		if (resolved) {
			return { path: resolved, source: "path" };
		}

		return null;
	}

	getInstallSpec(platform: NodeJS.Platform, _context: ResolveContext): ProviderInstallSpec {
		if (platform === "darwin") {
			return {
				kind: "brew",
				summary: "brew install codex-acp",
				command: "brew",
				args: ["install", "codex-acp"],
				autoInstallable: true,
			};
		}
		return {
			kind: "manual",
			summary: "See https://github.com/zed-industries/codex-acp for installation instructions.",
			autoInstallable: false,
		};
	}

	getCliDependency(): CliDependency {
		return {
			command: "codex",
			label: "Codex CLI",
			installSpec: {
				kind: "brew",
				summary: "brew install codex",
				command: "brew",
				args: ["install", "codex"],
				autoInstallable: true,
			},
		};
	}

	getAuthCommand(_command: string): { command: string; args: string[] } {
		return {
			command: "codex",
			args: ["login"],
		};
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
			loginCommand: "codex login",
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
