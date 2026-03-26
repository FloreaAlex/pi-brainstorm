import type { SessionId } from "@agentclientprotocol/sdk";

export interface AgentConfig {
	name: string;
	command: string;
	args: string[];
	env?: Record<string, string>;
	color: string;
	label: string;
}

export interface AgentState {
	config: AgentConfig;
	status: "connecting" | "active" | "muted" | "disconnected" | "error";
	sessionId?: SessionId;
	errorMessage?: string;
}

export interface BrainstormMessage {
	source: string; // "user" | agent name
	content: string;
	timestamp: number;
}

export interface BrainstormState {
	agents: Map<string, AgentState>;
	messages: BrainstormMessage[];
	active: boolean;
}

export interface StreamChunk {
	agentName: string;
	text: string;
	done: boolean;
	kind: "message" | "thought";
}

export interface AutoModeState {
	active: boolean;
	turnsRemaining: Map<string, number>;
	turnOrder: string[];
	currentTurnIdx: number;
	topic?: string;
}

export const DEFAULT_AGENTS: Record<string, AgentConfig> = {
	claude: {
		name: "claude",
		command: "claude-agent-acp",
		args: [],
		env: { ACP_PERMISSION_MODE: "bypassPermissions" },
		color: "#4a9eff",
		label: "Claude",
	},
	codex: {
		name: "codex",
		command: "codex-acp",
		args: [
			"-c", 'sandbox_permissions=["disk-full-read-access","disk-full-write-access","network-full-access"]',
		],
		env: {
			CODEX_CLI_AUTH_CREDENTIALS_STORE: "file",
			CODEX_HOME: `${process.env.HOME}/.codex`,
		},
		color: "#10b981",
		label: "Codex",
	},
};
