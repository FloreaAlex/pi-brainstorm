import { describe, expect, it } from "vitest";
import { buildMachineConfig } from "../src/setup/primitives.js";
import type { EnvironmentReport } from "../src/setup/environment.js";

function makeReport(overrides?: Partial<EnvironmentReport>): EnvironmentReport {
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
				supported: false,
				installed: false,
				authenticated: false,
			},
		},
		...overrides,
	};
}

describe("buildMachineConfig", () => {
	it("includes installed providers by default and enables only authenticated ones", () => {
		const config = buildMachineConfig(makeReport(), "full");

		expect(config.agents.claude.enabled).toBe(true);
		expect(config.agents.codex.enabled).toBe(false);
		expect(config.agents.codex.command).toBe("/bin/codex-acp");
		expect(config.agents.gemini).toBeUndefined();
	});

	it("allows wizard selections to omit a provider entirely", () => {
		const config = buildMachineConfig(makeReport(), "restricted", {
			codex: { include: false },
		});

		expect(config.agents.codex).toBeUndefined();
		expect(config.agents.claude).toBeDefined();
	});

	it("allows wizard selections to force a provider disabled", () => {
		const config = buildMachineConfig(makeReport(), "full", {
			claude: { enabled: false },
		});

		expect(config.agents.claude.enabled).toBe(false);
	});
});
