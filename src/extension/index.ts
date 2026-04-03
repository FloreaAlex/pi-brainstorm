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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { Orchestrator, parseMentions } from "./orchestrator.js";
import { BrainstormRenderer } from "./renderer.js";
import type { AgentConfig } from "./types.js";
import { resolveAgentConfigs } from "../config.js";

/** Persist brainstorm state to a file so it survives pi crashes. */
function getStateFilePath(cwd: string): string {
	const dir = join(cwd, ".pi", "brainstorm");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return join(dir, "state.json");
}

function saveState(cwd: string, state: ReturnType<Orchestrator["toJSON"]>): void {
	try { writeFileSync(getStateFilePath(cwd), JSON.stringify(state, null, 2)); } catch {}
}

function loadState(cwd: string): ReturnType<Orchestrator["toJSON"]> | null {
	try {
		const raw = readFileSync(getStateFilePath(cwd), "utf-8");
		return JSON.parse(raw);
	} catch { return null; }
}

/** Custom entry type for session persistence. */
const BRAINSTORM_ENTRY_TYPE = "brainstorm_state";

/**
 * Extension factory. Called once during extension loading.
 */
export default function brainstormExtension(api: ExtensionAPI): void {
	let orchestrator: Orchestrator | null = null;
	let renderer: BrainstormRenderer | null = null;
	let unsubOrchestrator: (() => void) | null = null;
	let unsubKeyHandler: (() => void) | null = null;
	let sessionUi: ExtensionContext["ui"] | null = null;
	let sessionCwd: string | null = null;
	let spinnerInterval: NodeJS.Timeout | null = null;
	let autoStatusSuffix: string | null = null;

	// ── Helpers ──────────────────────────────────────────────────────────

	function isActive(): boolean {
		return orchestrator?.isActive() ?? false;
	}

	function tokenLabel(): string {
		if (!orchestrator) return "";
		const tokens = orchestrator.getTokenEstimate();
		let display: string;
		if (tokens >= 1000) {
			display = `${(tokens / 1000).toFixed(1)}k`;
		} else {
			display = String(tokens);
		}
		return chalk.dim(` ~${display} tokens`);
	}

	function statusText(suffix?: string): string {
		const label = chalk.magenta.bold("\u26A1 Brainstorm");
		const tokens = tokenLabel();
		if (suffix) return `${label} ${chalk.dim(suffix)}${tokens}`;
		const names = agentNames().map((n) => {
			const state = orchestrator?.getState().agents.get(n);
			const color = state?.config.color;
			const info = state?.sessionInfo;
			const nameStr = color ? chalk.hex(color)(n) : n;

			// Show actual model and thinking level from ACP session
			const model = info?.model ?? state?.config.preferredModel;
			const parts = [nameStr];
			if (model) {
				const short = model.replace(/^claude-/, "").replace(/^gemini-/, "").replace(/^gpt-/, "");
				parts.push(chalk.dim(short));
			}
			if (info?.thoughtLevel) {
				parts.push(chalk.dim(`\u{1F4AD}${info.thoughtLevel}`));
			}
			return parts.join(chalk.dim(":"));
		});
		return `${label} ${chalk.dim("[")}${names.join(chalk.dim(", "))}${chalk.dim("]")}${tokens}`;
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
		sessionUi = ctx.ui;
		sessionCwd = ctx.cwd;

		renderer = new BrainstormRenderer();
		orchestrator = new Orchestrator(ctx.cwd);

		// Register agent configs with the renderer for color/label lookup
		for (const config of configs) {
			renderer.registerAgent(config);
		}

		// Wire orchestrator events to the renderer.
		// We use a single setStatus key "brainstorm" to trigger TUI re-renders.
		unsubOrchestrator = orchestrator.onEvent((event) => {
			if (!renderer) return;

			switch (event.type) {
				case "stream":
					renderer.onStreamChunk(event.agentName, event.text, event.kind);
					ctx.ui.setStatus("brainstorm", statusText(`${event.agentName} ${event.kind === "thought" ? "thinking..." : "streaming..."}`));
					break;
				case "done":
					renderer.onAgentDone(event.agentName);
					ctx.ui.setStatus("brainstorm", statusText());
					// Save after each agent response so state survives unexpected exits
					if (sessionCwd && orchestrator) saveState(sessionCwd, orchestrator.toJSON());
					break;
				case "all_done":
					renderer.collapseSplitView();
					if (spinnerInterval) { clearInterval(spinnerInterval); spinnerInterval = null; }
					ctx.ui.setStatus("brainstorm", statusText());
					// Save state after all agents have responded
					if (sessionCwd && orchestrator) saveState(sessionCwd, orchestrator.toJSON());
					break;
				case "error":
					ctx.ui.notify(`Agent ${event.agentName}: ${event.message}`, "error");
					break;
				case "agent_status":
					ctx.ui.setStatus("brainstorm", statusText());
					break;
				case "auto_turn_start":
					renderer.startAutoTurn(event.agentName);
					autoStatusSuffix = `AUTO ${event.turn}/${event.totalTurns} ${event.agentName}'s turn`;
					// Start spinner timer for auto mode
					if (!spinnerInterval) {
						spinnerInterval = setInterval(() => {
							sessionUi?.setStatus("brainstorm", statusText(autoStatusSuffix ?? undefined));
						}, 80);
					}
					ctx.ui.setStatus("brainstorm", statusText(autoStatusSuffix));
					break;
				case "auto_turn_end":
					renderer.endAutoTurn(event.agentName);
					autoStatusSuffix = null;
					break;
				case "auto_complete":
					autoStatusSuffix = null;
					if (spinnerInterval) { clearInterval(spinnerInterval); spinnerInterval = null; }
					renderer.addSystemMessage("AUTO complete");
					ctx.ui.setStatus("brainstorm", statusText());
					if (sessionCwd && orchestrator) saveState(sessionCwd, orchestrator.toJSON());
					break;

			}
		});

		// Mount the renderer container as a widget
		ctx.ui.setWidget("brainstorm", (_tui, _theme) => renderer!.getContainer(), { placement: "aboveEditor" });
		ctx.ui.setStatus("brainstorm", statusText("connecting..."));

		// Cmd+E / Ctrl+E toggles reasoning visibility
		unsubKeyHandler = ctx.ui.onTerminalInput((data: string) => {
			if (data === "\x05" && renderer) {
				// Ctrl+E toggles reasoning blocks
				renderer.toggleThoughts();
				sessionUi?.setStatus("brainstorm", statusText());
				return { consume: true };
			}
			return {};
		});

		await orchestrator.start(configs);

		const activeNames = agentNames();
		ctx.ui.setStatus("brainstorm", `Brainstorm: ${activeNames.join(", ")}`);
		ctx.ui.notify(`Brainstorm started with ${activeNames.length} agent(s): ${activeNames.join(", ")}`, "info");

		// Persist state
		api.appendEntry(BRAINSTORM_ENTRY_TYPE, orchestrator.toJSON());
		saveState(ctx.cwd, orchestrator.toJSON());
	}

	async function stopSession(ctx: ExtensionContext): Promise<void> {
		if (!isActive()) {
			ctx.ui.notify("Not in brainstorm mode. Start one with /brainstorm first.", "warning");
			return;
		}

		// Capture agent names and final state before teardown
		const names = agentNames();
		const finalState = orchestrator!.toJSON();

		await orchestrator!.stop();

		// Clean up subscriptions
		if (unsubOrchestrator) {
			unsubOrchestrator();
			unsubOrchestrator = null;
		}
		if (unsubKeyHandler) {
			unsubKeyHandler();
			unsubKeyHandler = null;
		}

		// Remove widget and status
		ctx.ui.setWidget("brainstorm", undefined);
		ctx.ui.setStatus("brainstorm", undefined);

		// Persist final state
		api.appendEntry(BRAINSTORM_ENTRY_TYPE, finalState);
		saveState(ctx.cwd, finalState);

		orchestrator = null;
		renderer = null;
		sessionUi = null;

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

			if (trimmed === "setup") {
				const { runSetup } = await import("../setup/wizard.js");
				try {
					await runSetup();
					ctx.ui.notify("Setup complete. Restart brainstorm to use new config.", "info");
				} catch (err) {
					ctx.ui.notify(`Setup failed: ${err instanceof Error ? err.message : String(err)}`, "error");
				}
				return;
			}

			if (trimmed === "doctor" || trimmed.startsWith("doctor")) {
				try {
					const { runDoctor } = await import("../setup/doctor.js");
					const json = trimmed.includes("--json");
					await runDoctor({ json, cwd: ctx.cwd });
				} catch (err) {
					ctx.ui.notify(`Doctor failed: ${err instanceof Error ? err.message : String(err)}`, "error");
				}
				return;
			}

			if (trimmed === "config") {
				const { loadMachineConfig, loadProjectConfig, mergeConfigs } = await import("../config.js");
				const machine = loadMachineConfig();
				const project = loadProjectConfig(ctx.cwd);
				const merged = machine ? mergeConfigs(machine, project) : null;
				ctx.ui.notify(merged ? JSON.stringify(merged, null, 2) : "No config found. Run /brainstorm setup", "info");
				return;
			}

			if (trimmed.startsWith("add")) {
				if (!isActive()) {
					ctx.ui.notify("Not in brainstorm mode. Start one with /brainstorm first.", "warning");
					return;
				}
				const name = trimmed.slice(3).trim();
				if (!name) {
					const allConfigsForUsage = resolveAgentConfigs(ctx.cwd);
					ctx.ui.notify(`Usage: /brainstorm add <agent-name>. Available: ${allConfigsForUsage.map((c) => c.name).join(", ")}`, "warning");
					return;
				}
				if (orchestrator!.getState().agents.has(name)) {
					ctx.ui.notify(`Agent already in session: ${name}`, "warning");
					return;
				}
				const allConfigsForAdd = resolveAgentConfigs(ctx.cwd);
				const addConfig = allConfigsForAdd.find((c) => c.name === name);
				if (!addConfig) {
					ctx.ui.notify(`Unknown agent: ${name}. Available: ${allConfigsForAdd.map((c) => c.name).join(", ")}`, "warning");
					return;
				}
				renderer?.registerAgent(addConfig);
				renderer?.addSystemMessage(`${addConfig.label} joined the session`);
				ctx.ui.setStatus("brainstorm", statusText("connecting..."));
				await orchestrator!.addAgent(addConfig);
				ctx.ui.setStatus("brainstorm", statusText());
				ctx.ui.notify(`Added agent: ${addConfig.label}`, "info");
				return;
			}

			if (trimmed === "resume") {
				if (isActive()) {
					ctx.ui.notify("Brainstorm session already active. Use /brainstorm stop first.", "warning");
					return;
				}

				const saved = loadState(ctx.cwd);
				if (!saved?.messages?.length) {
					ctx.ui.notify("No previous brainstorm session found in this project.", "warning");
					return;
				}

				const allConfigsForResume = resolveAgentConfigs(ctx.cwd);
				const configs: AgentConfig[] = [];
				for (const agentName of Object.values(saved.agents)) {
					const config = allConfigsForResume.find((c) => c.name === agentName);
					if (config) configs.push(config);
				}

				if (configs.length === 0) {
					ctx.ui.notify("Could not find agent configs for resume.", "warning");
					return;
				}

				await startSession(ctx, configs);

				if (renderer) {
					renderer.replayHistory(saved.messages);
				}

				if (saved.mutedAgents) {
					for (const name of saved.mutedAgents) {
						orchestrator?.muteAgent(name);
					}
				}

				if (orchestrator) {
					orchestrator.getState().messages = [...saved.messages];
				}

				ctx.ui.notify(`Resumed brainstorm with ${saved.messages.length} messages.`, "info");
				return;
			}

			// Resolve agent configs. Accept space-separated agent names or use defaults.
			const allConfigs = resolveAgentConfigs(ctx.cwd);
			const availableNames = allConfigs.map((c) => c.name);

			let configs: AgentConfig[];
			if (trimmed) {
				const requestedNames = trimmed.split(/\s+/);
				configs = [];
				for (const name of requestedNames) {
					const config = allConfigs.find((c) => c.name === name);
					if (config) {
						configs.push(config);
					} else {
						ctx.ui.notify(
							`Unknown agent: ${name}. Available: ${availableNames.join(", ")}`,
							"warning",
						);
					}
				}
				if (configs.length === 0) return;
			} else {
				configs = allConfigs;
			}

			await startSession(ctx, configs);
		},
	});

	api.registerCommand("agents", {
		description: "List brainstorm agent status",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			if (!isActive()) {
				ctx.ui.notify("Not in brainstorm mode. Start one with /brainstorm first.", "warning");
				return;
			}

			const state = orchestrator!.getState();
			const lines: string[] = [];
			for (const [name, agentState] of state.agents) {
				const info = agentState.sessionInfo;
				const parts = [`${agentState.config.label} (${name}): ${agentState.status}`];
				if (info?.model) parts.push(`model: ${info.model}`);
				if (info?.thoughtLevel) parts.push(`thinking: ${info.thoughtLevel}`);
				if (info?.contextWindow) parts.push(`ctx: ${(info.contextWindow / 1000).toFixed(0)}k`);
				lines.push(parts.join(" | "));
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	api.registerCommand("mute", {
		description: "Mute a brainstorm agent",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			if (!isActive()) {
				ctx.ui.notify("Not in brainstorm mode. Start one with /brainstorm first.", "warning");
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
				ctx.ui.notify("Not in brainstorm mode. Start one with /brainstorm first.", "warning");
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
				ctx.ui.notify("Not in brainstorm mode. Start one with /brainstorm first.", "warning");
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

	api.registerCommand("stop", {
		description: "Interrupt all running agents",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			if (!isActive()) {
				ctx.ui.notify("Not in brainstorm mode. Start one with /brainstorm first.", "warning");
				return;
			}
			await orchestrator!.cancelAll();
			if (spinnerInterval) { clearInterval(spinnerInterval); spinnerInterval = null; }
			ctx.ui.setStatus("brainstorm", statusText());
			ctx.ui.notify("Interrupted all agents.", "info");
		},
	});

	api.registerCommand("auto", {
		description: "Start autonomous agent discussion",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			if (!isActive()) {
				ctx.ui.notify("Not in brainstorm mode. Start one with /brainstorm first.", "warning");
				return;
			}

			const trimmed = args.trim();

			// /auto continue [turns] [message]
			if (trimmed.startsWith("continue")) {
				const rest = trimmed.slice("continue".length).trim();
				const match = rest.match(/^(\d+)?\s*(.*)?$/);
				const turns = match?.[1] ? parseInt(match[1], 10) : 1;
				const message = match?.[2]?.trim() || undefined;

				if (isNaN(turns) || turns < 1) {
					ctx.ui.notify("Usage: /auto continue [turns] [message]", "warning");
					return;
				}

				// Inject user message into history if provided
				if (message && orchestrator) {
					orchestrator.getState().messages.push({ source: "user", content: message, timestamp: Date.now() });
					renderer?.addUserMessage(message);
					sessionUi?.setStatus("brainstorm", statusText());
				}

				renderer?.addSystemMessage(`AUTO continue: ${turns} more turn(s) each`);
				sessionUi?.setStatus("brainstorm", statusText());
				await orchestrator!.continueAuto(turns);
				return;
			}

			// /auto [turns] [topic]
			const match = trimmed.match(/^(\d+)?\s*(.*)?$/);
			const turns = match?.[1] ? parseInt(match[1], 10) : 3;
			const topic = match?.[2]?.trim() || undefined;

			const label = `AUTO: ${turns} turns each${topic ? ` — ${topic}` : ""}`;
			renderer?.addSystemMessage(label);
			sessionUi?.setStatus("brainstorm", statusText());
			await orchestrator!.startAuto(turns, topic);
		},
	});

	// ── Input interception ──────────────────────────────────────────────

	api.on("input", (event: InputEvent): InputEventResult => {
		if (!isActive()) {
			return { action: "continue" };
		}

		// If in auto mode, any non-slash input interrupts it
		if (orchestrator!.isAutoMode() && !event.text.startsWith("/")) {
			orchestrator!.stopAuto();
			sessionUi?.setStatus("brainstorm", statusText());
			if (spinnerInterval) { clearInterval(spinnerInterval); spinnerInterval = null; }
			// Fall through to process the message normally
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

			// Determine which agents will actually respond (respecting @mentions and mute)
			const allNames = agentNames();
			const { mentions } = parseMentions(text, allNames);
			const mutedAgents = orchestrator!.toJSON().mutedAgents;
			let respondingNames: string[];
			if (mentions.length > 0) {
				respondingNames = mentions;
			} else {
				respondingNames = allNames.filter((n) => !mutedAgents.includes(n));
			}
			// Further filter to only active agents
			respondingNames = respondingNames.filter((n) => {
				const state = orchestrator!.getState().agents.get(n);
				return state && state.status === "active";
			});
			if (respondingNames.length > 0) {
				renderer.startStreaming(respondingNames);
			}

			// Start spinner animation timer — triggers re-renders every 80ms
			if (spinnerInterval) clearInterval(spinnerInterval);
			spinnerInterval = setInterval(() => {
				sessionUi?.setStatus("brainstorm", statusText());
			}, 80);

			// Trigger immediate render so user message + streaming UI appear now
			sessionUi?.setStatus("brainstorm", statusText("thinking..."));
		}

		// Send to orchestrator (fire-and-forget; streaming handled via events)
		orchestrator!.sendMessage(text).catch((err) => {
			// Error is surfaced via orchestrator error events
			console.error("Brainstorm send error:", err);
		});

		// Persist updated state (state also saved on all_done when agents finish)
		api.appendEntry(BRAINSTORM_ENTRY_TYPE, orchestrator!.toJSON());

		return { action: "handled" };
	});

	// ── Cleanup ────────────────────────────────────────────────────────

	function cleanup(): void {
		if (spinnerInterval) { clearInterval(spinnerInterval); spinnerInterval = null; }
		if (orchestrator?.isActive()) {
			orchestrator.killSync();
		}
		if (unsubOrchestrator) {
			unsubOrchestrator();
			unsubOrchestrator = null;
		}
		if (unsubKeyHandler) {
			unsubKeyHandler();
			unsubKeyHandler = null;
		}
		orchestrator = null;
		renderer = null;
		sessionUi = null;
	}

	api.on("session_shutdown", async () => {
		cleanup();
	});

	// Handle unexpected exits — kill ACP subprocesses so they don't become orphans
	process.on("exit", cleanup);
	process.on("SIGINT", cleanup);
	process.on("SIGTERM", cleanup);

}
