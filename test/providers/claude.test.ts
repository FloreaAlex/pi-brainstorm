import { describe, expect, it } from "vitest";
import { ClaudeProvider } from "../../src/providers/claude.js";
import type { AgentUserConfig, ResolvedCommand } from "../../src/providers/types.js";

describe("ClaudeProvider", () => {
	const provider = new ClaudeProvider();

	describe("spawnConfig", () => {
		const resolved: ResolvedCommand = {
			path: "/usr/local/bin/claude-agent-acp",
			source: "path",
		};

		describe("user overrides", () => {
			it("uses user-provided args", () => {
				const overrides: AgentUserConfig = { args: ["--verbose", "--debug"] };
				const config = provider.spawnConfig(resolved, overrides, "full");
				expect(config.args).toEqual(["--verbose", "--debug"]);
			});

			it("merges user-provided env on top of provider env", () => {
				const overrides: AgentUserConfig = {
					env: { CUSTOM_VAR: "value", ACP_PERMISSION_MODE: "custom" },
				};
				const config = provider.spawnConfig(resolved, overrides, "full");
				expect(config.env.CUSTOM_VAR).toBe("value");
				expect(config.env.ACP_PERMISSION_MODE).toBe("custom");
				expect(config.env.CLAUDE_CODE_PERMISSION_MODE).toBe("bypassPermissions");
			});

			it("merges user env on restricted policy (no provider bypass vars)", () => {
				const overrides: AgentUserConfig = { env: { MY_VAR: "hello" } };
				const config = provider.spawnConfig(resolved, overrides, "restricted");
				expect(config.env.MY_VAR).toBe("hello");
				expect(config.env).not.toHaveProperty("ACP_PERMISSION_MODE");
			});

			it("uses default args when user args is null", () => {
				const overrides: AgentUserConfig = { args: null };
				const config = provider.spawnConfig(resolved, overrides, "full");
				expect(config.args).toEqual([]);
			});

			it("uses default env when user env is null", () => {
				const overrides: AgentUserConfig = { env: null };
				const config = provider.spawnConfig(resolved, overrides, "full");
				expect(config.env).toMatchObject({
					ACP_PERMISSION_MODE: "bypassPermissions",
				});
			});
		});

		it("full policy includes bypass env, restricted does not", () => {
			const full = provider.spawnConfig(resolved, undefined, "full");
			expect(full.env).toHaveProperty("ACP_PERMISSION_MODE");
			const restricted = provider.spawnConfig(resolved, undefined, "restricted");
			expect(restricted.env).not.toHaveProperty("ACP_PERMISSION_MODE");
		});
	});
});
