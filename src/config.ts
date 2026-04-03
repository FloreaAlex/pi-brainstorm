import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { AgentConfig } from "./extension/types.js";
import type { AgentUserConfig, BrainstormConfig, MachineAgentState } from "./providers/types.js";
import { getProvider, getProviders } from "./providers/registry.js";

const DEFAULT_CONFIG_DIR = join(homedir(), ".pi", "brainstorm");

const DEFAULT_COMMANDS: Record<string, string> = {
	claude: "claude-agent-acp",
	codex: "codex-acp",
	gemini: "gemini",
};

/**
 * Deep-merge two plain objects with these semantics:
 * - Objects merge recursively
 * - Scalars override
 * - Arrays replace entirely
 * - null resets the key to undefined (deletes it)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepMerge(base: any, override: any): any {
	const result = { ...base };

	for (const key of Object.keys(override)) {
		const overrideVal = override[key];
		const baseVal = result[key];

		if (overrideVal === null) {
			// null resets to undefined (deletes)
			delete result[key];
		} else if (Array.isArray(overrideVal)) {
			// Arrays replace entirely
			result[key] = overrideVal;
		} else if (
			typeof overrideVal === "object" &&
			overrideVal !== undefined &&
			typeof baseVal === "object" &&
			baseVal !== null &&
			baseVal !== undefined &&
			!Array.isArray(baseVal)
		) {
			// Recursively merge objects
			result[key] = deepMerge(baseVal, overrideVal);
		} else {
			// Scalars override
			result[key] = overrideVal;
		}
	}

	return result;
}

/**
 * Read config.json from the given dir (default: ~/.pi/brainstorm/).
 * Returns null if not found or invalid.
 */
export function loadMachineConfig(configDir?: string): BrainstormConfig | null {
	const dir = configDir ?? DEFAULT_CONFIG_DIR;
	const filePath = join(dir, "config.json");

	if (!existsSync(filePath)) {
		return null;
	}

	try {
		const raw = readFileSync(filePath, "utf-8");
		return JSON.parse(raw) as BrainstormConfig;
	} catch {
		return null;
	}
}

/**
 * Read brainstorm.config.json from the given directory.
 * Returns null if not found or invalid.
 */
export function loadProjectConfig(cwd: string): Partial<BrainstormConfig> | null {
	const filePath = join(cwd, "brainstorm.config.json");

	if (!existsSync(filePath)) {
		return null;
	}

	try {
		const raw = readFileSync(filePath, "utf-8");
		return JSON.parse(raw) as Partial<BrainstormConfig>;
	} catch {
		return null;
	}
}

/**
 * Deep merge machine + project configs.
 * If project is null, returns machine unchanged.
 */
export function mergeConfigs(
	machine: BrainstormConfig,
	project: Partial<BrainstormConfig> | null,
): BrainstormConfig {
	if (!project) {
		return machine;
	}
	return deepMerge(machine, project) as BrainstormConfig;
}

/**
 * Write config.json to the given dir (default: ~/.pi/brainstorm/), creating dirs as needed.
 */
export function writeMachineConfig(configDir: string | undefined, config: BrainstormConfig): void {
	const dir = configDir ?? DEFAULT_CONFIG_DIR;
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "config.json"), JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Load machine config + project config, merge them, then build AgentConfig[] from the result.
 *
 * If no machine config exists, falls back to building configs from provider defaults
 * with "full" policy (so the extension still works without running setup).
 */
export function resolveAgentConfigs(cwd: string, configDir?: string): AgentConfig[] {
	const machineConfig = loadMachineConfig(configDir);
	const projectConfig = loadProjectConfig(cwd);

	if (!machineConfig) {
		// Fallback: use provider defaults for all supported-platform providers
		return buildFallbackConfigs();
	}

	const merged = mergeConfigs(machineConfig, projectConfig);
	const configs: AgentConfig[] = [];

	for (const [name, agentState] of Object.entries(merged.agents)) {
		if (!agentState.enabled) {
			continue;
		}

		const provider = getProvider(name);
		if (!provider) {
			continue;
		}

		const resolved = {
			path: agentState.command,
			source: agentState.commandSource,
		} as const;

		const userOverrides: AgentUserConfig = {
			args: agentState.args,
			env: agentState.env,
			preferredModel: agentState.preferredModel,
			color: agentState.color,
		};

		const spawn = provider.spawnConfig(resolved, userOverrides, merged.permissions.defaultPolicy);

		configs.push({
			name: provider.name,
			command: spawn.command,
			args: spawn.args,
			env: Object.keys(spawn.env).length > 0 ? spawn.env : undefined,
			color: agentState.color ?? provider.color,
			label: provider.label,
			preferredModel: agentState.preferredModel,
		});
	}

	return configs;
}

function buildFallbackConfigs(): AgentConfig[] {
	const configs: AgentConfig[] = [];
	const platform = process.platform;

	for (const provider of getProviders()) {
		if (!provider.supportedPlatforms().includes(platform)) {
			continue;
		}

		const commandName = DEFAULT_COMMANDS[provider.name];
		if (!commandName) {
			continue;
		}

		const resolved = { path: commandName, source: "path" as const };
		const spawn = provider.spawnConfig(resolved, undefined, "full");

		configs.push({
			name: provider.name,
			command: spawn.command,
			args: spawn.args,
			env: Object.keys(spawn.env).length > 0 ? spawn.env : undefined,
			color: provider.color,
			label: provider.label,
		});
	}

	return configs;
}
