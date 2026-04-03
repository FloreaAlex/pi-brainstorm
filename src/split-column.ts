import { type Component, truncateToWidth } from "@mariozechner/pi-tui";

/**
 * Pad or truncate a line to an exact visible width.
 * Uses pi-tui's truncateToWidth which correctly handles ANSI codes,
 * grapheme clusters, and wide characters.
 */
function padToWidth(line: string, targetWidth: number): string {
	return truncateToWidth(line, targetWidth, "", true);
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
