import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentManager } from "../src/agents.js";
import { Orchestrator, type OrchestratorEvent, parseMentions } from "../src/orchestrator.js";
import type { AgentConfig, AgentState } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(name: string): AgentConfig {
	return {
		name,
		command: "echo",
		args: [],
		color: "#fff",
		label: name,
	};
}

function makeAgentState(name: string, status: AgentState["status"] = "active"): AgentState {
	return { config: makeConfig(name), status };
}

function createMockAgentManager(): AgentManager {
	const streamCallbacks = new Set<(chunk: { agentName: string; text: string; done: boolean }) => void>();

	return {
		onStream: vi.fn((cb) => {
			streamCallbacks.add(cb);
			return () => streamCallbacks.delete(cb);
		}),
		spawnAgent: vi.fn(async (config: AgentConfig) => makeAgentState(config.name)),
		sendPrompt: vi.fn(async () => undefined),
		cancelAgent: vi.fn(async () => {}),
		killAgent: vi.fn(async () => {}),
		killAll: vi.fn(async () => {}),
		getAgent: vi.fn(() => undefined),
		getActiveAgents: vi.fn(() => []),
		getAllAgents: vi.fn(() => []),
	} as unknown as AgentManager;
}

// ---------------------------------------------------------------------------
// parseMentions
// ---------------------------------------------------------------------------

describe("parseMentions", () => {
	const agentNames = ["claude", "codex", "gemini"];

	it("parses a single @mention from start of message", () => {
		const result = parseMentions("@claude what do you think?", agentNames);
		expect(result.mentions).toEqual(["claude"]);
		expect(result.body).toBe("what do you think?");
	});

	it("parses multiple @mentions from start of message", () => {
		const result = parseMentions("@claude @codex review this", agentNames);
		expect(result.mentions).toEqual(["claude", "codex"]);
		expect(result.body).toBe("review this");
	});

	it("is case insensitive", () => {
		const result = parseMentions("@Claude hello", agentNames);
		expect(result.mentions).toEqual(["claude"]);
		expect(result.body).toBe("hello");
	});

	it("returns empty mentions for no @mentions", () => {
		const result = parseMentions("just a regular message", agentNames);
		expect(result.mentions).toEqual([]);
		expect(result.body).toBe("just a regular message");
	});

	it("does not match email addresses", () => {
		const result = parseMentions("send to user@claude.com please", agentNames);
		expect(result.mentions).toEqual([]);
		expect(result.body).toBe("send to user@claude.com please");
	});

	it("does not match @name mid-word (e.g., @claudeExtra should not match claude)", () => {
		const result = parseMentions("@claudeExtra some text", agentNames);
		expect(result.mentions).toEqual([]);
		expect(result.body).toBe("@claudeExtra some text");
	});

	it("returns original text as body when mentions consume entire input", () => {
		const result = parseMentions("@claude", agentNames);
		expect(result.mentions).toEqual(["claude"]);
		expect(result.body).toBe("@claude");
	});
});

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

