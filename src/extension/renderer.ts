import {
	type Component,
	Container,
	Markdown,
	type MarkdownTheme,
	Spacer,
	Text,
	truncateToWidth,
	visibleWidth,
} from "@mariozechner/pi-tui";
import chalk from "chalk";
import { SplitColumn } from "./split-column.js";
import type { AgentConfig, BrainstormMessage } from "./types.js";

/** Default markdown theme — plain passthrough, no custom colors. */
function getDefaultMarkdownTheme(): MarkdownTheme {
	const id = (t: string) => t;
	return {
		heading: id,
		link: id,
		linkUrl: id,
		code: id,
		codeBlock: id,
		codeBlockBorder: id,
		quote: id,
		quoteBorder: id,
		hr: id,
		listBullet: id,
		bold: id,
		italic: id,
		strikethrough: id,
		underline: id,
	};
}

/**
 * Minimum terminal width (in columns) to use side-by-side layout.
 * Below this we stack agents vertically.
 */
const MIN_SIDE_BY_SIDE_WIDTH = 80;

/** Spinner frames — Claude Code style (braille dots) */
const CLAUDE_SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Spinner frames — OpenAI style (rotating circle) */
const OPENAI_SPINNER = ["◐", "◓", "◑", "◒"];

/** Pick spinner frames based on agent name */
function getSpinnerFrames(agentName: string): string[] {
	if (agentName.toLowerCase().includes("codex")) return OPENAI_SPINNER;
	return CLAUDE_SPINNER;
}

// ────────────────────────────────────────────────────────────────────────────
// AgentBlock
// ────────────────────────────────────────────────────────────────────────────

/**
 * Renders a single agent's streaming response with a colored left border.
 *
 * Layout:
 *   <color>│</color> <agentLabel> [streaming...]
 *   <color>│</color> <markdown content>
 */
export class AgentBlock implements Component {
	private agentLabel: string;
	private colorHex: string;
	private streaming: boolean;
	private messageText: string;
	private thoughtText: string;
	private thoughtExpanded = false;
	private markdownTheme: MarkdownTheme;
	private header: Text;
	private body: Markdown;
	private inner: Container;
	private spinnerFrames: string[];
	private spinnerIdx = 0;
	private pulsing = false;
	private pulseFrame = 0;
	private modelName: string | undefined;

	constructor(agentLabel: string, colorHex: string, markdownTheme: MarkdownTheme) {
		this.agentLabel = agentLabel;
		this.colorHex = colorHex;
		this.streaming = true;
		this.messageText = "";
		this.thoughtText = "";
		this.markdownTheme = markdownTheme;
		this.spinnerFrames = getSpinnerFrames(agentLabel);

		this.header = new Text("", 0, 0);
		this.body = new Markdown("", 0, 0, this.markdownTheme);
		this.inner = new Container();
		this.inner.addChild(this.body);
	}

	setText(text: string): void {
		this.messageText = text;
		this.body.setText(text);
	}

	appendText(chunk: string, kind: "message" | "thought" = "message"): void {
		if (kind === "thought") {
			this.thoughtText += chunk;
			// While streaming, show thoughts in the body so user sees activity
			if (this.streaming) {
				this.body.setText(this.thoughtText);
			}
		} else {
			this.messageText += chunk;
			// Once message content starts, show only message
			this.body.setText(this.messageText);
		}
	}

	setStreaming(streaming: boolean): void {
		this.streaming = streaming;
		// When done streaming, show only the message (hide reasoning)
		if (!streaming && this.messageText) {
			this.body.setText(this.messageText);
		}
		this.updateHeader();
	}

	setModel(model: string | undefined): void {
		this.modelName = model;
	}

	setPulsing(pulsing: boolean): void {
		this.pulsing = pulsing;
		if (!pulsing) this.pulseFrame = 0;
	}

	toggleThought(): void {
		this.thoughtExpanded = !this.thoughtExpanded;
	}

	getText(): string {
		return this.messageText;
	}

	invalidate(): void {
		this.inner.invalidate();
	}

