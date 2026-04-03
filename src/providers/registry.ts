import type { Provider } from "./types.js";
import { ClaudeProvider } from "./claude.js";
import { CodexProvider } from "./codex.js";
import { GeminiProvider } from "./gemini.js";

const providers: Provider[] = [
	new ClaudeProvider(),
	new CodexProvider(),
	new GeminiProvider(),
];

export function getProviders(): Provider[] {
	return providers;
}

export function getProvider(name: string): Provider | undefined {
	return providers.find((p) => p.name === name);
}
