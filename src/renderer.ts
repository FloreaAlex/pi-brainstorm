import {
	type Component,
	Container,
	Markdown,
	type MarkdownTheme,
	Spacer,
	Text,
} from "@mariozechner/pi-tui";
import chalk from "chalk";
import { SplitColumn } from "./split-column.js";
import type { AgentConfig, BrainstormMessage } from "./types.js";

/** Default markdown theme — plain, no custom colors. */
function getDefaultMarkdownTheme(): MarkdownTheme {
	return {} as MarkdownTheme;
}

/**
 * Minimum terminal width (in columns) to use side-by-side layout.
 * Below this we stack agents vertically.
 */
const MIN_SIDE_BY_SIDE_WIDTH = 80;

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
	private text: string;
	private markdownTheme: MarkdownTheme;
	private header: Text;
	private body: Markdown;
	private inner: Container;

	constructor(agentLabel: string, colorHex: string, markdownTheme: MarkdownTheme) {
		this.agentLabel = agentLabel;
		this.colorHex = colorHex;
		this.streaming = true;
		this.text = "";
		this.markdownTheme = markdownTheme;

		this.header = new Text("", 0, 0);
		this.body = new Markdown("", 0, 0, this.markdownTheme);
		this.inner = new Container();
		this.inner.addChild(this.header);
		this.inner.addChild(this.body);

		this.updateHeader();
	}

	setText(text: string): void {
		this.text = text;
		this.body.setText(text);
	}

	appendText(chunk: string): void {
		this.text += chunk;
		this.body.setText(this.text);
	}

	setStreaming(streaming: boolean): void {
		this.streaming = streaming;
		this.updateHeader();
	}

	getText(): string {
		return this.text;
	}

	invalidate(): void {
		this.inner.invalidate();
	}

	render(width: number): string[] {
		const colorFn = chalk.hex(this.colorHex);
		const border = colorFn("\u2502 ");
		// 2 visible columns used by the border
		const contentWidth = Math.max(1, width - 2);
		const innerLines = this.inner.render(contentWidth);

		const result: string[] = [];
		for (const line of innerLines) {
			result.push(border + line);
		}

		// Ensure at least the header renders even if content is empty
		if (result.length === 0) {
			result.push(border);
		}

		return result;
	}

	private updateHeader(): void {
		const colorFn = chalk.hex(this.colorHex);
		const label = colorFn(chalk.bold(this.agentLabel));
		const status = this.streaming ? chalk.dim(" streaming\u2026") : "";
		this.header.setText(label + status);
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
			this.activeBlocks.set(name, block);
			blocks.push(block);
		}

		const spacer = new Spacer(1);
		this.managedChildren.push(spacer);
		this.container.addChild(spacer);

		const termWidth = process.stdout.columns ?? 80;
		if (blocks.length === 2 && termWidth >= MIN_SIDE_BY_SIDE_WIDTH) {
			const split = new SplitColumn(blocks[0], blocks[1], 2);
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
	onStreamChunk(agentName: string, text: string): void {
		const block = this.activeBlocks.get(agentName);
		if (block) {
			block.appendText(text);
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
