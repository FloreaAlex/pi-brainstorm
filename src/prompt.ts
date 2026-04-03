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
	// First handle conditional blocks: {{#var}}content{{/var}}
	let result = template.replace(
		/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
		(_, key, content) => (variables[key] ? content : ""),
	);
	// Then replace simple variables: {{var}}
	result = result.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? `{{${key}}}`);
	// Clean up double blank lines left by removed conditional blocks
	result = result.replace(/\n{3,}/g, "\n\n");
	return result.trim();
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

export function loadAutoPromptTemplate(): string {
	const defaultPrompt = join(__dirname, "AUTO_PROMPT.md");
	return readFileSync(defaultPrompt, "utf-8");
}

export function buildAutoPrompt(
	cwd: string,
	agentName: string,
	agentLabel: string,
	otherAgents: string[],
	currentTurn: number,
	totalTurns: number,
	options: { topic?: string; isSummary?: boolean },
): string {
	const raw = loadAutoPromptTemplate();
	const { body } = parsePromptTemplate(raw);
	return interpolatePrompt(body, {
		agent_name: agentName,
		agent_label: agentLabel,
		other_agents: otherAgents.join(", "),
		current_turn: String(currentTurn),
		total_turns: String(totalTurns),
		working_directory: cwd,
		topic: options.topic ?? "",
		is_summary: options.isSummary ? "true" : "",
	});
}

