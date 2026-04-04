import { describe, expect, it } from "vitest";
import { buildSelectionsFromProvisionResults } from "../src/setup/run-wizard.js";
import type { EnvironmentReport } from "../src/setup/environment.js";
import type { ProvisionResult } from "../src/installer/index.js";

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
				authenticated: false,
			},
			codex: {
				supported: true,
				installed: false,
				authenticated: false,
			},
			gemini: {
				supported: true,
				resolved: { path: "/bin/gemini", source: "managed" },
				installed: true,
				authenticated: true,
			},
		},
	};
}

describe("buildSelectionsFromProvisionResults", () => {
	it("omits providers that are still not installed after skipped or failed install", () => {
		const results: ProvisionResult[] = [
			{ provider: "codex", action: "skipped" },
		];

		expect(buildSelectionsFromProvisionResults(makeReport(), results)).toEqual({
			codex: { include: false },
		});
	});

	it("keeps installed providers in config after auth failure", () => {
		const results: ProvisionResult[] = [
			{ provider: "claude", action: "failed", error: "login required" },
		];

		expect(buildSelectionsFromProvisionResults(makeReport(), results)).toEqual({});
	});
});
