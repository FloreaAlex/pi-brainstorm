import type { SessionId } from "@agentclientprotocol/sdk";

export interface AgentConfig {
	name: string;
	command: string;
	args: string[];
	env?: Record<string, string>;
	color: string;
	label: string;
	/** Preferred model ID — set via ACP config option if the agent exposes a model selector. */
	preferredModel?: string;
}

/** Actual runtime info read back from ACP session after setup. */
export interface AgentSessionInfo {
	model?: string;
	thoughtLevel?: string;
	contextWindow?: number;
}

export interface AgentState {
	config: AgentConfig;
	status: "connecting" | "active" | "muted" | "disconnected" | "error";
	sessionId?: SessionId;
	errorMessage?: string;
	/** Actual runtime values from ACP, not just config preferences. */
	sessionInfo?: AgentSessionInfo;
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
