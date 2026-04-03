import { describe, expect, it } from "vitest";
import { ClaudeProvider } from "../../src/providers/claude.js";
import type { AgentUserConfig, ResolvedCommand } from "../../src/providers/types.js";

describe("ClaudeProvider", () => {
	const provider = new ClaudeProvider();

	describe("identity", () => {
		it("has correct name", () => {
			expect(provider.name).toBe("claude");
		});

		it("has correct label", () => {
			expect(provider.label).toBe("Claude");
		});

		it("has correct color", () => {
			expect(provider.color).toBe("#4a9eff");
		});
	});

	describe("supportedPlatforms", () => {
		it("supports darwin, linux, and win32", () => {
			expect(provider.supportedPlatforms()).toEqual(["darwin", "linux", "win32"]);
		});
	});

	describe("installInstructions", () => {
		it("returns npm install command", () => {
			const instructions = provider.installInstructions("darwin");
			expect(instructions).toBe("npm install -g @agentclientprotocol/claude-agent-acp");
		});
	});

	describe("permissionModes", () => {
		it("returns bypassPermissions", () => {
			expect(provider.permissionModes()).toEqual(["bypassPermissions"]);
		});
	});

	describe("spawnConfig", () => {
		const resolved: ResolvedCommand = {
			path: "/usr/local/bin/claude-agent-acp",
			source: "path",
		};

		describe("full policy", () => {
			it("uses resolved path as command", () => {
				const config = provider.spawnConfig(resolved, undefined, "full");
				expect(config.command).toBe("/usr/local/bin/claude-agent-acp");
			});

			it("defaults to empty args", () => {
				const config = provider.spawnConfig(resolved, undefined, "full");
				expect(config.args).toEqual([]);
			});

			it("includes bypass permission env vars", () => {
				const config = provider.spawnConfig(resolved, undefined, "full");
				expect(config.env).toMatchObject({
					ACP_PERMISSION_MODE: "bypassPermissions",
					CLAUDE_CODE_PERMISSION_MODE: "bypassPermissions",
				});
			});
		});

		describe("restricted policy", () => {
			it("uses resolved path as command", () => {
				const config = provider.spawnConfig(resolved, undefined, "restricted");
				expect(config.command).toBe("/usr/local/bin/claude-agent-acp");
			});

			it("defaults to empty args", () => {
				const config = provider.spawnConfig(resolved, undefined, "restricted");
				expect(config.args).toEqual([]);
			});

			it("does NOT include bypass permission env vars", () => {
				const config = provider.spawnConfig(resolved, undefined, "restricted");
				expect(config.env).not.toHaveProperty("ACP_PERMISSION_MODE");
				expect(config.env).not.toHaveProperty("CLAUDE_CODE_PERMISSION_MODE");
			});
		});

		describe("defaults to full policy when unspecified", () => {
			it("includes bypass env vars", () => {
				const config = provider.spawnConfig(resolved);
				expect(config.env).toMatchObject({
					ACP_PERMISSION_MODE: "bypassPermissions",
					CLAUDE_CODE_PERMISSION_MODE: "bypassPermissions",
				});
			});
		});

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
				// User override wins over provider default
				expect(config.env.ACP_PERMISSION_MODE).toBe("custom");
				// Provider env var that wasn't overridden stays
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
	});

	describe("describePermissions", () => {
		describe("full policy", () => {
			it("returns provider_full effective mode", () => {
				const perms = provider.describePermissions("full");
				expect(perms.effectiveMode).toBe("provider_full");
			});

			it("returns policy full", () => {
				const perms = provider.describePermissions("full");
				expect(perms.policy).toBe("full");
			});

			it("includes notes about ACP bypass mode", () => {
				const perms = provider.describePermissions("full");
				expect(perms.notes.length).toBeGreaterThan(0);
				const joined = perms.notes.join(" ");
				expect(joined).toMatch(/bypass/i);
			});

			it("includes notes about env vars", () => {
				const perms = provider.describePermissions("full");
				const joined = perms.notes.join(" ");
				expect(joined).toMatch(/ACP_PERMISSION_MODE/);
			});

			it("includes notes about prompt marker", () => {
				const perms = provider.describePermissions("full");
				const joined = perms.notes.join(" ");
				expect(joined).toMatch(/\[ACP:PERMISSION:BYPASS\]/);
			});
		});

		describe("restricted policy", () => {
			it("returns provider_restricted effective mode", () => {
				const perms = provider.describePermissions("restricted");
				expect(perms.effectiveMode).toBe("provider_restricted");
			});

			it("returns policy restricted", () => {
				const perms = provider.describePermissions("restricted");
				expect(perms.policy).toBe("restricted");
			});

			it("includes notes about default mode with approval prompts", () => {
				const perms = provider.describePermissions("restricted");
				expect(perms.notes.length).toBeGreaterThan(0);
				const joined = perms.notes.join(" ");
				expect(joined).toMatch(/default|approval|prompt/i);
			});
		});
	});
});
