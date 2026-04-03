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
 * Minimum columns per child before falling back to vertical stacking.
 */
const MIN_COL_WIDTH = 10;

/**
 * SplitColumn component — renders child components side by side.
 *
 * Supports 2 or more children. When the available width is too narrow
 * (< MIN_COL_WIDTH columns per child), it falls back to stacking vertically.
 */
export class SplitColumn implements Component {
	private children: Component[];
	private gap: number;

	constructor(left: Component, right: Component, gap?: number);
	constructor(children: Component[], gap?: number);
	constructor(leftOrChildren: Component | Component[], rightOrGap?: Component | number, gap?: number) {
		if (Array.isArray(leftOrChildren)) {
			this.children = leftOrChildren;
			this.gap = (typeof rightOrGap === "number" ? rightOrGap : gap) ?? 1;
		} else {
			this.children = [leftOrChildren, rightOrGap as Component];
			this.gap = gap ?? 1;
		}
	}

	setLeft(component: Component): void {
		this.children[0] = component;
	}

	setRight(component: Component): void {
		this.children[1] = component;
	}

	invalidate(): void {
		for (const child of this.children) child.invalidate();
	}

	render(width: number): string[] {
		const n = this.children.length;
		if (n === 0) return [];
		if (n === 1) return this.children[0].render(width);

		const totalGap = this.gap * (n - 1);
		const colWidth = Math.floor((width - totalGap) / n);

		if (colWidth < MIN_COL_WIDTH) {
			// Too narrow — stack vertically
			const lines: string[] = [];
			for (const child of this.children) {
				lines.push(...child.render(width));
			}
			return lines;
		}

		// Last column gets any remaining pixels
		const lastColWidth = width - colWidth * (n - 1) - totalGap;
		const gapStr = " ".repeat(this.gap);

		// Render all children
		const rendered = this.children.map((child, i) =>
			child.render(i === n - 1 ? lastColWidth : colWidth),
		);

		const maxLines = Math.max(...rendered.map((r) => r.length));
		const result: string[] = [];

		for (let row = 0; row < maxLines; row++) {
			const parts: string[] = [];
			for (let col = 0; col < n; col++) {
				const w = col === n - 1 ? lastColWidth : colWidth;
				const line = row < rendered[col].length ? rendered[col][row] : "";
				parts.push(padToWidth(line, w));
			}
			result.push(parts.join(gapStr));
		}

		return result;
	}
}
