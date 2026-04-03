import { describe, expect, it } from "vitest";
import { interpolatePrompt, loadAutoPromptTemplate, loadPromptTemplate, parsePromptTemplate } from "../src/prompt.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

describe("prompt loading", () => {
	it("loads brainstorm prompt from prompts/BRAINSTORM.md", () => {
		const template = loadPromptTemplate(projectRoot);
		expect(template).toContain("brainstorming session");
	});

	it("loads auto prompt from prompts/AUTO.md", () => {
		const template = loadAutoPromptTemplate();
		expect(template).toContain("autonomous discussion");
	});
});

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