	render(width: number): string[] {
		// Advance spinner on each render while streaming
		if (this.streaming) {
			this.updateHeader();
		}

		// Pulsing: smooth breathing via color interpolation
		let borderColor: (s: string) => string;
		if (this.pulsing) {
			this.pulseFrame++;
			// Sine wave over ~40 frames (~3.2s at 80ms) — smooth in and out
			const t = Math.sin((this.pulseFrame / 40) * Math.PI * 2);
			// Interpolate between 40% and 100% brightness
			const brightness = 0.4 + 0.6 * ((t + 1) / 2);
			const r = parseInt(this.colorHex.slice(1, 3), 16);
			const g = parseInt(this.colorHex.slice(3, 5), 16);
			const b = parseInt(this.colorHex.slice(5, 7), 16);
			const br = Math.round(r * brightness);
			const bg = Math.round(g * brightness);
			const bb = Math.round(b * brightness);
			const dimHex = `#${br.toString(16).padStart(2, "0")}${bg.toString(16).padStart(2, "0")}${bb.toString(16).padStart(2, "0")}`;
			borderColor = chalk.hex(dimHex);
		} else {
			borderColor = chalk.hex(this.colorHex);
		}
		const colorFn = borderColor;
		const labelColor = chalk.hex(this.colorHex); // label always bright
		const contentWidth = Math.max(1, width - 4);
		const leftBorder = colorFn("\u2502 ");
		const result: string[] = [];

		// Top border: ╭─── Agent ───╮
		const headerText = this.streaming
			? ` ${this.spinnerFrames[this.spinnerIdx % this.spinnerFrames.length]} ${this.agentLabel} `
			: ` ${this.agentLabel} `;
		const headerVisWidth = visibleWidth(headerText);
		const topLineLen = Math.max(0, width - 2 - headerVisWidth);
		const topLeft = Math.floor(topLineLen / 4);
		const topRight = topLineLen - topLeft;
		result.push(colorFn("\u256D" + "─".repeat(topLeft)) + labelColor(chalk.bold(headerText)) + colorFn("─".repeat(topRight) + "\u256E"));

		// Collapsed thought toggle (only when done and has thought)
		if (!this.streaming && this.thoughtText) {
			const arrow = this.thoughtExpanded ? "\u25BC" : "\u25B6";
			const hint = chalk.dim(` ${arrow} reasoning ${chalk.italic("(Ctrl+E)")}`);
			result.push(leftBorder + hint);

			if (this.thoughtExpanded) {
				const thoughtMd = new Markdown(this.thoughtText, 0, 0, this.markdownTheme);
				const thoughtLines = thoughtMd.render(contentWidth);
				for (const line of thoughtLines) {
					result.push(leftBorder + chalk.dim(line));
				}
				result.push(leftBorder); // spacer after thought
			}
		}

		// Message body
		const bodyLines = this.body.render(contentWidth);
		for (const line of bodyLines) {
			result.push(leftBorder + line);
		}

		if (bodyLines.length === 0) {
			result.push(leftBorder);
		}

		// Bottom border: ╰─── model ───╯
		if (this.modelName) {
			const modelText = ` ${this.modelName} `;
			const modelVisWidth = visibleWidth(modelText);
			const bottomLineLen = Math.max(0, width - 2 - modelVisWidth);
			const bottomRight = Math.floor(bottomLineLen / 4);
			const bottomLeft = bottomLineLen - bottomRight;
			result.push(colorFn("\u2570" + "─".repeat(bottomLeft)) + chalk.dim(modelText) + colorFn("─".repeat(bottomRight) + "\u256F"));
		} else {
			result.push(colorFn(`\u2570${"─".repeat(Math.max(0, width - 2))}\u256F`));
		}

		// Safety: ensure no line exceeds the given width
		return result.map((line) => truncateToWidth(line, width, "", true));
	}

	private updateHeader(): void {
		const colorFn = chalk.hex(this.colorHex);
		if (this.streaming) {
			const frame = this.spinnerFrames[this.spinnerIdx % this.spinnerFrames.length];
			this.spinnerIdx++;
			this.header.setText(`${colorFn(frame)} ${colorFn(chalk.bold(this.agentLabel))}`);
		} else {
			this.header.setText(colorFn(chalk.bold(this.agentLabel)));
		}
	}
}

