export type ResolvedCommandSource = "managed" | "node_modules" | "path" | "variant";

export interface ResolvedCommand {
	path: string;
	source: ResolvedCommandSource;
}

export interface ProviderInstallSpec {
	kind: "npm" | "brew" | "manual";
	summary: string;
	command?: string;
	args?: string[];
	autoInstallable: boolean;
}

export interface ResolveContext {
	packageRoot: string;
	managedToolsRoot: string;
}

export interface ProviderAuthCommand {
	command: string;
	args: string[];
	env?: Record<string, string>;
}

export interface AuthResult {
	ok: boolean;
	checkedAt: string;
	error?: string;
	loginCommand: string;
}

export interface SpawnConfig {
	command: string;
	args: string[];
	env: Record<string, string>;
}

export interface ProviderPermissions {
	policy: "full" | "restricted";
	effectiveMode: "provider_full" | "provider_restricted" | "unsupported";
	notes: string[];
}

export interface AgentUserConfig {
	enabled?: boolean;
	command?: string | null;
	args?: string[] | null;
	env?: Record<string, string> | null;
	preferredModel?: string | null;
	color?: string | null;
}

export interface MachineAgentState {
	enabled: boolean;
	command: string;
	commandSource: ResolvedCommandSource;
	args?: string[];
	env?: Record<string, string>;
	preferredModel?: string;
	color?: string;
	auth: {
		ok: boolean;
		checkedAt: string;
		error?: string;
	};
}

export interface BrainstormConfig {
	version: 1;
	permissions: {
		defaultPolicy: "full" | "restricted";
	};
	agents: Record<string, MachineAgentState>;
	prompts?: {
		brainstorm?: string;
		auto?: string;
	};
}

export interface Provider {
	name: string;
	label: string;
	color: string;
	supportedPlatforms(): NodeJS.Platform[];
	resolveCommand(context: ResolveContext): Promise<ResolvedCommand | null>;
	getInstallSpec(platform: NodeJS.Platform, context: ResolveContext): ProviderInstallSpec | null;
	getAuthCommand(command: string): ProviderAuthCommand;
	checkAuth(command: string): Promise<AuthResult>;
	spawnConfig(
		resolved: ResolvedCommand,
		userOverrides?: AgentUserConfig,
		permissionPolicy?: "full" | "restricted",
	): SpawnConfig;
	permissionModes(): string[];
	describePermissions(policy: "full" | "restricted"): ProviderPermissions;
}
