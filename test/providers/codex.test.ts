import { describe, expect, it } from "vitest";
import { CodexProvider } from "../../src/providers/codex.js";
import type { ResolvedCommand } from "../../src/providers/types.js";

describe("CodexProvider", () => {
	const provider = new CodexProvider();

	describe("spawnConfig", () => {
		const resolved: ResolvedCommand = {
			path: "/usr/local/bin/codex-acp",
			source: "path",
		};

		it("full policy includes sandbox args, restricted does not", () => {
			const full = provider.spawnConfig(resolved, undefined, "full");
			expect(full.args.some((a) => a.includes("danger-full-access"))).toBe(true);
			const restricted = provider.spawnConfig(resolved, undefined, "restricted");
			expect(restricted.args).toEqual([]);
		});

		describe("user overrides", () => {
			it("appends user args after policy args for full policy", () => {
				const config = provider.spawnConfig(resolved, {
					args: ["--verbose", "--timeout=30"],
				}, "full");
				expect(config.args).toEqual([
					"-c", 'sandbox_mode="danger-full-access"',
					"-c", 'approval_policy="never"',
					"--verbose",
					"--timeout=30",
				]);
			});

			it("uses user args alone for restricted policy", () => {
				const config = provider.spawnConfig(resolved, {
					args: ["--verbose"],
				}, "restricted");
				expect(config.args).toEqual(["--verbose"]);
			});

			it("merges user env overrides with base env", () => {
				const config = provider.spawnConfig(resolved, {
					env: { MY_VAR: "test", CODEX_HOME: "/custom/path" },
				}, "full");
				expect(config.env.MY_VAR).toBe("test");
				expect(config.env.CODEX_HOME).toBe("/custom/path");
				expect(config.env.CODEX_CLI_AUTH_CREDENTIALS_STORE).toBe("file");
			});

			it("handles null overrides gracefully", () => {
				const config = provider.spawnConfig(resolved, {
					args: null,
					env: null,
				}, "full");
				expect(config.args.some((a) => a.includes("danger-full-access"))).toBe(true);
				expect(config.env.CODEX_CLI_AUTH_CREDENTIALS_STORE).toBe("file");
			});
		});
	});
});
