import { describe, expect, it } from "vitest";
import { GeminiProvider } from "../../src/providers/gemini.js";
import type { ResolvedCommand, AgentUserConfig } from "../../src/providers/types.js";

describe("GeminiProvider", () => {
	const provider = new GeminiProvider();

	describe("identity", () => {
		it("has name 'gemini'", () => {
			expect(provider.name).toBe("gemini");
		});

		it("has label 'Gemini'", () => {
			expect(provider.label).toBe("Gemini");
		});

		it("has color '#f59e0b'", () => {
			expect(provider.color).toBe("#f59e0b");
		});
	});

	describe("supportedPlatforms", () => {
		it("supports darwin, linux, and win32", () => {
			expect(provider.supportedPlatforms()).toEqual(["darwin", "linux", "win32"]);
		});
	});

	describe("installInstructions", () => {
		it("returns npm install command", () => {
			expect(provider.installInstructions("darwin")).toBe("npm install -g @google/gemini-cli");
		});
	});

	describe("spawnConfig", () => {
		const resolved: ResolvedCommand = { path: "/usr/local/bin/gemini", source: "path" };

		describe("full policy", () => {
			it("uses resolved.path as command", () => {
				const config = provider.spawnConfig(resolved, undefined, "full");
				expect(config.command).toBe("/usr/local/bin/gemini");
			});

			it("includes --acp and --approval-mode=yolo args", () => {
				const config = provider.spawnConfig(resolved, undefined, "full");
				expect(config.args).toEqual(["--acp", "--approval-mode=yolo"]);
			});

			it("includes GEMINI_SANDBOX=false in env", () => {
				const config = provider.spawnConfig(resolved, undefined, "full");
				expect(config.env).toEqual({ GEMINI_SANDBOX: "false" });
			});
		});

		describe("restricted policy", () => {
			it("uses resolved.path as command", () => {
				const config = provider.spawnConfig(resolved, undefined, "restricted");
				expect(config.command).toBe("/usr/local/bin/gemini");
			});

			it("includes only --acp arg", () => {
				const config = provider.spawnConfig(resolved, undefined, "restricted");
				expect(config.args).toEqual(["--acp"]);
			});

			it("has empty env (no GEMINI_SANDBOX)", () => {
				const config = provider.spawnConfig(resolved, undefined, "restricted");
				expect(config.env).toEqual({});
			});
		});

		describe("defaults to full policy when not specified", () => {
			it("defaults to full policy", () => {
				const config = provider.spawnConfig(resolved);
				expect(config.args).toEqual(["--acp", "--approval-mode=yolo"]);
				expect(config.env).toEqual({ GEMINI_SANDBOX: "false" });
			});
		});

		describe("user overrides", () => {
			it("appends user args after provider args (full)", () => {
				const overrides: AgentUserConfig = { args: ["--model", "gemini-2.5-pro"] };
				const config = provider.spawnConfig(resolved, overrides, "full");
				expect(config.args).toEqual(["--acp", "--approval-mode=yolo", "--model", "gemini-2.5-pro"]);
			});

			it("appends user args after provider args (restricted)", () => {
				const overrides: AgentUserConfig = { args: ["--model", "gemini-2.5-pro"] };
				const config = provider.spawnConfig(resolved, overrides, "restricted");
				expect(config.args).toEqual(["--acp", "--model", "gemini-2.5-pro"]);
			});

			it("merges user env with provider env (full)", () => {
				const overrides: AgentUserConfig = { env: { CUSTOM_VAR: "value" } };
				const config = provider.spawnConfig(resolved, overrides, "full");
				expect(config.env).toEqual({ GEMINI_SANDBOX: "false", CUSTOM_VAR: "value" });
			});

			it("merges user env (restricted)", () => {
				const overrides: AgentUserConfig = { env: { CUSTOM_VAR: "value" } };
				const config = provider.spawnConfig(resolved, overrides, "restricted");
				expect(config.env).toEqual({ CUSTOM_VAR: "value" });
			});

			it("user env can override provider env", () => {
				const overrides: AgentUserConfig = { env: { GEMINI_SANDBOX: "true" } };
				const config = provider.spawnConfig(resolved, overrides, "full");
				expect(config.env).toEqual({ GEMINI_SANDBOX: "true" });
			});

			it("ignores null args", () => {
				const overrides: AgentUserConfig = { args: null };
				const config = provider.spawnConfig(resolved, overrides, "full");
				expect(config.args).toEqual(["--acp", "--approval-mode=yolo"]);
			});

			it("ignores null env", () => {
				const overrides: AgentUserConfig = { env: null };
				const config = provider.spawnConfig(resolved, overrides, "full");
				expect(config.env).toEqual({ GEMINI_SANDBOX: "false" });
			});
		});
	});

	describe("permissionModes", () => {
		it("returns empty array", () => {
			expect(provider.permissionModes()).toEqual([]);
		});
	});

	describe("describePermissions", () => {
		it("describes full policy", () => {
			const perms = provider.describePermissions("full");
			expect(perms.policy).toBe("full");
			expect(perms.effectiveMode).toBe("provider_full");
			expect(perms.notes).toContain("--approval-mode=yolo");
			expect(perms.notes.some((n) => n.includes("GEMINI_SANDBOX=false"))).toBe(true);
		});

		it("describes restricted policy", () => {
			const perms = provider.describePermissions("restricted");
			expect(perms.policy).toBe("restricted");
			expect(perms.effectiveMode).toBe("provider_restricted");
			expect(perms.notes.some((n) => n.toLowerCase().includes("default"))).toBe(true);
		});
	});
});
