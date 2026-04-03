import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { type AgentConnection, AgentManager } from "../src/extension/agents.js";
import type { AgentConfig, AgentState, StreamChunk } from "../src/extension/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(name = "test-agent"): AgentConfig {
	return {
		name,
		command: "echo",
		args: [],
		color: "#fff",
		label: name,
	};
}

function makeAgentConnection(name: string, status: AgentState["status"] = "active"): AgentConnection {
	const config = makeConfig(name);
	const proc = Object.assign(new EventEmitter(), {
		stdin: null,
		stdout: null,
		stderr: null,
		stdio: [null, null, null, null, null] as const,
		pid: 123,
		exitCode: null,
		signalCode: null,
		killed: false,
		connected: true,
		channel: undefined,
		kill: vi.fn(function (this: EventEmitter) {
			(this as any).exitCode = 0;
			process.nextTick(() => this.emit("exit", 0, null));
			return true;
		}),
		send: vi.fn(),
		disconnect: vi.fn(),
		ref: vi.fn(),
		unref: vi.fn(),
		[Symbol.dispose]: vi.fn(),
	});

	const connection = {
		initialize: vi.fn(),
		newSession: vi.fn(),
		prompt: vi.fn(),
		cancel: vi.fn(),
		setSessionMode: vi.fn(),
		authenticate: vi.fn(),
	};

	return {
		config,
		process: proc as never,
		connection: connection as never,
		sessionId: `session-${name}`,
		state: { config, status, sessionId: `session-${name}` },
	};
}

/**
 * Injects an AgentConnection directly into the manager's private `agents` map
 * so we can test manager logic without spawning real processes.
 */
