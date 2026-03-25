import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function loadPromptTemplate(cwd: string): string {
	const projectPrompt = join(cwd, "BRAINSTORM_PROMPT.md");
	if (existsSync(projectPrompt)) {
		return readFileSync(projectPrompt, "utf-8");
	}
	const defaultPrompt = join(__dirname, "PROMPT.md");
	return readFileSync(defaultPrompt, "utf-8");
}

export function parsePromptTemplate(raw: string): { body: string } {
	const match = raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
	return { body: match ? match[1].trim() : raw.trim() };
}

export function interpolatePrompt(template: string, variables: Record<string, string>): string {
	return template.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? `{{${key}}}`);
}

export function buildAgentPrompt(cwd: string, agentName: string, agentLabel: string, participants: string[]): string {
	const raw = loadPromptTemplate(cwd);
	const { body } = parsePromptTemplate(raw);
	return interpolatePrompt(body, {
		agent_name: agentName,
		agent_label: agentLabel,
		participants: participants.join(", "),
		working_directory: cwd,
	});
}
