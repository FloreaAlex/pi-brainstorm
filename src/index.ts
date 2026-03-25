/**
 * Brainstorm extension entry point.
 *
 * Registers slash commands, intercepts user input during active sessions,
 * and wires the orchestrator to the TUI renderer.
 */

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	InputEvent,
	InputEventResult,
} from "@mariozechner/pi-coding-agent";
import { Orchestrator } from "./orchestrator.js";
import { BrainstormRenderer } from "./renderer.js";
import { type AgentConfig, DEFAULT_AGENTS } from "./types.js";

/** Custom entry type for session persistence. */
const BRAINSTORM_ENTRY_TYPE = "brainstorm_state";

/**
 * Extension factory. Called once during extension loading.
 */
export function brainstormExtension(api: ExtensionAPI): void {
	let orchestrator: Orchestrator | null = null;
	let renderer: BrainstormRenderer | null = null;
	let unsubOrchestrator: (() => void) | null = null;

	// ── Helpers ──────────────────────────────────────────────────────────

	function isActive(): boolean {
		return orchestrator?.isActive() ?? false;
	}

	function agentNames(): string[] {
		if (!orchestrator) return [];
		return [...orchestrator.getState().agents.keys()];
	}

	async function startSession(ctx: ExtensionContext, configs: AgentConfig[]): Promise<void> {
		if (isActive()) {
			ctx.ui.notify("Brainstorm session already active. Use /brainstorm stop to end it.", "warning");
			return;
		}

		renderer = new BrainstormRenderer();
		orchestrator = new Orchestrator(ctx.cwd);

		// Register agent configs with the renderer for color/label lookup
		for (const config of configs) {
			renderer.registerAgent(config);
		}

		// Wire orchestrator events to the renderer.
		// After updating renderer state, we call setStatus to trigger a TUI re-render,
		// since the extension API has no direct requestRender() method.
		unsubOrchestrator = orchestrator.onEvent((event) => {
			if (!renderer) return;

			switch (event.type) {
				case "stream":
					renderer.onStreamChunk(event.agentName, event.text);
					// Trigger TUI re-render so the new text appears
					ctx.ui.setStatus("brainstorm:stream", `${event.agentName}: streaming...`);
					break;
				case "done":
					renderer.onAgentDone(event.agentName);
					ctx.ui.setStatus(`brainstorm:${event.agentName}`, `${event.agentName}: done`);
					break;
				case "all_done":
					renderer.collapseSplitView();
					ctx.ui.setStatus("brainstorm:stream", undefined);
					break;
				case "error":
					ctx.ui.notify(`Agent ${event.agentName}: ${event.message}`, "error");
					break;
				case "agent_status":
					ctx.ui.setStatus(`brainstorm:${event.agentName}`, `${event.agentName}: ${event.status}`);
					break;
			}
		});

		// Mount the renderer container as a widget
		ctx.ui.setWidget("brainstorm", (_tui, _theme) => renderer!.getContainer(), { placement: "aboveEditor" });
		ctx.ui.setStatus("brainstorm", "Brainstorm: starting agents...");

		await orchestrator.start(configs);

		const activeNames = agentNames();
		ctx.ui.setStatus("brainstorm", `Brainstorm: ${activeNames.join(", ")}`);
		ctx.ui.notify(`Brainstorm started with ${activeNames.length} agent(s): ${activeNames.join(", ")}`, "info");

		// Persist state
		api.appendEntry(BRAINSTORM_ENTRY_TYPE, orchestrator.toJSON());
	}

	async function stopSession(ctx: ExtensionContext): Promise<void> {
		if (!isActive()) {
			ctx.ui.notify("No active brainstorm session.", "warning");
			return;
		}

		// Capture agent names and final state before teardown
		const names = agentNames();
		const finalState = orchestrator!.toJSON();

		await orchestrator!.stop();

		// Clean up event subscription
		if (unsubOrchestrator) {
			unsubOrchestrator();
			unsubOrchestrator = null;
		}

		// Remove widget and status
		ctx.ui.setWidget("brainstorm", undefined);
		ctx.ui.setStatus("brainstorm", undefined);
		for (const name of names) {
			ctx.ui.setStatus(`brainstorm:${name}`, undefined);
		}

		// Persist final state
		api.appendEntry(BRAINSTORM_ENTRY_TYPE, finalState);

		orchestrator = null;
		renderer = null;

		ctx.ui.notify("Brainstorm session ended.", "info");
	}

	// ── Commands ─────────────────────────────────────────────────────────

	api.registerCommand("brainstorm", {
		description: "Start or stop a brainstorm session with AI agents",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const trimmed = args.trim().toLowerCase();

			if (trimmed === "stop") {
				await stopSession(ctx);
				return;
			}

			// Resolve agent configs. Accept space-separated agent names or use defaults.
			let configs: AgentConfig[];
			if (trimmed) {
				const requestedNames = trimmed.split(/\s+/);
				configs = [];
				for (const name of requestedNames) {
					const config = DEFAULT_AGENTS[name];
					if (config) {
						configs.push(config);
					} else {
						ctx.ui.notify(
							`Unknown agent: ${name}. Available: ${Object.keys(DEFAULT_AGENTS).join(", ")}`,
							"warning",
						);
					}
				}
				if (configs.length === 0) return;
			} else {
				configs = Object.values(DEFAULT_AGENTS);
			}

			await startSession(ctx, configs);
		},
	});

	api.registerCommand("agents", {
		description: "List brainstorm agent status",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			if (!isActive()) {
				ctx.ui.notify("No active brainstorm session.", "warning");
				return;
			}

			const state = orchestrator!.getState();
			const lines: string[] = [];
			for (const [name, agentState] of state.agents) {
				lines.push(`${agentState.config.label} (${name}): ${agentState.status}`);
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	api.registerCommand("mute", {
		description: "Mute a brainstorm agent",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			if (!isActive()) {
				ctx.ui.notify("No active brainstorm session.", "warning");
				return;
			}

			const name = args.trim().toLowerCase();
			if (!name) {
				ctx.ui.notify("Usage: /mute <agent-name>", "warning");
				return;
			}

			const success = orchestrator!.muteAgent(name);
			if (success) {
				ctx.ui.notify(`Muted agent: ${name}`, "info");
				ctx.ui.setStatus(`brainstorm:${name}`, `${name}: muted`);
			} else {
				ctx.ui.notify(`Agent not found: ${name}. Active: ${agentNames().join(", ")}`, "warning");
			}
		},
	});

	api.registerCommand("unmute", {
		description: "Unmute a brainstorm agent",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			if (!isActive()) {
				ctx.ui.notify("No active brainstorm session.", "warning");
				return;
			}

			const name = args.trim().toLowerCase();
			if (!name) {
				ctx.ui.notify("Usage: /unmute <agent-name>", "warning");
				return;
			}

			const success = orchestrator!.unmuteAgent(name);
			if (success) {
				ctx.ui.notify(`Unmuted agent: ${name}`, "info");
				ctx.ui.setStatus(`brainstorm:${name}`, `${name}: active`);
			} else {
				ctx.ui.notify(`Agent not muted or not found: ${name}`, "warning");
			}
		},
	});

	api.registerCommand("restart", {
		description: "Restart a brainstorm agent",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			if (!isActive()) {
				ctx.ui.notify("No active brainstorm session.", "warning");
				return;
			}

			const name = args.trim().toLowerCase();
			if (!name) {
				ctx.ui.notify("Usage: /restart <agent-name>", "warning");
				return;
			}

			if (!orchestrator!.getState().agents.has(name)) {
				ctx.ui.notify(`Agent not found: ${name}. Active: ${agentNames().join(", ")}`, "warning");
				return;
			}

			ctx.ui.setStatus(`brainstorm:${name}`, `${name}: restarting...`);
			await orchestrator!.restartAgent(name);
			ctx.ui.setStatus(`brainstorm:${name}`, `${name}: active`);
			ctx.ui.notify(`Restarted agent: ${name}`, "info");
		},
	});

	// ── Input interception ──────────────────────────────────────────────

	api.on("input", (event: InputEvent): InputEventResult => {
		if (!isActive()) {
			return { action: "continue" };
		}

		// Don't intercept slash commands — let them through
		if (event.text.startsWith("/")) {
			return { action: "continue" };
		}

		// Route to brainstorm orchestrator
		const text = event.text;

		// Show the user message in the renderer
		if (renderer) {
			renderer.addUserMessage(text);

			// Start streaming blocks for responding agents
			const names = agentNames().filter((n) => {
				const state = orchestrator!.getState().agents.get(n);
				return state && state.status === "active";
			});
			if (names.length > 0) {
				renderer.startStreaming(names);
			}
		}

		// Send to orchestrator (fire-and-forget; streaming handled via events)
		orchestrator!.sendMessage(text).catch((err) => {
			// Error is surfaced via orchestrator error events
			console.error("Brainstorm send error:", err);
		});

		// Persist updated state
		api.appendEntry(BRAINSTORM_ENTRY_TYPE, orchestrator!.toJSON());

		return { action: "handled" };
	});

	// ── Cleanup on session shutdown ─────────────────────────────────────

	api.on("session_shutdown", async () => {
		if (orchestrator?.isActive()) {
			await orchestrator.stop();
		}
		if (unsubOrchestrator) {
			unsubOrchestrator();
			unsubOrchestrator = null;
		}
		orchestrator = null;
		renderer = null;
	});

	// ── Resume on session start ─────────────────────────────────────────

	api.on("session_start", async (_event, ctx) => {
		// Scan session entries for the last brainstorm_state custom entry
		const entries = ctx.sessionManager.getEntries();
		let lastBrainstormState: ReturnType<Orchestrator["toJSON"]> | null = null;

		for (const entry of entries) {
			if (entry.type === "custom" && entry.customType === BRAINSTORM_ENTRY_TYPE) {
				lastBrainstormState = entry.data as ReturnType<Orchestrator["toJSON"]>;
			}
		}

		if (!lastBrainstormState?.messages?.length) return;

		// Offer to resume
		const resume = await ctx.ui.confirm(
			"Brainstorm Session",
			`Found previous brainstorm with ${lastBrainstormState.messages.length} messages. Resume?`,
		);

		if (!resume) return;

		// Resolve agent configs from saved agent names
		const configs: AgentConfig[] = [];
		for (const agentName of Object.values(lastBrainstormState.agents)) {
			const config = DEFAULT_AGENTS[agentName];
			if (config) configs.push(config);
		}

		if (configs.length === 0) {
			ctx.ui.notify("Could not find agent configs for resume. Starting fresh.", "warning");
			return;
		}

		// Start session with saved agents
		await startSession(ctx, configs);

		// Replay history in the renderer
		if (renderer && lastBrainstormState.messages.length > 0) {
			renderer.replayHistory(lastBrainstormState.messages);
		}

		// Restore mute state
		if (lastBrainstormState.mutedAgents) {
			for (const name of lastBrainstormState.mutedAgents) {
				orchestrator?.muteAgent(name);
			}
		}

		// Restore messages in orchestrator so subsequent messages include full context
		if (orchestrator) {
			const state = orchestrator.getState();
			state.messages = [...lastBrainstormState.messages];
		}
	});
}
