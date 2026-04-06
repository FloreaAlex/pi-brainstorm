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

export class GeminiProvider implements Provider {
	readonly name = "gemini";
	readonly label = "Gemini";
	readonly color = "#f59e0b";

	supportedPlatforms(): NodeJS.Platform[] {
		return ["darwin", "linux", "win32"];
	}

	async resolveCommand(context: ResolveContext): Promise<ResolvedCommand | null> {
		const cmd = "gemini";

		const managed = resolveManagedCommand(cmd, context);
		if (managed) {
			return managed;
		}

		const nmBin = resolvePackageCommand(cmd, context);
		if (nmBin) {
			return nmBin;
		}

		const resolved = findOnPath(cmd);
		if (resolved) {
			return { path: resolved, source: "path" };
		}

		return null;
	}

	getInstallSpec(_platform: NodeJS.Platform, _context: ResolveContext): ProviderInstallSpec {
		return {
			kind: "npm",
			summary: "npm install -g @google/gemini-cli",
			command: "npm",
			args: ["install", "-g", "@google/gemini-cli"],
			autoInstallable: true,
		};
	}

	getCliDependency(): CliDependency | null {
		return null; // gemini CLI is the ACP bridge — no separate dependency
	}

	getAuthCommand(_command: string): { command: string; args: string[] } {
		// Gemini has no dedicated auth command — it authenticates via browser on first interactive run
		return {
			command: "gemini",
			args: [],
		};
	}

	async checkAuth(command: string): Promise<AuthResult> {
		const checkedAt = new Date().toISOString();
		const result = await acpSmokeTest({
			command,
			args: ["--acp", "--approval-mode=yolo"],
			env: { GEMINI_SANDBOX: "false" },
			timeoutMs: 60_000,
		});
		return {
			ok: result.ok,
			checkedAt,
			error: result.error,
			loginCommand: "gemini (authenticates on first run)",
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
