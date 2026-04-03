import { describe, expect, it, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrainstormConfig, MachineAgentState } from "../src/providers/types.js";
import {
	loadMachineConfig,
	loadProjectConfig,
	mergeConfigs,
	writeMachineConfig,
	resolveAgentConfigs,
} from "../src/config.js";

function makeConfig(overrides: Partial<BrainstormConfig> = {}): BrainstormConfig {
	return { version: 1, permissions: { defaultPolicy: "full" }, agents: {}, ...overrides };
}

function makeAgentState(overrides: Partial<MachineAgentState> = {}): MachineAgentState {
	return {
		enabled: true,
		command: "/usr/local/bin/test-agent",
		commandSource: "path",
		auth: { ok: true, checkedAt: new Date().toISOString() },
		...overrides,
	};
}

let tmpDirs: string[] = [];

function makeTmpDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-brainstorm-test-"));
	tmpDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tmpDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
	tmpDirs = [];
});

describe("loadMachineConfig", () => {
	it("returns null when config dir does not exist", () => {
		const result = loadMachineConfig("/nonexistent/path");
		expect(result).toBeNull();
	});

	it("returns null when config.json is missing", () => {
		const dir = makeTmpDir();
		const result = loadMachineConfig(dir);
		expect(result).toBeNull();
	});

	it("returns null when config.json is invalid JSON", () => {
		const dir = makeTmpDir();
		writeFileSync(join(dir, "config.json"), "not json{{{");
		const result = loadMachineConfig(dir);
		expect(result).toBeNull();
	});

	it("loads a valid config.json", () => {
		const dir = makeTmpDir();
		const config = makeConfig({
			agents: { claude: makeAgentState() },
		});
		writeFileSync(join(dir, "config.json"), JSON.stringify(config));
		const result = loadMachineConfig(dir);
		expect(result).toEqual(config);
	});
});

describe("loadProjectConfig", () => {
	it("returns null when brainstorm.config.json is missing", () => {
		const dir = makeTmpDir();
		const result = loadProjectConfig(dir);
		expect(result).toBeNull();
	});

	it("returns null when brainstorm.config.json is invalid JSON", () => {
		const dir = makeTmpDir();
		writeFileSync(join(dir, "brainstorm.config.json"), "{{bad");
		const result = loadProjectConfig(dir);
		expect(result).toBeNull();
	});

	it("loads brainstorm.config.json", () => {
		const dir = makeTmpDir();
		const partial = { permissions: { defaultPolicy: "restricted" as const } };
		writeFileSync(join(dir, "brainstorm.config.json"), JSON.stringify(partial));
		const result = loadProjectConfig(dir);
		expect(result).toEqual(partial);
	});
});

describe("mergeConfigs", () => {
	it("returns machine config unchanged when project is null", () => {
		const machine = makeConfig({ agents: { claude: makeAgentState() } });
		const result = mergeConfigs(machine, null);
		expect(result).toEqual(machine);
	});

	it("scalars override", () => {
		const machine = makeConfig({ permissions: { defaultPolicy: "full" } });
		const project: Partial<BrainstormConfig> = { permissions: { defaultPolicy: "restricted" } };
		const result = mergeConfigs(machine, project);
		expect(result.permissions.defaultPolicy).toBe("restricted");
	});

	it("objects merge recursively", () => {
		const machine = makeConfig({
			agents: {
				claude: makeAgentState({ command: "/usr/bin/claude" }),
				codex: makeAgentState({ command: "/usr/bin/codex" }),
			},
		});
		const project: Partial<BrainstormConfig> = {
			agents: {
				claude: makeAgentState({ command: "/opt/claude", enabled: false }),
			},
		};
		const result = mergeConfigs(machine, project);
		// claude should be overridden
		expect(result.agents.claude.command).toBe("/opt/claude");
		expect(result.agents.claude.enabled).toBe(false);
		// codex should still be present from machine
		expect(result.agents.codex).toBeDefined();
		expect(result.agents.codex.command).toBe("/usr/bin/codex");
	});

	it("null resets to undefined", () => {
		const machine = makeConfig({
			prompts: { brainstorm: "custom prompt", auto: "custom auto" },
		});
		const project = { prompts: { brainstorm: null as unknown as string } };
		const result = mergeConfigs(machine, project as Partial<BrainstormConfig>);
		// brainstorm should be reset (undefined/deleted)
		expect(result.prompts?.brainstorm).toBeUndefined();
		// auto should still be present
		expect(result.prompts?.auto).toBe("custom auto");
	});

	it("arrays replace entirely", () => {
		const machine = makeConfig({
			agents: {
				codex: makeAgentState({ args: ["-c", "foo"] }),
			},
		});
		const project: Partial<BrainstormConfig> = {
			agents: {
				codex: makeAgentState({ args: ["-c", "bar", "-c", "baz"] }),
			},
		};
		const result = mergeConfigs(machine, project);
		expect(result.agents.codex.args).toEqual(["-c", "bar", "-c", "baz"]);
	});
});