function injectAgent(manager: AgentManager, conn: AgentConnection): void {
	(manager as any).agents.set(conn.config.name, conn);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentManager", () => {
	let manager: AgentManager;

	beforeEach(() => {
		manager = new AgentManager();
	});

	// -- Stream callback management ------------------------------------------

	describe("onStream / emitStream", () => {
		it("registers a callback and receives stream chunks", () => {
			const received: StreamChunk[] = [];
			manager.onStream((chunk) => received.push(chunk));

			const chunk: StreamChunk = { agentName: "a", text: "hello", done: false };
			(manager as any).emitStream(chunk);

			expect(received).toEqual([chunk]);
		});

		it("supports multiple callbacks", () => {
			const r1: StreamChunk[] = [];
			const r2: StreamChunk[] = [];
			manager.onStream((c) => r1.push(c));
			manager.onStream((c) => r2.push(c));

			const chunk: StreamChunk = { agentName: "a", text: "x", done: false };
			(manager as any).emitStream(chunk);

			expect(r1).toHaveLength(1);
			expect(r2).toHaveLength(1);
		});

		it("unsubscribes when the returned function is called", () => {
			const received: StreamChunk[] = [];
			const unsub = manager.onStream((c) => received.push(c));
			unsub();

			(manager as any).emitStream({ agentName: "a", text: "y", done: false });
			expect(received).toHaveLength(0);
		});

		it("only unsubscribes the targeted callback", () => {
			const r1: StreamChunk[] = [];
			const r2: StreamChunk[] = [];
			const unsub1 = manager.onStream((c) => r1.push(c));
			manager.onStream((c) => r2.push(c));

			unsub1();

			(manager as any).emitStream({ agentName: "a", text: "z", done: true });

			expect(r1).toHaveLength(0);
			expect(r2).toHaveLength(1);
		});
	});

	// -- killAgent -----------------------------------------------------------

	describe("killAgent", () => {
		it("removes the agent from the map and kills the process", async () => {
			const conn = makeAgentConnection("kill-me");
			injectAgent(manager, conn);

			expect(manager.getAgent("kill-me")).toBeDefined();
			await manager.killAgent("kill-me");

			expect(manager.getAgent("kill-me")).toBeUndefined();
			expect((conn.process.kill as Mock).mock.calls.length).toBe(1);
		});

		it("is a no-op for unknown agent names", async () => {
			await expect(manager.killAgent("nonexistent")).resolves.toBeUndefined();
		});
	});

	// -- killAll -------------------------------------------------------------

	describe("killAll", () => {
		it("kills every agent in the map", async () => {
			const c1 = makeAgentConnection("a1");
			const c2 = makeAgentConnection("a2");
			injectAgent(manager, c1);
			injectAgent(manager, c2);

			await manager.killAll();

			expect(manager.getAllAgents()).toHaveLength(0);
			expect((c1.process.kill as Mock).mock.calls.length).toBe(1);
			expect((c2.process.kill as Mock).mock.calls.length).toBe(1);
		});
	});

	// -- getActiveAgents -----------------------------------------------------

	describe("getActiveAgents", () => {
		it("returns only agents with status 'active'", () => {
			injectAgent(manager, makeAgentConnection("active1", "active"));
			injectAgent(manager, makeAgentConnection("err1", "error"));
			injectAgent(manager, makeAgentConnection("active2", "active"));
			injectAgent(manager, makeAgentConnection("disc1", "disconnected"));

			const active = manager.getActiveAgents();
			expect(active).toHaveLength(2);
			expect(active.map((a) => a.config.name).sort()).toEqual(["active1", "active2"]);
		});

		it("returns empty array when no agents are active", () => {
			injectAgent(manager, makeAgentConnection("e1", "error"));
			expect(manager.getActiveAgents()).toHaveLength(0);
		});
	});

	// -- getAllAgents ---------------------------------------------------------

	describe("getAllAgents", () => {
		it("returns all agents regardless of status", () => {
			injectAgent(manager, makeAgentConnection("a", "active"));
			injectAgent(manager, makeAgentConnection("b", "error"));
			injectAgent(manager, makeAgentConnection("c", "disconnected"));

			expect(manager.getAllAgents()).toHaveLength(3);
		});
	});

	// -- getAgent ------------------------------------------------------------

	describe("getAgent", () => {
		it("returns the connection for a known agent", () => {
			const conn = makeAgentConnection("known");
			injectAgent(manager, conn);
			expect(manager.getAgent("known")).toBe(conn);
		});

		it("returns undefined for an unknown agent", () => {
			expect(manager.getAgent("nope")).toBeUndefined();
		});
	});

	// -- sendPrompt ----------------------------------------------------------

	describe("sendPrompt", () => {
		it("returns undefined for an unknown agent", async () => {
			const result = await manager.sendPrompt("ghost", [{ type: "text", text: "hi" }]);
			expect(result).toBeUndefined();
		});

		it("returns undefined when agent has no sessionId", async () => {
			const conn = makeAgentConnection("no-session");
			conn.sessionId = undefined;
			injectAgent(manager, conn);

			const result = await manager.sendPrompt("no-session", [{ type: "text", text: "hi" }]);
			expect(result).toBeUndefined();
		});

		it("returns undefined when agent is not active", async () => {
			const conn = makeAgentConnection("inactive", "error");
			injectAgent(manager, conn);

			const result = await manager.sendPrompt("inactive", [{ type: "text", text: "hi" }]);
			expect(result).toBeUndefined();
		});

		it("calls connection.prompt and returns the result", async () => {
			const conn = makeAgentConnection("talker");
			const mockResponse = { stopReason: "end_turn" as const };
			(conn.connection.prompt as Mock).mockResolvedValue(mockResponse);
			injectAgent(manager, conn);

			const streamChunks: StreamChunk[] = [];
			manager.onStream((c) => streamChunks.push(c));

			const result = await manager.sendPrompt("talker", [{ type: "text", text: "hello" }]);

			expect(result).toBe(mockResponse);
			expect((conn.connection.prompt as Mock).mock.calls[0][0]).toEqual({
				sessionId: "session-talker",
				prompt: [{ type: "text", text: "hello" }],
			});
			// Should emit a done chunk after prompt completes
			expect(streamChunks).toEqual([{ agentName: "talker", text: "", done: true, kind: "message" }]);
		});

		it("sets error status and returns undefined when prompt throws", async () => {
			const conn = makeAgentConnection("failing");
			(conn.connection.prompt as Mock).mockRejectedValue(new Error("boom"));
			injectAgent(manager, conn);

			const streamChunks: StreamChunk[] = [];
			manager.onStream((c) => streamChunks.push(c));

			const result = await manager.sendPrompt("failing", [{ type: "text", text: "oops" }]);

			expect(result).toBeUndefined();
			expect(conn.state.status).toBe("error");
			expect(conn.state.errorMessage).toBe("boom");
			// Should still emit done chunk
			expect(streamChunks).toEqual([{ agentName: "failing", text: "", done: true, kind: "message" }]);
		});
	});

	// -- cancelAgent ---------------------------------------------------------

	describe("cancelAgent", () => {
		it("calls connection.cancel with the sessionId", async () => {
			const conn = makeAgentConnection("cancellable");
			injectAgent(manager, conn);

			await manager.cancelAgent("cancellable");

			expect((conn.connection.cancel as Mock).mock.calls[0][0]).toEqual({
				sessionId: "session-cancellable",
			});
		});

		it("is a no-op for unknown agents", async () => {
			await expect(manager.cancelAgent("nope")).resolves.toBeUndefined();
		});

		it("is a no-op when agent has no sessionId", async () => {
			const conn = makeAgentConnection("no-session");
			conn.sessionId = undefined;
			injectAgent(manager, conn);

			await manager.cancelAgent("no-session");
			expect((conn.connection.cancel as Mock).mock.calls.length).toBe(0);
		});
	});
});
