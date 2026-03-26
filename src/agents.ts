import { type ChildProcess, spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { readFileSync, writeFileSync } from "node:fs";
import * as acp from "@agentclientprotocol/sdk";
import type { AgentConfig, AgentState, StreamChunk } from "./types.js";

/** Tracked terminal processes for ACP terminal interface. */
const terminals = new Map<string, { proc: ChildProcess; output: string; exitCode: number | null }>();
let terminalId = 0;

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

			// Discard stderr — ACP bridges emit noisy warnings
			proc.stderr?.resume();

			const input = Writable.toWeb(proc.stdin!);
			const output = Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>;
			const stream = acp.ndJsonStream(input, output);

			// Suppress noisy ACP SDK validation errors (tool_call schema mismatches from bridges)
			const origConsoleError = console.error;
			console.error = (...args: unknown[]) => {
				const msg = String(args[0] ?? "");
				if (msg.includes("Error handling notification") || msg.includes("Invalid params")) return;
				origConsoleError(...args);
			};

			const agentName = config.name;
			const connection = new acp.ClientSideConnection(
				() => ({
					requestPermission: async (params) => {
						const options = (params as any).options ?? [];
						return { outcome: { outcome: "selected", optionId: options[0]?.id ?? "allow" } };
					},
					readTextFile: async (params) => {
						try { return { content: readFileSync((params as any).path, "utf-8") }; }
						catch { return { content: "" }; }
					},
					writeTextFile: async (params) => {
						try { writeFileSync((params as any).path, (params as any).content, "utf-8"); return {}; }
						catch { return {}; }
					},
					createTerminal: async (params) => {
						const id = `t${++terminalId}`;
						const p = spawn((params as any).command, (params as any).args ?? [], {
							cwd: (params as any).cwd ?? cwd, shell: true,
							stdio: ["pipe", "pipe", "pipe"],
							env: { ...process.env, ...config.env },
						});
						const t = { proc: p, output: "", exitCode: null as number | null };
						p.stdout?.on("data", (d: Buffer) => { t.output += d.toString(); });
						p.stderr?.on("data", (d: Buffer) => { t.output += d.toString(); });
						p.on("exit", (c) => { t.exitCode = c; });
						terminals.set(id, t);
						return { terminalId: id };
					},
					terminalOutput: async (params) => {
						const t = terminals.get((params as any).terminalId);
						if (!t) return { output: "" };
						return { output: t.output, exitStatus: t.exitCode !== null ? { exitCode: t.exitCode } : undefined };
					},
					waitForTerminalExit: async (params) => {
						const t = terminals.get((params as any).terminalId);
						if (!t) return { exitStatus: { exitCode: -1 } };
						if (t.exitCode !== null) return { exitStatus: { exitCode: t.exitCode } };
						return new Promise((r) => t.proc.on("exit", (c) => r({ exitStatus: { exitCode: c ?? -1 } })));
					},
					releaseTerminal: async (params) => {
						const t = terminals.get((params as any).terminalId);
						if (t) { t.proc.kill(); terminals.delete((params as any).terminalId); }
					},
					killTerminal: async (params) => {
						const t = terminals.get((params as any).terminalId);
						if (t) { t.proc.kill("SIGKILL"); terminals.delete((params as any).terminalId); }
					},
					sessionUpdate: async (params: acp.SessionNotification) => {
						const update = params.update;
						if (update.sessionUpdate === "agent_message_chunk") {
							const content = update.content;
							if (content.type === "text") {
								this.emitStream({ agentName, text: content.text, done: false, kind: "message" });
							}
						} else if (update.sessionUpdate === "agent_thought_chunk") {
							const content = update.content;
							if (content.type === "text") {
								this.emitStream({ agentName, text: content.text, done: false, kind: "thought" });
							}
						}
					},
				}),
				stream,
			);

			const initResult = await connection.initialize({
				protocolVersion: acp.PROTOCOL_VERSION,
				clientCapabilities: {
					fs: { readTextFile: true, writeTextFile: true },
					terminal: true,
				},
			});

			// Authenticate if needed — some bridges (codex-acp) require this before session/new
			if (initResult.authMethods && initResult.authMethods.length > 0) {
				const method = initResult.authMethods[0];
				await connection.authenticate({ methodId: method.id });
			}

			const session = await connection.newSession({ cwd, mcpServers: [] });

			// Try to set a full-permissions mode to reduce permission prompts.
			// Not all agents support this — the requestPermission handler is the
			// ACP standard fallback that works for any agent.
			try {
				const modes = session.modes?.availableModes?.map((m: acp.SessionMode) => m.id) ?? [];
				const fullMode = modes.find((m: string) => m === "bypassPermissions" || m === "full-access" || m === "dontAsk");
				if (fullMode) {
					await connection.setSessionMode({ sessionId: session.sessionId, modeId: fullMode });
				}
			} catch {
				// Mode not supported — fine, requestPermission handles it
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
				this.emitStream({ agentName: config.name, text: "", done: true, kind: "message" });
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
			this.emitStream({ agentName, text: "", done: true, kind: "message" });
			return result;
		} catch (err) {
			agent.state.status = "error";
			agent.state.errorMessage = err instanceof Error ? err.message : String(err);
			this.emitStream({ agentName, text: "", done: true, kind: "message" });
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

	/** Synchronous kill for signal handlers — sends SIGKILL to all agents immediately. */
	killAllSync(): void {
		for (const agent of this.agents.values()) {
			try {
				agent.process.kill("SIGKILL");
			} catch {}
		}
		this.agents.clear();
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
