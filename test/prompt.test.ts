import { describe, expect, it } from "vitest";
import { interpolatePrompt, parsePromptTemplate } from "../src/prompt.js";

describe("prompt template", () => {
	it("strips frontmatter", () => {
		const raw = `---\nname: test\n---\nHello {{name}}`;
		const { body } = parsePromptTemplate(raw);
		expect(body).toBe("Hello {{name}}");
	});

	it("interpolates variables", () => {
		const result = interpolatePrompt("Hello {{name}}, you are {{role}}", {
			name: "Claude",
			role: "an assistant",
		});
		expect(result).toBe("Hello Claude, you are an assistant");
	});

	it("preserves unknown variables", () => {
		const result = interpolatePrompt("Hello {{name}} {{unknown}}", { name: "Claude" });
		expect(result).toBe("Hello Claude {{unknown}}");
	});
});