// ────────────────────────────────────────────────────────────────────────────
// UserMessageBlock
// ────────────────────────────────────────────────────────────────────────────

/**
 * Simple display of a user message with a yellow "you: " prefix.
 */
export class UserMessageBlock implements Component {
	private textComponent: Text;

	constructor(message: string) {
		const prefix = chalk.yellow.bold("you: ");
		this.textComponent = new Text(prefix + message, 1, 0);
	}

	invalidate(): void {
		this.textComponent.invalidate();
	}

	render(width: number): string[] {
		return this.textComponent.render(width);
	}
}

/**
 * Inline system/status message — dim centered text with separator lines.
 */
export class SystemMessage implements Component {
	private message: string;

	constructor(message: string) {
		this.message = message;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const text = ` ${this.message} `;
		const textWidth = visibleWidth(text);
		if (textWidth >= width) {
			// Message too long — truncate with ellipsis and no separator dashes
			return [truncateToWidth(chalk.dim(text), width, "… ", true)];
		}
		const remaining = width - textWidth;
		const left = Math.floor(remaining / 2);
		const right = remaining - left;
		return [chalk.dim("─".repeat(left) + text + "─".repeat(right))];
	}
}

// ────────────────────────────────────────────────────────────────────────────
// BrainstormRenderer
// ────────────────────────────────────────────────────────────────────────────

/**
 * Manages the complete brainstorm chat view: user messages, streaming
 * side-by-side (or stacked) agent responses, and collapsed threaded view.
 */
export class BrainstormRenderer {
	private container: Container;
	private agentConfigs: Map<string, AgentConfig> = new Map();
	private markdownTheme: MarkdownTheme;

	/** Current streaming round state */
	private activeBlocks: Map<string, AgentBlock> = new Map();
	private splitComponent: SplitColumn | null = null;
	/** Ordered list of all children we manage inside the container */
	private managedChildren: Component[] = [];

	constructor(markdownTheme?: MarkdownTheme) {
		this.container = new Container();
		this.markdownTheme = markdownTheme ?? getDefaultMarkdownTheme();
	}

	/** Return the root Container for the TUI to render. */
	getContainer(): Container {
		return this.container;
	}

	/** Register an agent configuration for color/label lookup. */
	registerAgent(config: AgentConfig): void {
		this.agentConfigs.set(config.name, config);
	}

	// ── Chat actions ─────────────────────────────────────────────────────

	/** Append a user message to the chat. */
	addUserMessage(text: string): void {
		const spacer = new Spacer(1);
		const block = new UserMessageBlock(text);
		this.managedChildren.push(spacer, block);
		this.container.addChild(spacer);
		this.container.addChild(block);
	}

	/** Show an inline system/status message in the chat flow. */
	addSystemMessage(text: string): void {
		const spacer = new Spacer(1);
		const msg = new SystemMessage(text);
		this.managedChildren.push(spacer, msg);
		this.container.addChild(spacer);
		this.container.addChild(msg);
	}

	/**
	 * Begin a new streaming round for the given agent names.
	 *
	 * If exactly 2 agents and the terminal is wide enough, they are placed
	 * side-by-side via SplitColumn; otherwise they are stacked vertically.
	 */
	startStreaming(agentNames: string[]): void {
		// Clean up any prior streaming state
		this.activeBlocks.clear();
		this.splitComponent = null;

		const blocks: AgentBlock[] = [];
		for (const name of agentNames) {
			const config = this.agentConfigs.get(name);
			const label = config?.label ?? name;
			const color = config?.color ?? "#888888";
			const block = new AgentBlock(label, color, this.markdownTheme);
			block.setModel(config?.preferredModel);
			this.activeBlocks.set(name, block);
			blocks.push(block);
		}

		const spacer = new Spacer(1);
		this.managedChildren.push(spacer);
		this.container.addChild(spacer);

		const termWidth = process.stdout.columns ?? 80;
		const minWidthPerAgent = Math.floor(MIN_SIDE_BY_SIDE_WIDTH / 2);
		const canFitSideBySide = blocks.length >= 2 && termWidth >= blocks.length * minWidthPerAgent;

		if (canFitSideBySide) {
			const split = new SplitColumn(blocks, 2);
			this.splitComponent = split;
			this.managedChildren.push(split);
			this.container.addChild(split);
		} else {
			for (const block of blocks) {
				this.managedChildren.push(block);
				this.container.addChild(block);
			}
		}
	}