describe("writeMachineConfig", () => {
	it("writes config.json and creates dirs as needed", () => {
		const dir = makeTmpDir();
		const nested = join(dir, "sub", "dir");
		const config = makeConfig({ agents: { claude: makeAgentState() } });
		writeMachineConfig(nested, config);

		const loaded = loadMachineConfig(nested);
		expect(loaded).toEqual(config);
	});

	it("overwrites existing config", () => {
		const dir = makeTmpDir();
		const config1 = makeConfig({ permissions: { defaultPolicy: "full" } });
		const config2 = makeConfig({ permissions: { defaultPolicy: "restricted" } });

		writeMachineConfig(dir, config1);
		writeMachineConfig(dir, config2);

		const loaded = loadMachineConfig(dir);
		expect(loaded?.permissions.defaultPolicy).toBe("restricted");
	});
});

describe("resolveAgentConfigs", () => {
	it("returns configs for all supported-platform providers when no machine config exists", () => {
		const dir = makeTmpDir();
		const configs = resolveAgentConfigs(dir);

		// Should have entries for providers that support current platform
		expect(configs.length).toBeGreaterThan(0);

		// Each config should have required AgentConfig fields
		for (const cfg of configs) {
			expect(cfg.name).toBeDefined();
			expect(cfg.command).toBeDefined();
			expect(cfg.args).toBeInstanceOf(Array);
			expect(cfg.color).toBeDefined();
			expect(cfg.label).toBeDefined();
		}

		// On darwin, all three should be present
		if (process.platform === "darwin") {
			const names = configs.map((c) => c.name);
			expect(names).toContain("claude");
			expect(names).toContain("codex");
			expect(names).toContain("gemini");
		}
	});

	it("uses machine config agents when config exists", () => {
		const dir = makeTmpDir();
		const configDir = makeTmpDir();
		const config = makeConfig({
			permissions: { defaultPolicy: "full" },
			agents: {
				claude: makeAgentState({
					command: "/opt/special-claude",
					commandSource: "path",
				}),
			},
		});
		writeMachineConfig(configDir, config);

		const configs = resolveAgentConfigs(dir, configDir);

		// Should include claude with the config's command
		const claude = configs.find((c) => c.name === "claude");
		expect(claude).toBeDefined();
		expect(claude!.command).toBe("/opt/special-claude");
	});

	it("skips disabled agents", () => {
		const dir = makeTmpDir();
		const configDir = makeTmpDir();
		const config = makeConfig({
			agents: {
				claude: makeAgentState({ enabled: false }),
				codex: makeAgentState({ enabled: true, command: "/usr/bin/codex-acp" }),
			},
		});
		writeMachineConfig(configDir, config);

		const configs = resolveAgentConfigs(dir, configDir);
		const names = configs.map((c) => c.name);
		expect(names).not.toContain("claude");
		expect(names).toContain("codex");
	});
});
