export interface ResolvedCommand {
	path: string;
	source: "bundled" | "node_modules" | "path" | "variant";
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
	commandSource: "bundled" | "node_modules" | "path" | "variant";
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
	resolveCommand(): Promise<ResolvedCommand | null>;
	installInstructions(platform: NodeJS.Platform): string;
	checkAuth(command: string): Promise<AuthResult>;
	spawnConfig(
		resolved: ResolvedCommand,
		userOverrides?: AgentUserConfig,
		permissionPolicy?: "full" | "restricted",
	): SpawnConfig;
	permissionModes(): string[];
	describePermissions(policy: "full" | "restricted"): ProviderPermissions;
}
