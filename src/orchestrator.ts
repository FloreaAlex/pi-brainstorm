import type { ContentBlock } from "@agentclientprotocol/sdk";
import { AgentManager } from "./agents.js";
import { buildAgentPrompt } from "./prompt.js";
import type { AgentConfig, BrainstormMessage, BrainstormState, StreamChunk } from "./types.js";

export type OrchestratorEvent =
	| { type: "stream"; agentName: string; text: string; kind: "message" | "thought" }
	| { type: "done"; agentName: string }
	| { type: "all_done" }
	| { type: "error"; agentName: string; message: string }
	| { type: "agent_status"; agentName: string; status: string };

export type OrchestratorCallback = (event: OrchestratorEvent) => void;

/** Parse @mentions from start of message. Case-insensitive, word-boundary. */
export function parseMentions(text: string, agentNames: string[]): { mentions: string[]; body: string } {
	const mentions: string[] = [];
	let body = text;

	for (const name of agentNames) {
		const regex = new RegExp(`^@${name}\\b\\s*`, "i");
		const match = body.match(regex);
		if (match) {
			mentions.push(name.toLowerCase());
			body = body.slice(match[0].length);
		}
	}

	return { mentions, body: body.trim() || text.trim() };
}

export class Orchestrator {
	private agentManager: AgentManager;
	private state: BrainstormState;
	private mutedAgents = new Set<string>();
	private callbacks = new Set<OrchestratorCallback>();
	private cwd: string;
	private agentConfigs = new Map<string, AgentConfig>();
	private promptSent = new Set<string>();

	constructor(cwd: string, agentManager?: AgentManager) {
		this.cwd = cwd;
		this.agentManager = agentManager ?? new AgentManager();
		this.state = { agents: new Map(), messages: [], active: false };

		this.agentManager.onStream((chunk: StreamChunk) => {
			if (chunk.done) {
				this.emit({ type: "done", agentName: chunk.agentName });
			} else {
				this.emit({ type: "stream", agentName: chunk.agentName, text: chunk.text, kind: chunk.kind });
			}
		});
	}

	onEvent(cb: OrchestratorCallback): () => void {
		this.callbacks.add(cb);
		return () => this.callbacks.delete(cb);
	}

	private emit(event: OrchestratorEvent): void {
		for (const cb of this.callbacks) cb(event);
	}

	async start(configs: AgentConfig[]): Promise<void> {
		this.state.active = true;

		for (const config of configs) {
			this.agentConfigs.set(config.name, config);
			const agentState = await this.agentManager.spawnAgent(config, this.cwd);
			this.state.agents.set(config.name, agentState);
			this.emit({ type: "agent_status", agentName: config.name, status: agentState.status });

			if (agentState.status === "error") {
				this.emit({ type: "error", agentName: config.name, message: agentState.errorMessage ?? "Unknown error" });
			}
		}
	}

	/** Build system prompt for an agent dynamically, reflecting current participants. */
	private buildPromptForAgent(agentName: string): string {
		const config = this.agentConfigs.get(agentName);
		const label = config?.label ?? agentName;
		const participants = [
			...[...this.agentConfigs.values()].map((c) => c.label),
			"Human (you)",
		];
		return buildAgentPrompt(this.cwd, agentName, label, participants);
	}

	async sendMessage(text: string): Promise<void> {
		if (!this.state.active) return;

		const agentNames = [...this.state.agents.keys()];
		const { mentions, body } = parseMentions(text, agentNames);

		this.state.messages.push({ source: "user", content: body, timestamp: Date.now() });

		let respondingAgents: string[];
		if (mentions.length > 0) {
			respondingAgents = mentions;
		} else {
			respondingAgents = agentNames.filter((n) => !this.mutedAgents.has(n));
		}

		const contextBlocks: ContentBlock[] = this.state.messages.map((m) => ({
			type: "text" as const,
			text: `[${m.source}]: ${m.content}`,
		}));

		let doneCount = 0;
		const pendingCount = respondingAgents.length;

		const promises = respondingAgents.map(async (agentName) => {
			const accumulated: string[] = [];
			const unsubStream = this.agentManager.onStream((chunk) => {
				if (chunk.agentName === agentName && !chunk.done) {
					accumulated.push(chunk.text);
				}
			});

			// Prepend system prompt only on the agent's first message
			const prompt: ContentBlock[] = [];
			if (!this.promptSent.has(agentName)) {
				const systemPrompt = this.buildPromptForAgent(agentName);
				prompt.push({ type: "text" as const, text: `[system]: ${systemPrompt}` });
				this.promptSent.add(agentName);
			}
			prompt.push(...contextBlocks);

			await this.agentManager.sendPrompt(agentName, prompt);

			unsubStream();

			const fullResponse = accumulated.join("");
			if (fullResponse) {
				this.state.messages.push({
					source: agentName,
					content: fullResponse,
					timestamp: Date.now(),
				});
			}

			doneCount++;
			if (doneCount >= pendingCount) {
				this.emit({ type: "all_done" });
			}
		});

		await Promise.allSettled(promises);
	}

	muteAgent(name: string): boolean {
		if (!this.state.agents.has(name)) return false;
		this.mutedAgents.add(name);
		const agentState = this.state.agents.get(name);
		if (agentState) agentState.status = "muted";
		return true;
	}

	unmuteAgent(name: string): boolean {
		if (!this.mutedAgents.has(name)) return false;
		this.mutedAgents.delete(name);
		const agentState = this.state.agents.get(name);
		if (agentState) agentState.status = "active";
		return true;
	}

	async addAgent(config: AgentConfig): Promise<void> {
		this.agentConfigs.set(config.name, config);
		const agentState = await this.agentManager.spawnAgent(config, this.cwd);
		this.state.agents.set(config.name, agentState);
	}

	async removeAgent(name: string): Promise<void> {
		await this.agentManager.killAgent(name);
		this.state.agents.delete(name);
		this.agentConfigs.delete(name);
		this.mutedAgents.delete(name);
	}

	async restartAgent(name: string): Promise<void> {
		const agent = this.agentManager.getAgent(name);
		if (!agent) return;
		const config = agent.config;
		await this.removeAgent(name);
		await this.addAgent(config);
	}

	async stop(): Promise<void> {
		await this.agentManager.killAll();
		this.state.active = false;
	}

	/** Synchronous kill for signal handlers. */
	killSync(): void {
		this.agentManager.killAllSync();
		this.state.active = false;
	}

	getState(): BrainstormState {
		return this.state;
	}

	getMessages(): BrainstormMessage[] {
		return this.state.messages;
	}

	isActive(): boolean {
		return this.state.active;
	}

	/** Serialize state for session persistence */
	toJSON(): { messages: BrainstormMessage[]; agents: Record<string, string>; mutedAgents: string[] } {
		const agents: Record<string, string> = {};
		for (const [name, state] of this.state.agents) {
			agents[name] = state.config.name;
		}
		return {
			messages: this.state.messages,
			agents,
			mutedAgents: [...this.mutedAgents],
		};
	}
}
