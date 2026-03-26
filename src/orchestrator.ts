import type { ContentBlock } from "@agentclientprotocol/sdk";
import { AgentManager } from "./agents.js";
import { buildAgentPrompt, buildAutoPrompt } from "./prompt.js";
import type { AgentConfig, AutoModeState, BrainstormMessage, BrainstormState, StreamChunk } from "./types.js";

export type OrchestratorEvent =
	| { type: "stream"; agentName: string; text: string; kind: "message" | "thought" }
	| { type: "done"; agentName: string }
	| { type: "all_done" }
	| { type: "error"; agentName: string; message: string }
	| { type: "agent_status"; agentName: string; status: string }
	| { type: "auto_turn_start"; agentName: string; turn: number; totalTurns: number }
	| { type: "auto_turn_end"; agentName: string }
	| { type: "auto_complete" };

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
	private autoMode: AutoModeState = { active: false, turnsRemaining: new Map(), turnOrder: [], currentTurnIdx: 0 };
	private autoInterrupted = false;

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

	// ── Auto Mode ──────────────────────────────────────────────────────

	async startAuto(turnsPerAgent: number, topic?: string): Promise<void> {
		if (!this.state.active) return;

		const activeAgents = [...this.state.agents.entries()]
			.filter(([_, s]) => s.status === "active")
			.map(([n]) => n);

		if (activeAgents.length < 2) {
			this.emit({ type: "error", agentName: "", message: "Need at least 2 active agents for auto mode" });
			return;
		}

		// Shuffle turn order randomly
		const turnOrder = [...activeAgents].sort(() => Math.random() - 0.5);

		this.autoMode = {
			active: true,
			turnsRemaining: new Map(turnOrder.map((n) => [n, turnsPerAgent])),
			turnOrder,
			currentTurnIdx: 0,
			topic,
		};
		this.autoInterrupted = false;

		await this.runAutoLoop();
	}

	async continueAuto(turnsPerAgent = 1): Promise<void> {
		if (!this.state.active || this.autoMode.turnOrder.length === 0) return;

		// Reset turns for existing order
		for (const name of this.autoMode.turnOrder) {
			this.autoMode.turnsRemaining.set(name, turnsPerAgent);
		}
		this.autoMode.active = true;
		this.autoMode.currentTurnIdx = 0;
		this.autoInterrupted = false;

		await this.runAutoLoop();
	}

	stopAuto(): void {
		this.autoInterrupted = true;
		this.autoMode.active = false;
	}

	isAutoMode(): boolean {
		return this.autoMode.active;
	}

	getAutoState(): AutoModeState {
		return this.autoMode;
	}

	private async runAutoLoop(): Promise<void> {
		while (this.autoMode.active && !this.autoInterrupted) {
			// Find next agent with turns remaining
			let foundAgent = false;
			for (let i = 0; i < this.autoMode.turnOrder.length; i++) {
				const idx = (this.autoMode.currentTurnIdx + i) % this.autoMode.turnOrder.length;
				const agentName = this.autoMode.turnOrder[idx];
				const remaining = this.autoMode.turnsRemaining.get(agentName) ?? 0;

				if (remaining > 0) {
					this.autoMode.currentTurnIdx = idx;
					foundAgent = true;
					break;
				}
			}

			if (!foundAgent) break; // All turns exhausted

			const agentName = this.autoMode.turnOrder[this.autoMode.currentTurnIdx];
			const remaining = this.autoMode.turnsRemaining.get(agentName) ?? 0;
			const totalTurns = remaining; // Will be set properly below
			const config = this.agentConfigs.get(agentName);
			if (!config) break;

			// Calculate which turn number this is
			const allTurns = [...this.autoMode.turnsRemaining.values()];
			const maxTurns = Math.max(...allTurns);
			const currentTurn = maxTurns - remaining + 1;

			this.emit({ type: "auto_turn_start", agentName, turn: currentTurn, totalTurns: maxTurns });

			// Build auto prompt for this turn
			const otherAgents = this.autoMode.turnOrder
				.filter((n) => n !== agentName)
				.map((n) => this.agentConfigs.get(n)?.label ?? n);

			const autoPrompt = buildAutoPrompt(
				this.cwd, agentName, config.label, otherAgents,
				currentTurn, maxTurns,
				{ topic: this.autoMode.topic },
			);

			// Build context with auto prompt + conversation history
			const contextBlocks: ContentBlock[] = [
				{ type: "text" as const, text: `[system]: ${autoPrompt}` },
				...this.state.messages.map((m) => ({
					type: "text" as const,
					text: `[${m.source}]: ${m.content}`,
				})),
			];

			// Send to single agent sequentially
			const accumulated: string[] = [];
			const unsubStream = this.agentManager.onStream((chunk) => {
				if (chunk.agentName === agentName && !chunk.done) {
					accumulated.push(chunk.text);
				}
			});

			await this.agentManager.sendPrompt(agentName, contextBlocks);
			unsubStream();

			if (this.autoInterrupted) break;

			// Record response
			const fullResponse = accumulated.join("");
			if (fullResponse) {
				this.state.messages.push({
					source: agentName,
					content: fullResponse,
					timestamp: Date.now(),
				});
			}

			this.emit({ type: "auto_turn_end", agentName });

			// Decrement turns and advance
			this.autoMode.turnsRemaining.set(agentName, remaining - 1);
			this.autoMode.currentTurnIdx = (this.autoMode.currentTurnIdx + 1) % this.autoMode.turnOrder.length;
		}

		if (!this.autoInterrupted && this.autoMode.active) {
			// Summary turn — pick a random agent
			const summaryAgent = this.autoMode.turnOrder[Math.floor(Math.random() * this.autoMode.turnOrder.length)];
			const config = this.agentConfigs.get(summaryAgent);
			if (config) {
				const otherAgents = this.autoMode.turnOrder
					.filter((n) => n !== summaryAgent)
					.map((n) => this.agentConfigs.get(n)?.label ?? n);

				const summaryPrompt = buildAutoPrompt(
					this.cwd, summaryAgent, config.label, otherAgents,
					0, 0, { topic: this.autoMode.topic, isSummary: true },
				);

				this.emit({ type: "auto_turn_start", agentName: summaryAgent, turn: 0, totalTurns: 0 });

				const contextBlocks: ContentBlock[] = [
					{ type: "text" as const, text: `[system]: ${summaryPrompt}` },
					...this.state.messages.map((m) => ({
						type: "text" as const,
						text: `[${m.source}]: ${m.content}`,
					})),
				];

				const accumulated: string[] = [];
				const unsubStream = this.agentManager.onStream((chunk) => {
					if (chunk.agentName === summaryAgent && !chunk.done) {
						accumulated.push(chunk.text);
					}
				});

				await this.agentManager.sendPrompt(summaryAgent, contextBlocks);
				unsubStream();

				const fullResponse = accumulated.join("");
				if (fullResponse) {
					this.state.messages.push({
						source: summaryAgent,
						content: fullResponse,
						timestamp: Date.now(),
					});
				}

				this.emit({ type: "auto_turn_end", agentName: summaryAgent });
			}
		}

		this.autoMode.active = false;
		this.emit({ type: "auto_complete" });
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