	/** Feed a text chunk to the correct agent's block. */
	onStreamChunk(agentName: string, text: string, kind: "message" | "thought" = "message"): void {
		const block = this.activeBlocks.get(agentName);
		if (block) {
			block.appendText(text, kind);
		}
	}

	/** Toggle reasoning visibility for all agent blocks. */
	toggleThoughts(): void {
		for (const block of this.activeBlocks.values()) {
			block.toggleThought();
		}
		// Also toggle on completed blocks in managed children
		for (const child of this.managedChildren) {
			if (child instanceof AgentBlock) {
				child.toggleThought();
			}
		}
	}

	/** Start a single-agent streaming block for auto mode turns. */
	startAutoTurn(agentName: string): void {
		this.activeBlocks.clear();

		const config = this.agentConfigs.get(agentName);
		const label = config?.label ?? agentName;
		const color = config?.color ?? "#888888";
		const block = new AgentBlock(label, color, this.markdownTheme);
		block.setModel(config?.preferredModel);
		block.setPulsing(true);
		this.activeBlocks.set(agentName, block);

		const spacer = new Spacer(1);
		this.managedChildren.push(spacer, block);
		this.container.addChild(spacer);
		this.container.addChild(block);
	}

	/** End an auto mode turn — stop pulsing. */
	endAutoTurn(agentName: string): void {
		const block = this.activeBlocks.get(agentName);
		if (block) {
			block.setStreaming(false);
			block.setPulsing(false);
		}
	}

	/** Mark an agent as done streaming. */
	onAgentDone(agentName: string): void {
		const block = this.activeBlocks.get(agentName);
		if (block) {
			block.setStreaming(false);
		}
	}

	/**
	 * Collapse the side-by-side SplitColumn view and re-add each agent
	 * block sequentially at full width. This is useful after all agents
	 * finish streaming so the user can read long responses without the
	 * narrow column constraint.
	 */
	collapseSplitView(): void {
		if (!this.splitComponent) {
			return;
		}

		// Gather the agent blocks that were inside the split
		const blocks = Array.from(this.activeBlocks.values());

		// Remove the split from managed children
		const splitIdx = this.managedChildren.indexOf(this.splitComponent);
		if (splitIdx !== -1) {
			this.managedChildren.splice(splitIdx, 1, ...blocks);
		}

		// Rebuild container from managed children
		this.rebuildContainer();
		this.splitComponent = null;
	}

	/**
	 * Replay persisted messages to restore the chat after a session resume.
	 */
	replayHistory(messages: BrainstormMessage[]): void {
		for (const msg of messages) {
			if (msg.source === "user") {
				this.addUserMessage(msg.content);
			} else {
				// Agent message — render as a completed (non-streaming) block
				const config = this.agentConfigs.get(msg.source);
				const label = config?.label ?? msg.source;
				const color = config?.color ?? "#888888";
				const block = new AgentBlock(label, color, this.markdownTheme);
				block.setModel(config?.preferredModel);
				block.setText(msg.content);
				block.setStreaming(false);

				const spacer = new Spacer(1);
				this.managedChildren.push(spacer, block);
				this.container.addChild(spacer);
				this.container.addChild(block);
			}
		}
	}

	// ── Internal helpers ─────────────────────────────────────────────────

	/** Clear the container and re-add all managed children in order. */
	private rebuildContainer(): void {
		this.container.clear();
		for (const child of this.managedChildren) {
			this.container.addChild(child);
		}
	}
}