describe("Orchestrator", () => {
	let orchestrator: Orchestrator;
	let mockManager: AgentManager;

	beforeEach(() => {
		mockManager = createMockAgentManager();
		orchestrator = new Orchestrator("/tmp/test", mockManager);
	});

	// -- muteAgent / unmuteAgent ---------------------------------------------

	describe("muteAgent", () => {
		it("returns true for a known agent", async () => {
			await orchestrator.start([makeConfig("claude")]);
			expect(orchestrator.muteAgent("claude")).toBe(true);
		});

		it("returns false for an unknown agent", () => {
			expect(orchestrator.muteAgent("nonexistent")).toBe(false);
		});

		it("sets agent status to 'muted'", async () => {
			await orchestrator.start([makeConfig("claude")]);
			orchestrator.muteAgent("claude");
			const state = orchestrator.getState().agents.get("claude");
			expect(state?.status).toBe("muted");
		});
	});

	describe("unmuteAgent", () => {
		it("returns true if the agent was muted", async () => {
			await orchestrator.start([makeConfig("claude")]);
			orchestrator.muteAgent("claude");
			expect(orchestrator.unmuteAgent("claude")).toBe(true);
		});

		it("returns false if the agent was not muted", async () => {
			await orchestrator.start([makeConfig("claude")]);
			expect(orchestrator.unmuteAgent("claude")).toBe(false);
		});

		it("sets agent status to 'active'", async () => {
			await orchestrator.start([makeConfig("claude")]);
			orchestrator.muteAgent("claude");
			orchestrator.unmuteAgent("claude");
			const state = orchestrator.getState().agents.get("claude");
			expect(state?.status).toBe("active");
		});
	});

	// -- isActive / stop -----------------------------------------------------

	describe("isActive", () => {
		it("returns false before start", () => {
			expect(orchestrator.isActive()).toBe(false);
		});

		it("returns true after start", async () => {
			await orchestrator.start([makeConfig("claude")]);
			expect(orchestrator.isActive()).toBe(true);
		});
	});

	describe("stop", () => {
		it("sets active to false", async () => {
			await orchestrator.start([makeConfig("claude")]);
			expect(orchestrator.isActive()).toBe(true);
			await orchestrator.stop();
			expect(orchestrator.isActive()).toBe(false);
		});

		it("calls killAll on agent manager", async () => {
			await orchestrator.start([makeConfig("claude")]);
			await orchestrator.stop();
			expect(mockManager.killAll).toHaveBeenCalled();
		});
	});

	// -- getMessages ---------------------------------------------------------

	describe("getMessages", () => {
		it("returns message history after sendMessage", async () => {
			await orchestrator.start([makeConfig("claude")]);
			await orchestrator.sendMessage("hello world");
			const messages = orchestrator.getMessages();
			expect(messages).toHaveLength(1);
			expect(messages[0].source).toBe("user");
			expect(messages[0].content).toBe("hello world");
			expect(messages[0].timestamp).toBeGreaterThan(0);
		});

		it("returns empty array initially", () => {
			expect(orchestrator.getMessages()).toEqual([]);
		});
	});

	// -- toJSON --------------------------------------------------------------

	describe("toJSON", () => {
		it("serializes correctly", async () => {
			await orchestrator.start([makeConfig("claude"), makeConfig("codex")]);
			orchestrator.muteAgent("codex");
			await orchestrator.sendMessage("test message");

			const json = orchestrator.toJSON();

			expect(json.agents).toEqual({ claude: "claude", codex: "codex" });
			expect(json.mutedAgents).toEqual(["codex"]);
			expect(json.messages).toHaveLength(1);
			expect(json.messages[0].source).toBe("user");
			expect(json.messages[0].content).toBe("test message");
		});

		it("serializes empty state correctly", () => {
			const json = orchestrator.toJSON();
			expect(json.agents).toEqual({});
			expect(json.mutedAgents).toEqual([]);
			expect(json.messages).toEqual([]);
		});
	});

	// -- start ---------------------------------------------------------------

	describe("start", () => {
		it("spawns agents and emits agent_status events", async () => {
			const events: OrchestratorEvent[] = [];
			orchestrator.onEvent((e) => events.push(e));

			await orchestrator.start([makeConfig("claude"), makeConfig("codex")]);

			expect(mockManager.spawnAgent).toHaveBeenCalledTimes(2);
			expect(events.filter((e) => e.type === "agent_status")).toHaveLength(2);
		});

		it("emits error event when agent fails to spawn", async () => {
			(mockManager.spawnAgent as ReturnType<typeof vi.fn>).mockResolvedValueOnce(makeAgentState("claude", "error"));

			const events: OrchestratorEvent[] = [];
			orchestrator.onEvent((e) => events.push(e));

			await orchestrator.start([makeConfig("claude")]);

			const errorEvents = events.filter((e) => e.type === "error");
			expect(errorEvents).toHaveLength(1);
		});
	});

	// -- onEvent / unsubscribe -----------------------------------------------

	describe("onEvent", () => {
		it("returns an unsubscribe function", async () => {
			const events: OrchestratorEvent[] = [];
			const unsub = orchestrator.onEvent((e) => events.push(e));

			await orchestrator.start([makeConfig("claude")]);
			expect(events.length).toBeGreaterThan(0);

			const countBefore = events.length;
			unsub();

			await orchestrator.start([makeConfig("codex")]);
			expect(events.length).toBe(countBefore);
		});
	});

	// -- sendMessage ---------------------------------------------------------

	describe("sendMessage", () => {
		it("does nothing when not active", async () => {
			await orchestrator.sendMessage("hello");
			expect(orchestrator.getMessages()).toEqual([]);
		});

		it("sends prompt to all unmuted agents when no mentions", async () => {
			await orchestrator.start([makeConfig("claude"), makeConfig("codex")]);
			await orchestrator.sendMessage("hello everyone");

			expect(mockManager.sendPrompt).toHaveBeenCalledTimes(2);
		});

		it("sends prompt only to mentioned agents", async () => {
			await orchestrator.start([makeConfig("claude"), makeConfig("codex")]);
			await orchestrator.sendMessage("@claude what do you think?");

			expect(mockManager.sendPrompt).toHaveBeenCalledTimes(1);
			expect(mockManager.sendPrompt).toHaveBeenCalledWith("claude", expect.any(Array));
		});

		it("skips muted agents when no mentions", async () => {
			await orchestrator.start([makeConfig("claude"), makeConfig("codex")]);
			orchestrator.muteAgent("codex");
			await orchestrator.sendMessage("hello");

			expect(mockManager.sendPrompt).toHaveBeenCalledTimes(1);
			expect(mockManager.sendPrompt).toHaveBeenCalledWith("claude", expect.any(Array));
		});
	});

	// -- addAgent / removeAgent / restartAgent --------------------------------

	describe("addAgent", () => {
		it("adds a new agent to state", async () => {
			await orchestrator.addAgent(makeConfig("newagent"));
			expect(orchestrator.getState().agents.has("newagent")).toBe(true);
		});
	});

	describe("removeAgent", () => {
		it("removes agent from state and muted set", async () => {
			await orchestrator.start([makeConfig("claude")]);
			orchestrator.muteAgent("claude");
			await orchestrator.removeAgent("claude");

			expect(orchestrator.getState().agents.has("claude")).toBe(false);
			expect(mockManager.killAgent).toHaveBeenCalledWith("claude");
		});
	});

	describe("restartAgent", () => {
		it("removes and re-adds the agent", async () => {
			const conn = { config: makeConfig("claude") };
			(mockManager.getAgent as ReturnType<typeof vi.fn>).mockReturnValue(conn);

			await orchestrator.start([makeConfig("claude")]);
			await orchestrator.restartAgent("claude");

			expect(mockManager.killAgent).toHaveBeenCalledWith("claude");
			// spawnAgent called once during start + once during restartAgent addAgent
			expect(mockManager.spawnAgent).toHaveBeenCalledTimes(2);
		});

		it("is a no-op for unknown agents", async () => {
			(mockManager.getAgent as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
			await orchestrator.restartAgent("nonexistent");
			expect(mockManager.killAgent).not.toHaveBeenCalled();
		});
	});
});
