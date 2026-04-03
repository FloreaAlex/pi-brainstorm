import { describe, expect, it } from "vitest";
import { CodexProvider } from "../../src/providers/codex.js";
import type { ResolvedCommand } from "../../src/providers/types.js";

describe("CodexProvider", () => {
	const provider = new CodexProvider();

	describe("identity", () => {
		it("has name 'codex'", () => {
			expect(provider.name).toBe("codex");
		});

		it("has label 'Codex'", () => {
			expect(provider.label).toBe("Codex");
		});

		it("has color '#10b981'", () => {
			expect(provider.color).toBe("#10b981");
		});
	});

	describe("supportedPlatforms", () => {
		it("supports darwin and linux", () => {
			expect(provider.supportedPlatforms()).toEqual(["darwin", "linux"]);
		});

		it("does not support win32", () => {
			expect(provider.supportedPlatforms()).not.toContain("win32");
		});
	});

	describe("permissionModes", () => {
		it("returns empty array", () => {
			expect(provider.permissionModes()).toEqual([]);
		});
	});

	describe("spawnConfig", () => {
		const resolved: ResolvedCommand = {
			path: "/usr/local/bin/codex-acp",
			source: "path",
		};

		describe("full policy", () => {
			it("uses resolved path as command", () => {
				const config = provider.spawnConfig(resolved, undefined, "full");
				expect(config.command).toBe("/usr/local/bin/codex-acp");
			});

			it("includes danger-full-access and approval_policy args", () => {
				const config = provider.spawnConfig(resolved, undefined, "full");
				expect(config.args).toEqual([
					"-c", 'sandbox_mode="danger-full-access"',
					"-c", 'approval_policy="never"',
				]);
			});

			it("includes CODEX_CLI_AUTH_CREDENTIALS_STORE env", () => {
				const config = provider.spawnConfig(resolved, undefined, "full");
				expect(config.env.CODEX_CLI_AUTH_CREDENTIALS_STORE).toBe("file");
			});

			it("includes CODEX_HOME env", () => {
				const config = provider.spawnConfig(resolved, undefined, "full");
				expect(config.env.CODEX_HOME).toBe(`${process.env.HOME}/.codex`);
			});
		});

		describe("restricted policy", () => {
			it("has no sandbox args", () => {
				const config = provider.spawnConfig(resolved, undefined, "restricted");
				expect(config.args).toEqual([]);
			});

			it("still includes base env vars", () => {
				const config = provider.spawnConfig(resolved, undefined, "restricted");
				expect(config.env.CODEX_CLI_AUTH_CREDENTIALS_STORE).toBe("file");
				expect(config.env.CODEX_HOME).toBe(`${process.env.HOME}/.codex`);
			});
		});

		describe("defaults to full policy when omitted", () => {
			it("includes sandbox args when policy is undefined", () => {
				const config = provider.spawnConfig(resolved);
				expect(config.args).toEqual([
					"-c", 'sandbox_mode="danger-full-access"',
					"-c", 'approval_policy="never"',
				]);
			});
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

			it("handles null/undefined overrides gracefully", () => {
				const config = provider.spawnConfig(resolved, {
					args: null,
					env: null,
				}, "full");
				expect(config.args).toEqual([
					"-c", 'sandbox_mode="danger-full-access"',
					"-c", 'approval_policy="never"',
				]);
				expect(config.env.CODEX_CLI_AUTH_CREDENTIALS_STORE).toBe("file");
			});
		});
	});

	describe("describePermissions", () => {
		describe("full policy", () => {
			it("returns provider_full effectiveMode", () => {
				const perms = provider.describePermissions("full");
				expect(perms.effectiveMode).toBe("provider_full");
			});

			it("mentions danger-full-access in notes", () => {
				const perms = provider.describePermissions("full");
				expect(perms.notes.some((n) => n.includes("danger-full-access"))).toBe(true);
			});

			it("mentions approval_policy=never in notes", () => {
				const perms = provider.describePermissions("full");
				expect(perms.notes.some((n) => n.includes("approval_policy=never"))).toBe(true);
			});

			it("mentions file auth in notes", () => {
				const perms = provider.describePermissions("full");
				expect(perms.notes.some((n) => n.includes("file"))).toBe(true);
			});
		});

		describe("restricted policy", () => {
			it("returns provider_restricted effectiveMode", () => {
				const perms = provider.describePermissions("restricted");
				expect(perms.effectiveMode).toBe("provider_restricted");
			});

			it("mentions default sandbox in notes", () => {
				const perms = provider.describePermissions("restricted");
				expect(perms.notes.some((n) => n.includes("default sandbox"))).toBe(true);
			});
		});
	});

	describe("installInstructions", () => {
		it("returns brew command for darwin", () => {
			const instructions = provider.installInstructions("darwin");
			expect(instructions).toContain("brew install");
			expect(instructions).toContain("zed-industries/codex-acp");
		});

		it("returns GitHub link for other platforms", () => {
			const instructions = provider.installInstructions("linux");
			expect(instructions).toContain("github");
		});
	});
});
