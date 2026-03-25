import { type ChildProcess, spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type { AgentConfig, AgentState, StreamChunk } from "./types.js";

export interface AgentConnection {
	config: AgentConfig;
	process: ChildProcess;
	connection: acp.ClientSideConnection;
	sessionId?: acp.SessionId;
	state: AgentState;
}

export type StreamCallback = (chunk: StreamChunk) => void;

export class AgentManager {
	private agents = new Map<string, AgentConnection>();
	private streamCallbacks = new Set<StreamCallback>();

	onStream(cb: StreamCallback): () => void {
		this.streamCallbacks.add(cb);
		return () => {
			this.streamCallbacks.delete(cb);
		};
	}

	private emitStream(chunk: StreamChunk): void {
		for (const cb of this.streamCallbacks) cb(chunk);
	}

	async spawnAgent(config: AgentConfig, cwd: string): Promise<AgentState> {
		const state: AgentState = { config, status: "connecting" };

		try {
			const proc = spawn(config.command, config.args, {
				stdio: ["pipe", "pipe", "pipe"],
				env: { ...process.env, ...config.env },
				cwd,
			});

			// Log stderr for debugging
			proc.stderr?.on("data", (data: Buffer) => {
				const msg = data.toString().trim();
				if (msg) console.error(`[${config.name} stderr] ${msg}`);
			});

			const input = Writable.toWeb(proc.stdin!);
			const output = Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>;
			const stream = acp.ndJsonStream(input, output);

			const agentName = config.name;
			const connection = new acp.ClientSideConnection(
				() => ({
					requestPermission: async () => ({ allowed: true }),
					sessionUpdate: async (params: acp.SessionNotification) => {
						const update = params.update;
						if (update.sessionUpdate === "agent_message_chunk") {
							const content = update.content;
							if (content.type === "text") {
								this.emitStream({ agentName, text: content.text, done: false });
							}
						}
					},
				}),
				stream,
			);

			await connection.initialize({
				protocolVersion: acp.PROTOCOL_VERSION,
				clientCapabilities: {
					fs: { readTextFile: true, writeTextFile: false },
				},
			});
			const session = await connection.newSession({ cwd, mcpServers: [] });
			if (session.modes?.availableModes?.some((m: acp.SessionMode) => m.id === "read-only")) {
				await connection.setSessionMode({
					sessionId: session.sessionId,
					modeId: "read-only",
				});
			}

			state.status = "active";
			state.sessionId = session.sessionId;

			const conn: AgentConnection = {
				config,
				process: proc,
				connection,
				sessionId: session.sessionId,
				state,
			};
			this.agents.set(config.name, conn);

			proc.on("exit", () => {
				state.status = "disconnected";
				this.emitStream({ agentName: config.name, text: "", done: true });
			});

			return state;
		} catch (err) {
			state.status = "error";
			state.errorMessage = err instanceof Error ? err.message : String(err);
			return state;
		}
	}

	async sendPrompt(agentName: string, prompt: acp.ContentBlock[]): Promise<acp.PromptResponse | undefined> {
		const agent = this.agents.get(agentName);
		if (!agent?.sessionId || agent.state.status !== "active") return undefined;

		try {
			const result = await agent.connection.prompt({
				sessionId: agent.sessionId,
				prompt,
			});
			this.emitStream({ agentName, text: "", done: true });
			return result;
		} catch (err) {
			agent.state.status = "error";
			agent.state.errorMessage = err instanceof Error ? err.message : String(err);
			this.emitStream({ agentName, text: "", done: true });
			return undefined;
		}
	}

	async cancelAgent(agentName: string): Promise<void> {
		const agent = this.agents.get(agentName);
		if (!agent?.sessionId) return;
		await agent.connection.cancel({ sessionId: agent.sessionId });
	}

	async killAgent(agentName: string): Promise<void> {
		const agent = this.agents.get(agentName);
		if (!agent) return;
		this.agents.delete(agentName);
		agent.process.kill();
		// Wait for process to actually exit to avoid zombie processes
		await new Promise<void>((resolve) => {
			if (agent.process.exitCode !== null) {
				resolve();
			} else {
				agent.process.on("exit", () => resolve());
				// Force kill after 5s if it doesn't exit
				setTimeout(() => {
					agent.process.kill("SIGKILL");
					resolve();
				}, 5000);
			}
		});
	}

	async killAll(): Promise<void> {
		for (const name of this.agents.keys()) {
			await this.killAgent(name);
		}
	}

	getAgent(name: string): AgentConnection | undefined {
		return this.agents.get(name);
	}

	getActiveAgents(): AgentConnection[] {
		return [...this.agents.values()].filter((a) => a.state.status === "active");
	}

	getAllAgents(): AgentConnection[] {
		return [...this.agents.values()];
	}
}
