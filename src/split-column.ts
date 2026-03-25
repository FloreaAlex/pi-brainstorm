import { type Component, visibleWidth } from "@mariozechner/pi-tui";
import stripAnsi from "strip-ansi";

/**
 * Pad or truncate a line to an exact visible width.
 */
function padToWidth(line: string, targetWidth: number): string {
	const w = visibleWidth(line);
	if (w === targetWidth) return line;
	if (w < targetWidth) return line + " ".repeat(targetWidth - w);
	// Truncate: walk characters and track visible width
	return truncateLineToWidth(line, targetWidth);
}

/** Truncate a string with ANSI codes to a max visible width. */
function truncateLineToWidth(str: string, maxWidth: number): string {
	// Simple approach: strip ANSI, truncate plain text, pad if needed
	const plain = stripAnsi(str);
	if (plain.length <= maxWidth) {
		// The ANSI codes inflate the string but visible fits — just pad
		const w = visibleWidth(str);
		if (w <= maxWidth) return str + " ".repeat(maxWidth - w);
	}
	// Walk the string char by char tracking ANSI escapes
	let result = "";
	let width = 0;
	let inEscape = false;
	for (let i = 0; i < str.length && width < maxWidth; i++) {
		const ch = str[i];
		if (ch === "\x1b") {
			inEscape = true;
			result += ch;
		} else if (inEscape) {
			result += ch;
			if (/[a-zA-Z~]/.test(ch)) inEscape = false;
		} else {
			result += ch;
			width++;
		}
	}
	// Close any unclosed ANSI with reset
	if (inEscape || /\x1b\[[\d;]*$/.test(result)) {
		result += "\x1b[0m";
	}
	// Pad remaining
	if (width < maxWidth) result += " ".repeat(maxWidth - width);
	return result;
}

/**
 * SplitColumn component — renders two child components side by side.
 *
 * When the available width is too narrow (< 10 columns per side),
 * it falls back to stacking the children vertically.
 */
export class SplitColumn implements Component {
	private left: Component;
	private right: Component;
	private gap: number;

	constructor(left: Component, right: Component, gap = 1) {
		this.left = left;
		this.right = right;
		this.gap = gap;
	}

	setLeft(component: Component): void {
		this.left = component;
	}

	setRight(component: Component): void {
		this.right = component;
	}

	invalidate(): void {
		this.left.invalidate();
		this.right.invalidate();
	}

	render(width: number): string[] {
		const colWidth = Math.floor((width - this.gap) / 2);
		if (colWidth < 10) {
			// Too narrow — stack vertically
			return [...this.left.render(width), ...this.right.render(width)];
		}

		const rightColWidth = width - colWidth - this.gap;
		const leftLines = this.left.render(colWidth);
		const rightLines = this.right.render(rightColWidth);
		const maxLines = Math.max(leftLines.length, rightLines.length);
		const gapStr = " ".repeat(this.gap);
		const result: string[] = [];

		for (let i = 0; i < maxLines; i++) {
			const l = i < leftLines.length ? leftLines[i] : "";
			const r = i < rightLines.length ? rightLines[i] : "";

			const lPadded = padToWidth(l, colWidth);
			const rPadded = padToWidth(r, rightColWidth);

			result.push(lPadded + gapStr + rPadded);
		}

		return result;
	}
}
