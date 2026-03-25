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
}

export const DEFAULT_AGENTS: Record<string, AgentConfig> = {
	claude: {
		name: "claude",
		command: "claude-agent-acp",
		args: [],
		color: "#4a9eff",
		label: "Claude",
	},
	codex: {
		name: "codex",
		command: "codex-acp",
		args: [],
		env: { CODEX_CLI_AUTH_CREDENTIALS_STORE: "file" },
		color: "#10b981",
		label: "Codex",
	},
};
