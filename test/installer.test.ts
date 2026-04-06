import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prompter } from "../src/setup/primitives.js";
import type { EnvironmentReport } from "../src/setup/environment.js";

const { spawnSyncMock } = vi.hoisted(() => ({
	spawnSyncMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	spawnSync: spawnSyncMock,
}));

import { determineActions, runAuth } from "../src/installer/index.js";

function makeReport(): EnvironmentReport {
	return {
		prerequisites: {
			node: { ok: true, version: "v22.0.0" },
			npm: { ok: true, version: "10.0.0" },
			git: { ok: true, version: "2.0.0" },
			pi: { ok: true, version: "1.0.0" },
		},
		configs: {
			machineConfigPath: "/machine/config.json",
			machineConfigExists: true,
			projectConfigPath: "/repo/brainstorm.config.json",
			projectConfigExists: false,
		},
		extension: {
			symlinkPath: "/symlink",
			symlinked: true,
			targetOk: true,
			target: "/repo",
		},
		providers: {
			claude: {
				supported: true,
				resolved: { path: "/bin/claude-agent-acp", source: "managed" },
				installed: true,
				authenticated: true,
			},
			codex: {
				supported: true,
				resolved: { path: "/bin/codex-acp", source: "path" },
				installed: true,
				authenticated: false,
				authError: "login required",
				loginCommand: "codex login",
			},
			gemini: {
				supported: true,
				installed: false,
				authenticated: false,
				installSpec: {
					kind: "npm",
					summary: "npm install --prefix /tools @google/gemini-cli",
					command: "npm",
					args: ["install", "--prefix", "/tools", "@google/gemini-cli"],
					autoInstallable: true,
				},
			},
		},
	};
}

describe("determineActions", () => {
	it("returns structured auth commands from providers instead of reparsed text", () => {
		const actions = determineActions(makeReport());
		const codex = actions.auth.find((entry) => entry.name === "codex");

		expect(codex).toBeDefined();
		expect(codex?.loginCommand).toBe("codex login");
		expect(codex?.authCommand).toEqual({
			command: "codex",
			args: ["login"],
		});
	});
});

describe("runAuth", () => {
	beforeEach(() => {
		spawnSyncMock.mockReset();
		spawnSyncMock.mockReturnValue({ status: 0 });
	});

	it("uses the structured auth command and pauses prompt handling around the child process", () => {
		const events: string[] = [];
		const prompter: Prompter = {
			ask: async () => "",
			pause: () => events.push("pause"),
			resume: () => events.push("resume"),
			close: () => events.push("close"),
		};

		runAuth([
			{
				name: "codex",
				label: "Codex",
				loginCommand: 'codex login --profile "Team A"',
				authCommand: {
					command: "codex",
					args: ["auth", "--profile", "Team A"],
					env: { CODEX_HOME: "/tmp/codex-home" },
				},
			},
		], prompter, () => {});

		expect(events).toEqual(["pause", "resume"]);
		expect(spawnSyncMock).toHaveBeenCalledWith("codex", ["auth", "--profile", "Team A"], expect.objectContaining({
			stdio: "inherit",
			timeout: 120_000,
			env: expect.objectContaining({
				CODEX_HOME: "/tmp/codex-home",
			}),
		}));
	});
});
