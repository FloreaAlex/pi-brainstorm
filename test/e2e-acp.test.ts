/**
 * E2E tests for the brainstorm extension ACP integration.
 *
 * These tests spawn real ACP agents (claude-agent-acp, codex-acp) as subprocesses
 * and verify the full communication flow. They require the ACP bridges to be installed.
 *
 * Skip with: SKIP_ACP_E2E=1 npx vitest run ...
 */

import { execSync } from "node:child_process";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AgentManager } from "../src/agents.js";
import { Orchestrator, parseMentions } from "../src/orchestrator.js";
import {
	buildAgentPrompt,
	interpolatePrompt,
	loadPromptTemplate,
	parsePromptTemplate,
} from "../src/prompt.js";
import { BrainstormRenderer } from "../src/renderer.js";
import { DEFAULT_AGENTS, type StreamChunk } from "../src/types.js";

// ── Helpers ───────────────────────────────────────────────────────────

function hasBinary(name: string): boolean {
	try {
		execSync(`which ${name}`, { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

const hasClaudeBridge = hasBinary("claude-agent-acp");
const hasCodexBridge = hasBinary("codex-acp");
const skipAcp = process.env.SKIP_ACP_E2E === "1";

// ── Test: Prompt system ──────────────────────────────────────────────

describe("brainstorm e2e: prompt system", () => {
	it("loads and interpolates the default PROMPT.md", () => {
		const raw = loadPromptTemplate("/tmp/nonexistent-project");
		expect(raw).toContain("{{agent_name}}");
		expect(raw).toContain("brainstorming session");

		const { body } = parsePromptTemplate(raw);
		expect(body).not.toContain("---");
		expect(body).toContain("{{agent_name}}");

		const prompt = interpolatePrompt(body, {
			agent_name: "claude",
			agent_label: "Claude",
			participants: "Claude, Codex, Human",
			working_directory: "/tmp/test",
		});

		expect(prompt).toContain("You are: claude (Claude)");
		expect(prompt).toContain("Claude, Codex, Human");
		expect(prompt).toContain("/tmp/test");
		expect(prompt).not.toContain("{{");
	});

	it("buildAgentPrompt produces a complete prompt", () => {
		const prompt = buildAgentPrompt("/tmp/test", "codex", "Codex", ["Claude", "Codex", "Human"]);
		expect(prompt).toContain("You are: codex (Codex)");
		expect(prompt).toContain("read files, search code");
		expect(prompt).toContain("cannot edit files");
	});
});

// ── Test: Renderer ───────────────────────────────────────────────────

describe("brainstorm e2e: renderer", () => {
	it("registers agents and renders user messages", () => {
		const renderer = new BrainstormRenderer();
		renderer.registerAgent(DEFAULT_AGENTS.claude);
		renderer.registerAgent(DEFAULT_AGENTS.codex);

		renderer.addUserMessage("Hello brainstorm!");
		const container = renderer.getContainer();
		expect(container.children.length).toBeGreaterThanOrEqual(1);
	});

	it("starts streaming with two agents", () => {
		const renderer = new BrainstormRenderer();
		renderer.registerAgent(DEFAULT_AGENTS.claude);
		renderer.registerAgent(DEFAULT_AGENTS.codex);

		renderer.startStreaming(["claude", "codex"]);
		const container = renderer.getContainer();
		// Should have added either a SplitColumn or individual blocks
		expect(container.children.length).toBeGreaterThan(0);
	});

	it("feeds stream chunks to agent blocks", () => {
		const renderer = new BrainstormRenderer();
		renderer.registerAgent(DEFAULT_AGENTS.claude);
		renderer.startStreaming(["claude"]);

		// Should not throw
		renderer.onStreamChunk("claude", "Hello ");
		renderer.onStreamChunk("claude", "world!");
		renderer.onAgentDone("claude");
	});

	it("replays history", () => {
		const renderer = new BrainstormRenderer();
		renderer.registerAgent(DEFAULT_AGENTS.claude);
		renderer.registerAgent(DEFAULT_AGENTS.codex);

		renderer.replayHistory([
			{ source: "user", content: "What do you think?", timestamp: 1 },
			{ source: "claude", content: "I think X", timestamp: 2 },
			{ source: "codex", content: "I think Y", timestamp: 3 },
		]);

		const container = renderer.getContainer();
		expect(container.children.length).toBeGreaterThanOrEqual(3);
	});
});

// ── Test: @mention parsing ───────────────────────────────────────────

describe("brainstorm e2e: mention parsing", () => {
	const agents = ["claude", "codex"];

	it("handles @claude at start", () => {
		const { mentions, body } = parseMentions("@claude what do you think?", agents);
		expect(mentions).toEqual(["claude"]);
		expect(body).toBe("what do you think?");
	});

	it("handles @codex at start", () => {
		const { mentions, body } = parseMentions("@codex tell me more", agents);
		expect(mentions).toEqual(["codex"]);
		expect(body).toBe("tell me more");
	});

	it("handles no mention", () => {
		const { mentions, body } = parseMentions("tell me about the architecture", agents);
		expect(mentions).toEqual([]);
		expect(body).toBe("tell me about the architecture");
	});

	it("is case insensitive", () => {
		const { mentions } = parseMentions("@Claude hello", agents);
		expect(mentions).toEqual(["claude"]);
	});
});

// ── Test: AgentManager with real ACP bridges ─────────────────────────

describe.skipIf(skipAcp || !hasClaudeBridge)("brainstorm e2e: claude-agent-acp connection", () => {
	let manager: AgentManager;

	beforeAll(() => {
		manager = new AgentManager();
	});

	afterAll(async () => {
		await manager.killAll();
	});

	it("spawns and initializes claude-agent-acp", async () => {
		const state = await manager.spawnAgent(DEFAULT_AGENTS.claude, process.cwd());
		expect(state.status).toBe("active");
		expect(state.sessionId).toBeDefined();
	}, 30_000);

	it("receives streaming response from claude", async () => {
		const chunks: StreamChunk[] = [];
		const unsub = manager.onStream((chunk) => {
			if (chunk.agentName === "claude") chunks.push(chunk);
		});

		const result = await manager.sendPrompt("claude", [{ type: "text", text: "Say exactly: hello brainstorm" }]);

		unsub();

		expect(result).toBeDefined();
		const fullText = chunks
			.filter((c) => !c.done)
			.map((c) => c.text)
			.join("");
		expect(fullText.toLowerCase()).toContain("hello");
	}, 60_000);

	it("kills claude agent cleanly", async () => {
		await manager.killAgent("claude");
		expect(manager.getAgent("claude")).toBeUndefined();
	});
});

describe.skipIf(skipAcp || !hasCodexBridge)("brainstorm e2e: codex-acp connection", () => {
	let manager: AgentManager;

	beforeAll(() => {
		manager = new AgentManager();
	});

	afterAll(async () => {
		await manager.killAll();
	});

	it("spawns and initializes codex-acp", async () => {
		const state = await manager.spawnAgent(DEFAULT_AGENTS.codex, process.cwd());
		expect(state.status).toBe("active");
		expect(state.sessionId).toBeDefined();
	}, 30_000);

	it("receives streaming response from codex", async () => {
		const chunks: StreamChunk[] = [];
		const unsub = manager.onStream((chunk) => {
			if (chunk.agentName === "codex") chunks.push(chunk);
		});

		const result = await manager.sendPrompt("codex", [{ type: "text", text: "Say exactly: hello brainstorm" }]);

		unsub();

		expect(result).toBeDefined();
		const fullText = chunks
			.filter((c) => !c.done)
			.map((c) => c.text)
			.join("");
		expect(fullText.toLowerCase()).toContain("hello");
	}, 60_000);

	it("kills codex agent cleanly", async () => {
		await manager.killAgent("codex");
		expect(manager.getAgent("codex")).toBeUndefined();
	});
});

// ── Test: Full orchestrator with real agents ─────────────────────────

describe.skipIf(skipAcp || !hasClaudeBridge || !hasCodexBridge)("brainstorm e2e: full orchestrator flow", () => {
	let orchestrator: Orchestrator;

	afterEach(async () => {
		if (orchestrator?.isActive()) {
			await orchestrator.stop();
		}
	});

	it("starts with both agents", async () => {
		orchestrator = new Orchestrator(process.cwd());
		const events: string[] = [];
		orchestrator.onEvent((e) => {
			events.push(`${e.type}:${"agentName" in e ? e.agentName : ""}`);
		});

		await orchestrator.start(Object.values(DEFAULT_AGENTS));

		expect(orchestrator.isActive()).toBe(true);
		const state = orchestrator.getState();
		expect(state.agents.size).toBe(2);
		expect(events).toContain("agent_status:claude");
		expect(events).toContain("agent_status:codex");
	}, 90_000);

	it("sends message and both agents respond", async () => {
		orchestrator = new Orchestrator(process.cwd());
		await orchestrator.start(Object.values(DEFAULT_AGENTS));

		const events: string[] = [];
		orchestrator.onEvent((e) => events.push(e.type));

		await orchestrator.sendMessage("Say hello in one word");

		const messages = orchestrator.getMessages();
		// Should have user message + at least one agent response
		expect(messages.length).toBeGreaterThanOrEqual(2);
		expect(messages[0].source).toBe("user");

		// Should have received stream and done events
		expect(events).toContain("stream");
		expect(events).toContain("done");
		expect(events).toContain("all_done");
	}, 120_000);

	it("mute/unmute works", async () => {
		orchestrator = new Orchestrator(process.cwd());
		await orchestrator.start(Object.values(DEFAULT_AGENTS));

		expect(orchestrator.muteAgent("codex")).toBe(true);

		await orchestrator.sendMessage("Say hi");
		const messages = orchestrator.getMessages();
		// Only claude should have responded (user + claude = 2 messages for this turn)
		const agentResponses = messages.filter((m) => m.source !== "user");
		const codexResponses = agentResponses.filter((m) => m.source === "codex");
		expect(codexResponses.length).toBe(0);

		expect(orchestrator.unmuteAgent("codex")).toBe(true);
	}, 60_000);

	it("@mention routes to specific agent", async () => {
		orchestrator = new Orchestrator(process.cwd());
		await orchestrator.start(Object.values(DEFAULT_AGENTS));

		await orchestrator.sendMessage("@claude say hi");
		const messages = orchestrator.getMessages();
		const agentResponses = messages.filter((m) => m.source !== "user");
		// Only claude should respond to @mention
		const respondingSources = new Set(agentResponses.map((m) => m.source));
		expect(respondingSources.has("claude")).toBe(true);
		expect(respondingSources.has("codex")).toBe(false);
	}, 60_000);

	it("serializes state with toJSON", async () => {
		orchestrator = new Orchestrator(process.cwd());
		await orchestrator.start(Object.values(DEFAULT_AGENTS));

		await orchestrator.sendMessage("test message");

		const json = orchestrator.toJSON();
		expect(json.messages.length).toBeGreaterThan(0);
		expect(json.agents).toBeDefined();
		expect(json.mutedAgents).toEqual([]);
	}, 60_000);

	it("stops cleanly", async () => {
		orchestrator = new Orchestrator(process.cwd());
		await orchestrator.start(Object.values(DEFAULT_AGENTS));

		await orchestrator.stop();
		expect(orchestrator.isActive()).toBe(false);
	}, 30_000);
});
