import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GeminiProvider } from "../../src/providers/gemini.js";
import type { ResolvedCommand, AgentUserConfig } from "../../src/providers/types.js";

describe("GeminiProvider", () => {
	const provider = new GeminiProvider();
	let tmpDirs: string[] = [];

	function makeTmpDir(): string {
		const dir = mkdtempSync(join(tmpdir(), "pi-brainstorm-gemini-"));
		tmpDirs.push(dir);
		return dir;
	}

	function writeExecutable(path: string): void {
		writeFileSync(path, "#!/bin/sh\nexit 0\n");
		chmodSync(path, 0o755);
	}

	afterEach(() => {
		for (const dir of tmpDirs) {
			rmSync(dir, { recursive: true, force: true });
		}
		tmpDirs = [];
	});

	describe("resolveCommand", () => {
		it("uses the provided packageRoot instead of process.cwd()", async () => {
			const packageRoot = makeTmpDir();
			const managedToolsRoot = makeTmpDir();
			const binDir = join(packageRoot, "node_modules", ".bin");
			const commandPath = join(binDir, "gemini");
			mkdirSync(binDir, { recursive: true });
			writeExecutable(commandPath);

			const resolved = await provider.resolveCommand({ packageRoot, managedToolsRoot });

			expect(resolved).toEqual({
				path: commandPath,
				source: "node_modules",
			});
		});

		it("prefers managed tools over package-local node_modules", async () => {
			const packageRoot = makeTmpDir();
			const managedToolsRoot = makeTmpDir();
			const packageBin = join(packageRoot, "node_modules", ".bin");
			const managedBin = join(managedToolsRoot, "node_modules", ".bin");
			const packageCommand = join(packageBin, "gemini");
			const managedCommand = join(managedBin, "gemini");
			mkdirSync(packageBin, { recursive: true });
			mkdirSync(managedBin, { recursive: true });
			writeExecutable(packageCommand);
			writeExecutable(managedCommand);

			const resolved = await provider.resolveCommand({ packageRoot, managedToolsRoot });

			expect(resolved).toEqual({
				path: managedCommand,
				source: "managed",
			});
		});
	});

	describe("spawnConfig", () => {
		const resolved: ResolvedCommand = { path: "/usr/local/bin/gemini", source: "path" };

		it("full policy includes yolo mode and sandbox disable, restricted does not", () => {
			const full = provider.spawnConfig(resolved, undefined, "full");
			expect(full.args).toContain("--approval-mode=yolo");
			expect(full.env.GEMINI_SANDBOX).toBe("false");

			const restricted = provider.spawnConfig(resolved, undefined, "restricted");
			expect(restricted.args).not.toContain("--approval-mode=yolo");
			expect(restricted.env).not.toHaveProperty("GEMINI_SANDBOX");
		});

		it("both policies include --acp", () => {
			const full = provider.spawnConfig(resolved, undefined, "full");
			expect(full.args).toContain("--acp");
			const restricted = provider.spawnConfig(resolved, undefined, "restricted");
			expect(restricted.args).toContain("--acp");
		});

		describe("user overrides", () => {
			it("appends user args after provider args", () => {
				const overrides: AgentUserConfig = { args: ["--model", "gemini-2.5-pro"] };
				const config = provider.spawnConfig(resolved, overrides, "full");
				expect(config.args).toEqual(["--acp", "--approval-mode=yolo", "--model", "gemini-2.5-pro"]);
			});

			it("user env can override provider env", () => {
				const overrides: AgentUserConfig = { env: { GEMINI_SANDBOX: "true" } };
				const config = provider.spawnConfig(resolved, overrides, "full");
				expect(config.env.GEMINI_SANDBOX).toBe("true");
			});

			it("ignores null args and env", () => {
				const overrides: AgentUserConfig = { args: null, env: null };
				const config = provider.spawnConfig(resolved, overrides, "full");
				expect(config.args).toContain("--acp");
				expect(config.env).toHaveProperty("GEMINI_SANDBOX");
			});
		});
	});
});
