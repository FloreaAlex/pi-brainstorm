# Distributable Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn pi-brainstorm into a clone-and-run project with one-command setup, provider registry, config system, and diagnostics.

**Architecture:** Extract hardcoded agent configs into a provider registry (`src/providers/`). Add a config system (`src/config.ts`) that reads machine + project config and merges them. Add a CLI (`src/cli.ts`) with setup wizard and doctor. Restructure existing extension code into `src/extension/`. Move prompts to `prompts/` to eliminate the build-step copy hack.

**Tech Stack:** TypeScript, ACP SDK (`@agentclientprotocol/sdk`), Node.js child_process, pi-tui, vitest

---

## File Structure

### New files to create
- `src/providers/types.ts` — Provider interface, ResolvedCommand, AuthResult, SpawnConfig, ProviderPermissions
- `src/providers/claude.ts` — Claude provider implementation
- `src/providers/codex.ts` — Codex provider implementation
- `src/providers/gemini.ts` — Gemini provider implementation
- `src/providers/registry.ts` — Provider registry (list of all built-in providers)
- `src/providers/smoke-test.ts` — Shared ACP smoke test helper for auth checks
- `src/config.ts` — Config loading, merging, writing, and agent config resolution
- `src/setup/wizard.ts` — Interactive setup wizard
- `src/setup/doctor.ts` — Diagnostics command
- `src/cli.ts` — CLI entry point (`setup` and `doctor` commands)
- `prompts/BRAINSTORM.md` — Moved from `src/PROMPT.md`
- `prompts/AUTO.md` — Moved from `src/AUTO_PROMPT.md`
- `test/providers/claude.test.ts`
- `test/providers/codex.test.ts`
- `test/providers/gemini.test.ts`
- `test/providers/registry.test.ts`
- `test/config.test.ts`

### Files to move (restructure)
- `src/index.ts` → `src/extension/index.ts`
- `src/orchestrator.ts` → `src/extension/orchestrator.ts`
- `src/agents.ts` → `src/extension/agents.ts`
- `src/renderer.ts` → `src/extension/renderer.ts`
- `src/split-column.ts` → `src/extension/split-column.ts`
- `src/types.ts` → `src/extension/types.ts`

### Files to modify
- `src/prompt.ts` — Update prompt file paths to resolve from package root
- `package.json` — Update `pi.extensions`, `scripts`, add `private: true`
- `tsconfig.json` — No changes needed (`rootDir: "src"` still works)
- `test/agents.test.ts` — Update import paths
- `test/orchestrator.test.ts` — Update import paths

### Import boundary rules
- Nothing in `src/extension/` imports from `src/setup/`
- Both `src/extension/` and `src/setup/` may import from `src/providers/`
- Both `src/extension/` and `src/setup/` may import from `src/config.ts` and `src/prompt.ts`

---

### Task 1: Repo restructure — move extension files to `src/extension/`

**Files:**
- Move: `src/index.ts` → `src/extension/index.ts`
- Move: `src/orchestrator.ts` → `src/extension/orchestrator.ts`
- Move: `src/agents.ts` → `src/extension/agents.ts`
- Move: `src/renderer.ts` → `src/extension/renderer.ts`
- Move: `src/split-column.ts` → `src/extension/split-column.ts`
- Move: `src/types.ts` → `src/extension/types.ts`
- Modify: `src/extension/orchestrator.ts` (update prompt.ts import)
- Modify: `package.json` (update pi.extensions path)
- Modify: `test/agents.test.ts` (update import path)
- Modify: `test/orchestrator.test.ts` (update import path)

- [ ] **Step 1: Create `src/extension/` directory and move files**

```bash
mkdir -p src/extension
git mv src/index.ts src/extension/index.ts
git mv src/orchestrator.ts src/extension/orchestrator.ts
git mv src/agents.ts src/extension/agents.ts
git mv src/renderer.ts src/extension/renderer.ts
git mv src/split-column.ts src/extension/split-column.ts
git mv src/types.ts src/extension/types.ts
```

- [ ] **Step 2: Fix the one cross-directory import**

In `src/extension/orchestrator.ts`, the import of `prompt.ts` changes from `./prompt.js` to `../prompt.js` because `prompt.ts` stays at `src/prompt.ts`:

```typescript
// src/extension/orchestrator.ts line 3
// BEFORE:
import { buildAgentPrompt, buildAutoPrompt } from "./prompt.js";
// AFTER:
import { buildAgentPrompt, buildAutoPrompt } from "../prompt.js";
```

All other imports within `src/extension/` are `./` relative and don't change since all 6 files moved together.

- [ ] **Step 3: Update `package.json` extension path**

```json
// BEFORE:
"pi": { "extensions": ["dist/index.js"] }
// AFTER:
"pi": { "extensions": ["dist/extension/index.js"] }
```

- [ ] **Step 4: Update test imports**

In `test/agents.test.ts`:
```typescript
// BEFORE:
import { AgentManager } from "../src/agents.js";
import type { AgentConfig } from "../src/types.js";
// AFTER:
import { AgentManager } from "../src/extension/agents.js";
import type { AgentConfig } from "../src/extension/types.js";
```

In `test/orchestrator.test.ts`:
```typescript
// BEFORE:
import { Orchestrator, parseMentions } from "../src/orchestrator.js";
import { AgentManager } from "../src/agents.js";
import type { AgentConfig } from "../src/types.js";
// AFTER:
import { Orchestrator, parseMentions } from "../src/extension/orchestrator.js";
import { AgentManager } from "../src/extension/agents.js";
import type { AgentConfig } from "../src/extension/types.js";
```

`test/prompt.test.ts` imports from `../src/prompt.js` — no change needed since `prompt.ts` stays at `src/`.

- [ ] **Step 5: Build and run tests**

```bash
npm run build && npm test
```

Expected: All tests pass. Build produces files under `dist/extension/`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: move extension files to src/extension/"
```

---

### Task 2: Move prompts to `prompts/` and remove build hack

**Files:**
- Move: `src/PROMPT.md` → `prompts/BRAINSTORM.md`
- Move: `src/AUTO_PROMPT.md` → `prompts/AUTO.md`
- Modify: `src/prompt.ts` (update file paths)
- Modify: `package.json` (remove `cp` from build script)
- Test: `test/prompt.test.ts` (add prompt loading test)

- [ ] **Step 1: Write a failing test for prompt loading from new paths**

Add to `test/prompt.test.ts`:

```typescript
import { loadPromptTemplate, loadAutoPromptTemplate } from "../src/prompt.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

describe("prompt loading", () => {
	it("loads brainstorm prompt from prompts/BRAINSTORM.md", () => {
		const template = loadPromptTemplate(projectRoot);
		expect(template).toContain("brainstorming session");
	});

	it("loads auto prompt from prompts/AUTO.md", () => {
		const template = loadAutoPromptTemplate();
		expect(template).toContain("autonomous discussion");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test
```

Expected: FAIL — prompts not yet at new paths.

- [ ] **Step 3: Move prompt files**

```bash
mkdir -p prompts
git mv src/PROMPT.md prompts/BRAINSTORM.md
git mv src/AUTO_PROMPT.md prompts/AUTO.md
```

- [ ] **Step 4: Update `src/prompt.ts` to resolve from package root**

The `__dirname` at runtime is `dist/` (compiled) or `src/` (if running ts directly). Going up one level reaches the package root where `prompts/` lives.

```typescript
// src/prompt.ts — replace the two functions that load from __dirname

const packageRoot = join(__dirname, "..");

export function loadPromptTemplate(cwd: string): string {
	const projectPrompt = join(cwd, "BRAINSTORM_PROMPT.md");
	if (existsSync(projectPrompt)) {
		return readFileSync(projectPrompt, "utf-8");
	}
	return readFileSync(join(packageRoot, "prompts", "BRAINSTORM.md"), "utf-8");
}

export function loadAutoPromptTemplate(): string {
	return readFileSync(join(packageRoot, "prompts", "AUTO.md"), "utf-8");
}
```

- [ ] **Step 5: Remove `cp` from build script in `package.json`**

```json
// BEFORE:
"build": "tsc && cp src/PROMPT.md src/AUTO_PROMPT.md dist/"
// AFTER:
"build": "tsc"
```

- [ ] **Step 6: Build and run tests**

```bash
npm run build && npm test
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: move prompts to prompts/ directory, remove build copy hack"
```

---

### Task 3: Provider types

**Files:**
- Create: `src/providers/types.ts`

- [ ] **Step 1: Create provider types file**

```typescript
// src/providers/types.ts

export interface ResolvedCommand {
	path: string;
	source: "bundled" | "node_modules" | "path" | "variant";
}

export interface AuthResult {
	ok: boolean;
	checkedAt: string;
	error?: string;
	loginCommand: string;
}

export interface SpawnConfig {
	command: string;
	args: string[];
	env: Record<string, string>;
}

export interface ProviderPermissions {
	policy: "full" | "restricted";
	effectiveMode: "provider_full" | "provider_restricted" | "unsupported";
	notes: string[];
}

export interface AgentUserConfig {
	enabled?: boolean;
	command?: string | null;
	args?: string[] | null;
	env?: Record<string, string> | null;
	preferredModel?: string | null;
	color?: string | null;
}

export interface MachineAgentState {
	enabled: boolean;
	command: string;
	commandSource: "bundled" | "node_modules" | "path" | "variant";
	args?: string[];
	env?: Record<string, string>;
	preferredModel?: string;
	color?: string;
	auth: {
		ok: boolean;
		checkedAt: string;
		error?: string;
	};
}

export interface BrainstormConfig {
	version: 1;
	permissions: {
		defaultPolicy: "full" | "restricted";
	};
	agents: Record<string, MachineAgentState>;
	prompts?: {
		brainstorm?: string;
		auto?: string;
	};
}

export interface Provider {
	name: string;
	label: string;
	color: string;
	supportedPlatforms(): NodeJS.Platform[];
	resolveCommand(): Promise<ResolvedCommand | null>;
	installInstructions(platform: NodeJS.Platform): string;
	checkAuth(command: string): Promise<AuthResult>;
	spawnConfig(
		resolved: ResolvedCommand,
		userOverrides?: AgentUserConfig,
		permissionPolicy?: "full" | "restricted",
	): SpawnConfig;
	permissionModes(): string[];
	describePermissions(policy: "full" | "restricted"): ProviderPermissions;
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run build
```

Expected: Clean compile.

- [ ] **Step 3: Commit**

```bash
git add src/providers/types.ts
git commit -m "feat: add provider types and config interfaces"
```

---

### Task 4: ACP smoke test helper

**Files:**
- Create: `src/providers/smoke-test.ts`

- [ ] **Step 1: Create the shared smoke test helper**

All providers use the same ACP handshake sequence for auth verification. This helper spawns the command, runs the ACP init → session → prompt cycle, and returns the result.

```typescript
// src/providers/smoke-test.ts
import { spawn, type ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

export interface SmokeTestOptions {
	command: string;
	args: string[];
	env: Record<string, string>;
	timeoutMs?: number;
}

export async function acpSmokeTest(options: SmokeTestOptions): Promise<{ ok: boolean; error?: string }> {
	const { command, args, env, timeoutMs = 30_000 } = options;
	let proc: ChildProcess | null = null;

	try {
		proc = spawn(command, args, {
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, ...env },
		});
		proc.stderr?.resume();

		const input = Writable.toWeb(proc.stdin!);
		const output = Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>;
		const stream = acp.ndJsonStream(input, output);

		// Suppress ACP SDK validation noise
		const origErr = console.error;
		console.error = (...a: unknown[]) => {
			const msg = String(a[0] ?? "");
			if (msg.includes("Error handling notification") || msg.includes("Invalid params")) return;
			origErr(...a);
		};

		const connection = new acp.ClientSideConnection(
			() => ({
				requestPermission: async (params: any) => {
					const opts = params.options ?? [];
					return { outcome: { outcome: "selected", optionId: opts[0]?.id ?? "allow" } };
				},
				sessionUpdate: async () => {},
			}),
			stream,
		);

		const timeout = <T>(p: Promise<T>): Promise<T> =>
			Promise.race([
				p,
				new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Smoke test timed out")), timeoutMs)),
			]);

		const initResult = await timeout(
			connection.initialize({
				protocolVersion: acp.PROTOCOL_VERSION,
				clientCapabilities: {},
			}),
		);

		if (initResult.authMethods && initResult.authMethods.length > 0) {
			await timeout(connection.authenticate({ methodId: initResult.authMethods[0].id }));
		}

		const session = await timeout(connection.newSession({ cwd: process.cwd(), mcpServers: [] }));

		await timeout(
			connection.prompt({
				sessionId: session.sessionId,
				prompt: [{ type: "text" as const, text: "reply OK" }],
			}),
		);

		console.error = origErr;
		return { ok: true };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	} finally {
		if (proc && proc.exitCode === null) {
			proc.kill();
			// Wait briefly for cleanup
			await new Promise<void>((r) => {
				proc!.on("exit", r);
				setTimeout(() => { proc!.kill("SIGKILL"); r(); }, 3000);
			});
		}
	}
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/providers/smoke-test.ts
git commit -m "feat: add shared ACP smoke test helper for provider auth checks"
```

---

### Task 5: Claude provider + tests

**Files:**
- Create: `src/providers/claude.ts`
- Create: `test/providers/claude.test.ts`

- [ ] **Step 1: Write failing tests for Claude provider**

```typescript
// test/providers/claude.test.ts
import { describe, expect, it } from "vitest";
import { ClaudeProvider } from "../src/providers/claude.js";

describe("ClaudeProvider", () => {
	const provider = new ClaudeProvider();

	it("has correct identity", () => {
		expect(provider.name).toBe("claude");
		expect(provider.label).toBe("Claude");
		expect(provider.color).toBe("#4a9eff");
	});

	it("supports darwin and linux", () => {
		const platforms = provider.supportedPlatforms();
		expect(platforms).toContain("darwin");
		expect(platforms).toContain("linux");
	});

	it("returns install instructions", () => {
		const instructions = provider.installInstructions("darwin");
		expect(instructions).toContain("claude-agent-acp");
	});

	it("returns bypassPermissions as a permission mode", () => {
		expect(provider.permissionModes()).toContain("bypassPermissions");
	});

	describe("spawnConfig", () => {
		const resolved = { path: "/usr/local/bin/claude-agent-acp", source: "path" as const };

		it("full policy sets bypass env vars", () => {
			const config = provider.spawnConfig(resolved, undefined, "full");
			expect(config.command).toBe("/usr/local/bin/claude-agent-acp");
			expect(config.env.ACP_PERMISSION_MODE).toBe("bypassPermissions");
			expect(config.env.CLAUDE_CODE_PERMISSION_MODE).toBe("bypassPermissions");
		});

		it("restricted policy does not set bypass env vars", () => {
			const config = provider.spawnConfig(resolved, undefined, "restricted");
			expect(config.env.ACP_PERMISSION_MODE).toBeUndefined();
			expect(config.env.CLAUDE_CODE_PERMISSION_MODE).toBeUndefined();
		});

		it("user overrides merge into spawn config", () => {
			const config = provider.spawnConfig(resolved, { env: { CUSTOM: "val" } }, "full");
			expect(config.env.CUSTOM).toBe("val");
			expect(config.env.ACP_PERMISSION_MODE).toBe("bypassPermissions");
		});
	});

	describe("describePermissions", () => {
		it("full policy describes ACP bypass", () => {
			const desc = provider.describePermissions("full");
			expect(desc.policy).toBe("full");
			expect(desc.effectiveMode).toBe("provider_full");
			expect(desc.notes.some((n) => n.includes("bypassPermissions"))).toBe(true);
		});

		it("restricted policy describes default mode", () => {
			const desc = provider.describePermissions("restricted");
			expect(desc.policy).toBe("restricted");
			expect(desc.effectiveMode).toBe("provider_restricted");
		});
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement Claude provider**

```typescript
// src/providers/claude.ts
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
	AgentUserConfig,
	AuthResult,
	Provider,
	ProviderPermissions,
	ResolvedCommand,
	SpawnConfig,
} from "./types.js";
import { acpSmokeTest } from "./smoke-test.js";

const PRIMARY_COMMAND = "claude-agent-acp";
const VARIANTS = ["claude-code-acp"];

export class ClaudeProvider implements Provider {
	name = "claude";
	label = "Claude";
	color = "#4a9eff";

	supportedPlatforms(): NodeJS.Platform[] {
		return ["darwin", "linux", "win32"];
	}

	async resolveCommand(): Promise<ResolvedCommand | null> {
		// 1. node_modules/.bin
		const localBin = join(process.cwd(), "node_modules", ".bin", PRIMARY_COMMAND);
		if (existsSync(localBin)) {
			return { path: localBin, source: "node_modules" };
		}

		// 2. PATH lookup for primary command
		try {
			const result = execFileSync("which", [PRIMARY_COMMAND], { encoding: "utf-8" }).trim();
			if (result) return { path: result, source: "path" };
		} catch {}

		// 3. PATH lookup for variants
		for (const variant of VARIANTS) {
			try {
				const result = execFileSync("which", [variant], { encoding: "utf-8" }).trim();
				if (result) return { path: result, source: "variant" };
			} catch {}
		}

		return null;
	}

	installInstructions(platform: NodeJS.Platform): string {
		return `npm install -g @agentclientprotocol/claude-agent-acp`;
	}

	async checkAuth(command: string): Promise<AuthResult> {
		const result = await acpSmokeTest({
			command,
			args: [],
			env: {
				ACP_PERMISSION_MODE: "bypassPermissions",
				CLAUDE_CODE_PERMISSION_MODE: "bypassPermissions",
			},
		});
		return {
			ok: result.ok,
			checkedAt: new Date().toISOString(),
			error: result.error,
			loginCommand: "claude login",
		};
	}

	spawnConfig(
		resolved: ResolvedCommand,
		userOverrides?: AgentUserConfig,
		permissionPolicy: "full" | "restricted" = "full",
	): SpawnConfig {
		const args = userOverrides?.args ?? [];
		const baseEnv: Record<string, string> = {};

		if (permissionPolicy === "full") {
			baseEnv.ACP_PERMISSION_MODE = "bypassPermissions";
			baseEnv.CLAUDE_CODE_PERMISSION_MODE = "bypassPermissions";
		}

		return {
			command: resolved.path,
			args,
			env: { ...baseEnv, ...(userOverrides?.env ?? {}) },
		};
	}

	permissionModes(): string[] {
		return ["bypassPermissions"];
	}

	describePermissions(policy: "full" | "restricted"): ProviderPermissions {
		if (policy === "full") {
			return {
				policy: "full",
				effectiveMode: "provider_full",
				notes: [
					"ACP bypassPermissions mode",
					"ACP_PERMISSION_MODE=bypassPermissions env var",
					"CLAUDE_CODE_PERMISSION_MODE=bypassPermissions env var",
					"[ACP:PERMISSION:BYPASS] prompt marker",
				],
			};
		}
		return {
			policy: "restricted",
			effectiveMode: "provider_restricted",
			notes: ["Default Claude mode with approval prompts"],
		};
	}
}
```

- [ ] **Step 4: Run tests**

```bash
npm run build && npm test
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/providers/claude.ts test/providers/claude.test.ts
git commit -m "feat: add Claude provider with spawn config, resolution, and permission handling"
```

---

### Task 6: Codex provider + tests

**Files:**
- Create: `src/providers/codex.ts`
- Create: `test/providers/codex.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// test/providers/codex.test.ts
import { describe, expect, it } from "vitest";
import { CodexProvider } from "../src/providers/codex.js";

describe("CodexProvider", () => {
	const provider = new CodexProvider();

	it("has correct identity", () => {
		expect(provider.name).toBe("codex");
		expect(provider.label).toBe("Codex");
		expect(provider.color).toBe("#10b981");
	});

	it("supports darwin and linux", () => {
		const platforms = provider.supportedPlatforms();
		expect(platforms).toContain("darwin");
		expect(platforms).toContain("linux");
	});

	it("returns install instructions mentioning brew", () => {
		const instructions = provider.installInstructions("darwin");
		expect(instructions).toContain("brew");
	});

	describe("spawnConfig", () => {
		const resolved = { path: "/opt/homebrew/bin/codex-acp", source: "path" as const };

		it("full policy sets danger-full-access and approval_policy=never", () => {
			const config = provider.spawnConfig(resolved, undefined, "full");
			expect(config.command).toBe("/opt/homebrew/bin/codex-acp");
			expect(config.args).toContain("-c");
			expect(config.args.some((a) => a.includes("danger-full-access"))).toBe(true);
			expect(config.args.some((a) => a.includes('approval_policy="never"'))).toBe(true);
			expect(config.env.CODEX_CLI_AUTH_CREDENTIALS_STORE).toBe("file");
		});

		it("restricted policy has no sandbox override args", () => {
			const config = provider.spawnConfig(resolved, undefined, "restricted");
			expect(config.args.some((a) => a.includes("danger-full-access"))).toBe(false);
			expect(config.env.CODEX_CLI_AUTH_CREDENTIALS_STORE).toBe("file");
		});
	});

	describe("describePermissions", () => {
		it("full policy describes danger-full-access", () => {
			const desc = provider.describePermissions("full");
			expect(desc.effectiveMode).toBe("provider_full");
			expect(desc.notes.some((n) => n.includes("danger-full-access"))).toBe(true);
		});
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

- [ ] **Step 3: Implement Codex provider**

```typescript
// src/providers/codex.ts
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
	AgentUserConfig,
	AuthResult,
	Provider,
	ProviderPermissions,
	ResolvedCommand,
	SpawnConfig,
} from "./types.js";
import { acpSmokeTest } from "./smoke-test.js";

const PRIMARY_COMMAND = "codex-acp";

export class CodexProvider implements Provider {
	name = "codex";
	label = "Codex";
	color = "#10b981";

	supportedPlatforms(): NodeJS.Platform[] {
		return ["darwin", "linux"];
	}

	async resolveCommand(): Promise<ResolvedCommand | null> {
		const localBin = join(process.cwd(), "node_modules", ".bin", PRIMARY_COMMAND);
		if (existsSync(localBin)) {
			return { path: localBin, source: "node_modules" };
		}

		try {
			const result = execFileSync("which", [PRIMARY_COMMAND], { encoding: "utf-8" }).trim();
			if (result) return { path: result, source: "path" };
		} catch {}

		return null;
	}

	installInstructions(platform: NodeJS.Platform): string {
		if (platform === "darwin") {
			return `brew install zed-industries/codex-acp`;
		}
		return `See https://github.com/zed-industries/codex-acp for installation`;
	}

	async checkAuth(command: string): Promise<AuthResult> {
		const result = await acpSmokeTest({
			command,
			args: [],
			env: {
				CODEX_CLI_AUTH_CREDENTIALS_STORE: "file",
				CODEX_HOME: `${process.env.HOME}/.codex`,
			},
		});
		return {
			ok: result.ok,
			checkedAt: new Date().toISOString(),
			error: result.error,
			loginCommand: "codex auth",
		};
	}

	spawnConfig(
		resolved: ResolvedCommand,
		userOverrides?: AgentUserConfig,
		permissionPolicy: "full" | "restricted" = "full",
	): SpawnConfig {
		const args: string[] = [];

		if (permissionPolicy === "full") {
			args.push("-c", 'sandbox_mode="danger-full-access"', "-c", 'approval_policy="never"');
		}

		if (userOverrides?.args) {
			args.push(...userOverrides.args);
		}

		return {
			command: resolved.path,
			args,
			env: {
				CODEX_CLI_AUTH_CREDENTIALS_STORE: "file",
				CODEX_HOME: `${process.env.HOME}/.codex`,
				...(userOverrides?.env ?? {}),
			},
		};
	}

	permissionModes(): string[] {
		return [];
	}

	describePermissions(policy: "full" | "restricted"): ProviderPermissions {
		if (policy === "full") {
			return {
				policy: "full",
				effectiveMode: "provider_full",
				notes: [
					'sandbox_mode="danger-full-access"',
					'approval_policy="never"',
					"CODEX_CLI_AUTH_CREDENTIALS_STORE=file",
				],
			};
		}
		return {
			policy: "restricted",
			effectiveMode: "provider_restricted",
			notes: ["Default Codex sandbox with approval prompts"],
		};
	}
}
```

- [ ] **Step 4: Run tests**

```bash
npm run build && npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/providers/codex.ts test/providers/codex.test.ts
git commit -m "feat: add Codex provider"
```

---

### Task 7: Gemini provider + tests

**Files:**
- Create: `src/providers/gemini.ts`
- Create: `test/providers/gemini.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// test/providers/gemini.test.ts
import { describe, expect, it } from "vitest";
import { GeminiProvider } from "../src/providers/gemini.js";

describe("GeminiProvider", () => {
	const provider = new GeminiProvider();

	it("has correct identity", () => {
		expect(provider.name).toBe("gemini");
		expect(provider.label).toBe("Gemini");
		expect(provider.color).toBe("#f59e0b");
	});

	it("supports darwin and linux", () => {
		const platforms = provider.supportedPlatforms();
		expect(platforms).toContain("darwin");
		expect(platforms).toContain("linux");
	});

	describe("spawnConfig", () => {
		const resolved = { path: "/usr/local/bin/gemini", source: "path" as const };

		it("full policy sets --acp, --approval-mode=yolo, and GEMINI_SANDBOX=false", () => {
			const config = provider.spawnConfig(resolved, undefined, "full");
			expect(config.command).toBe("/usr/local/bin/gemini");
			expect(config.args).toContain("--acp");
			expect(config.args).toContain("--approval-mode=yolo");
			expect(config.env.GEMINI_SANDBOX).toBe("false");
		});

		it("restricted policy sets --acp but not yolo", () => {
			const config = provider.spawnConfig(resolved, undefined, "restricted");
			expect(config.args).toContain("--acp");
			expect(config.args).not.toContain("--approval-mode=yolo");
			expect(config.env.GEMINI_SANDBOX).toBeUndefined();
		});
	});

	describe("describePermissions", () => {
		it("full policy describes YOLO mode", () => {
			const desc = provider.describePermissions("full");
			expect(desc.effectiveMode).toBe("provider_full");
			expect(desc.notes.some((n) => n.toLowerCase().includes("yolo"))).toBe(true);
		});
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

- [ ] **Step 3: Implement Gemini provider**

```typescript
// src/providers/gemini.ts
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
	AgentUserConfig,
	AuthResult,
	Provider,
	ProviderPermissions,
	ResolvedCommand,
	SpawnConfig,
} from "./types.js";
import { acpSmokeTest } from "./smoke-test.js";

const PRIMARY_COMMAND = "gemini";

export class GeminiProvider implements Provider {
	name = "gemini";
	label = "Gemini";
	color = "#f59e0b";

	supportedPlatforms(): NodeJS.Platform[] {
		return ["darwin", "linux", "win32"];
	}

	async resolveCommand(): Promise<ResolvedCommand | null> {
		const localBin = join(process.cwd(), "node_modules", ".bin", PRIMARY_COMMAND);
		if (existsSync(localBin)) {
			return { path: localBin, source: "node_modules" };
		}

		try {
			const result = execFileSync("which", [PRIMARY_COMMAND], { encoding: "utf-8" }).trim();
			if (result) return { path: result, source: "path" };
		} catch {}

		return null;
	}

	installInstructions(_platform: NodeJS.Platform): string {
		return `npm install -g @google/gemini-cli`;
	}

	async checkAuth(command: string): Promise<AuthResult> {
		const result = await acpSmokeTest({
			command,
			args: ["--acp"],
			env: {},
		});
		return {
			ok: result.ok,
			checkedAt: new Date().toISOString(),
			error: result.error,
			loginCommand: "gemini auth",
		};
	}

	spawnConfig(
		resolved: ResolvedCommand,
		userOverrides?: AgentUserConfig,
		permissionPolicy: "full" | "restricted" = "full",
	): SpawnConfig {
		const args = ["--acp"];
		const env: Record<string, string> = {};

		if (permissionPolicy === "full") {
			args.push("--approval-mode=yolo");
			env.GEMINI_SANDBOX = "false";
		}

		if (userOverrides?.args) {
			args.push(...userOverrides.args);
		}

		return {
			command: resolved.path,
			args,
			env: { ...env, ...(userOverrides?.env ?? {}) },
		};
	}

	permissionModes(): string[] {
		return [];
	}

	describePermissions(policy: "full" | "restricted"): ProviderPermissions {
		if (policy === "full") {
			return {
				policy: "full",
				effectiveMode: "provider_full",
				notes: [
					"--approval-mode=yolo (auto-approve all tool calls)",
					"GEMINI_SANDBOX=false (disable sandboxing)",
				],
			};
		}
		return {
			policy: "restricted",
			effectiveMode: "provider_restricted",
			notes: ["Default Gemini mode with approval prompts and optional sandboxing"],
		};
	}
}
```

- [ ] **Step 4: Run tests**

```bash
npm run build && npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/providers/gemini.ts test/providers/gemini.test.ts
git commit -m "feat: add Gemini provider"
```

---

### Task 8: Provider registry + tests

**Files:**
- Create: `src/providers/registry.ts`
- Create: `test/providers/registry.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// test/providers/registry.test.ts
import { describe, expect, it } from "vitest";
import { getProviders, getProvider } from "../src/providers/registry.js";

describe("provider registry", () => {
	it("returns all three built-in providers", () => {
		const providers = getProviders();
		const names = providers.map((p) => p.name);
		expect(names).toContain("claude");
		expect(names).toContain("codex");
		expect(names).toContain("gemini");
		expect(providers).toHaveLength(3);
	});

	it("getProvider returns a provider by name", () => {
		const claude = getProvider("claude");
		expect(claude).toBeDefined();
		expect(claude!.name).toBe("claude");
	});

	it("getProvider returns undefined for unknown name", () => {
		expect(getProvider("unknown")).toBeUndefined();
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

- [ ] **Step 3: Implement registry**

```typescript
// src/providers/registry.ts
import type { Provider } from "./types.js";
import { ClaudeProvider } from "./claude.js";
import { CodexProvider } from "./codex.js";
import { GeminiProvider } from "./gemini.js";

const providers: Provider[] = [
	new ClaudeProvider(),
	new CodexProvider(),
	new GeminiProvider(),
];

export function getProviders(): Provider[] {
	return providers;
}

export function getProvider(name: string): Provider | undefined {
	return providers.find((p) => p.name === name);
}
```

- [ ] **Step 4: Run tests**

```bash
npm run build && npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/providers/registry.ts test/providers/registry.test.ts
git commit -m "feat: add provider registry"
```

---

### Task 9: Config module + tests

**Files:**
- Create: `src/config.ts`
- Create: `test/config.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// test/config.test.ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	loadMachineConfig,
	loadProjectConfig,
	mergeConfigs,
	writeMachineConfig,
	resolveAgentConfigs,
} from "../src/config.js";
import type { BrainstormConfig, MachineAgentState } from "../src/providers/types.js";

const tmpDir = join(tmpdir(), "pi-brainstorm-config-test");

function makeConfig(overrides: Partial<BrainstormConfig> = {}): BrainstormConfig {
	return {
		version: 1,
		permissions: { defaultPolicy: "full" },
		agents: {},
		...overrides,
	};
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

describe("config", () => {
	beforeEach(() => {
		mkdirSync(tmpDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("loadMachineConfig", () => {
		it("returns null when config does not exist", () => {
			const result = loadMachineConfig(join(tmpDir, "nonexistent"));
			expect(result).toBeNull();
		});

		it("loads valid config from disk", () => {
			const configDir = join(tmpDir, "machine");
			mkdirSync(configDir, { recursive: true });
			const config = makeConfig({ agents: { claude: makeAgentState() } });
			writeFileSync(join(configDir, "config.json"), JSON.stringify(config));
			const result = loadMachineConfig(configDir);
			expect(result).not.toBeNull();
			expect(result!.agents.claude.enabled).toBe(true);
		});
	});

	describe("loadProjectConfig", () => {
		it("returns null when no project config exists", () => {
			expect(loadProjectConfig(tmpDir)).toBeNull();
		});

		it("loads brainstorm.config.json from project root", () => {
			const projectConfig = { version: 1, agents: { claude: { preferredModel: "claude-sonnet-4-5-20250514" } } };
			writeFileSync(join(tmpDir, "brainstorm.config.json"), JSON.stringify(projectConfig));
			const result = loadProjectConfig(tmpDir);
			expect(result).not.toBeNull();
			expect(result!.agents!.claude.preferredModel).toBe("claude-sonnet-4-5-20250514");
		});
	});

	describe("mergeConfigs", () => {
		it("returns machine config when no project config", () => {
			const machine = makeConfig({ agents: { claude: makeAgentState() } });
			const result = mergeConfigs(machine, null);
			expect(result).toEqual(machine);
		});

		it("project scalars override machine scalars", () => {
			const machine = makeConfig({ permissions: { defaultPolicy: "full" } });
			const project = { permissions: { defaultPolicy: "restricted" as const } };
			const result = mergeConfigs(machine, project);
			expect(result.permissions.defaultPolicy).toBe("restricted");
		});

		it("project agent overrides merge into machine agent state", () => {
			const machine = makeConfig({
				agents: { claude: makeAgentState({ color: "#4a9eff" }) },
			});
			const project = { agents: { claude: { preferredModel: "claude-sonnet-4-5-20250514" } } };
			const result = mergeConfigs(machine, project);
			expect(result.agents.claude.preferredModel).toBe("claude-sonnet-4-5-20250514");
			expect(result.agents.claude.color).toBe("#4a9eff");
		});

		it("null values in project reset to undefined", () => {
			const machine = makeConfig({
				agents: { claude: makeAgentState({ preferredModel: "old-model" }) },
			});
			const project = { agents: { claude: { preferredModel: null } } };
			const result = mergeConfigs(machine, project);
			expect(result.agents.claude.preferredModel).toBeUndefined();
		});

		it("arrays replace entirely", () => {
			const machine = makeConfig({
				agents: { codex: makeAgentState({ args: ["-a", "-b"] }) },
			});
			const project = { agents: { codex: { args: ["-c"] } } };
			const result = mergeConfigs(machine, project);
			expect(result.agents.codex.args).toEqual(["-c"]);
		});
	});

	describe("writeMachineConfig", () => {
		it("writes config to disk and can be loaded back", () => {
			const configDir = join(tmpDir, "write-test");
			const config = makeConfig({ agents: { claude: makeAgentState() } });
			writeMachineConfig(configDir, config);
			expect(existsSync(join(configDir, "config.json"))).toBe(true);
			const loaded = loadMachineConfig(configDir);
			expect(loaded).toEqual(config);
		});
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

- [ ] **Step 3: Implement config module**

```typescript
// src/config.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { AgentConfig } from "./extension/types.js";
import type { AgentUserConfig, BrainstormConfig, MachineAgentState } from "./providers/types.js";
import { getProvider, getProviders } from "./providers/registry.js";

const DEFAULT_MACHINE_CONFIG_DIR = join(homedir(), ".pi", "brainstorm");

/**
 * Load machine config from a directory containing config.json.
 * Returns null if not found or invalid.
 */
export function loadMachineConfig(configDir?: string): BrainstormConfig | null {
	const dir = configDir ?? DEFAULT_MACHINE_CONFIG_DIR;
	const configPath = join(dir, "config.json");
	try {
		const raw = readFileSync(configPath, "utf-8");
		return JSON.parse(raw) as BrainstormConfig;
	} catch {
		return null;
	}
}

/**
 * Load project config from brainstorm.config.json in the given directory.
 * Returns null if not found.
 */
export function loadProjectConfig(cwd: string): Partial<BrainstormConfig> | null {
	const configPath = join(cwd, "brainstorm.config.json");
	try {
		const raw = readFileSync(configPath, "utf-8");
		return JSON.parse(raw) as Partial<BrainstormConfig>;
	} catch {
		return null;
	}
}

/**
 * Deep merge with spec semantics:
 * - objects merge recursively
 * - scalars override
 * - arrays replace entirely
 * - null resets to undefined (provider default)
 */
function deepMerge(base: any, override: any): any {
	if (override === null) return undefined;
	if (override === undefined) return base;
	if (Array.isArray(override)) return override;
	if (typeof base === "object" && typeof override === "object" && !Array.isArray(base)) {
		const result = { ...base };
		for (const key of Object.keys(override)) {
			result[key] = deepMerge(base[key], override[key]);
		}
		// Remove keys set to undefined by null reset
		for (const key of Object.keys(result)) {
			if (result[key] === undefined) delete result[key];
		}
		return result;
	}
	return override;
}

/**
 * Merge machine config with optional project config.
 */
export function mergeConfigs(
	machine: BrainstormConfig,
	project: Partial<BrainstormConfig> | null,
): BrainstormConfig {
	if (!project) return machine;
	return deepMerge(machine, project) as BrainstormConfig;
}

/**
 * Write machine config to disk.
 */
export function writeMachineConfig(configDir: string | undefined, config: BrainstormConfig): void {
	const dir = configDir ?? DEFAULT_MACHINE_CONFIG_DIR;
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "config.json"), JSON.stringify(config, null, 2));
}

/**
 * Build AgentConfig[] from merged config + provider registry.
 * Falls back to auto-detection with full policy when no machine config exists.
 */
export function resolveAgentConfigs(cwd: string): AgentConfig[] {
	const machineConfig = loadMachineConfig();
	const projectConfig = loadProjectConfig(cwd);

	if (!machineConfig) {
		// No setup has been run — fall back to provider defaults with full policy
		return buildFallbackConfigs();
	}

	const merged = mergeConfigs(machineConfig, projectConfig);
	const result: AgentConfig[] = [];

	for (const providerDef of getProviders()) {
		const agentState = merged.agents[providerDef.name];
		if (!agentState?.enabled) continue;

		const resolved = { path: agentState.command, source: agentState.commandSource };
		const spawn = providerDef.spawnConfig(
			resolved,
			agentState as AgentUserConfig,
			merged.permissions.defaultPolicy,
		);

		result.push({
			name: providerDef.name,
			command: spawn.command,
			args: spawn.args,
			env: spawn.env,
			color: agentState.color ?? providerDef.color,
			label: providerDef.label,
			preferredModel: agentState.preferredModel,
		});
	}

	return result;
}

/**
 * Fallback when no machine config exists: try to resolve each provider
 * from PATH and build configs with full policy defaults.
 * This preserves the current behavior where the extension works without setup.
 */
function buildFallbackConfigs(): AgentConfig[] {
	const configs: AgentConfig[] = [];
	for (const provider of getProviders()) {
		if (!provider.supportedPlatforms().includes(process.platform as NodeJS.Platform)) continue;
		const spawn = provider.spawnConfig(
			{ path: provider.name === "codex" ? "codex-acp" : provider.name === "claude" ? "claude-agent-acp" : "gemini", source: "path" },
			undefined,
			"full",
		);
		configs.push({
			name: provider.name,
			command: spawn.command,
			args: spawn.args,
			env: spawn.env,
			color: provider.color,
			label: provider.label,
		});
	}
	return configs;
}
```

- [ ] **Step 4: Run tests**

```bash
npm run build && npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat: add config loading, merging, and agent config resolution"
```

---

### Task 10: Setup wizard

**Files:**
- Create: `src/setup/wizard.ts`

- [ ] **Step 1: Implement the setup wizard**

The wizard is interactive and spawns real processes, so it's tested via env-gated integration tests rather than unit tests. The pieces it calls (providers, config) are already unit-tested.

```typescript
// src/setup/wizard.ts
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { getProviders } from "../providers/registry.js";
import { writeMachineConfig } from "../config.js";
import type { BrainstormConfig, MachineAgentState } from "../providers/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "..", "..");
const EXTENSION_DIR = join(homedir(), ".pi", "agent", "extensions");
const SYMLINK_PATH = join(EXTENSION_DIR, "pi-brainstorm");

function log(msg: string): void {
	console.log(msg);
}

function ok(msg: string): void {
	console.log(`  \u2713 ${msg}`);
}

function fail(msg: string): void {
	console.log(`  \u2717 ${msg}`);
}

async function prompt(question: string): Promise<string> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer.trim());
		});
	});
}

function checkPi(): string | null {
	try {
		const version = execFileSync("pi", ["--version"], { encoding: "utf-8" }).trim();
		return version;
	} catch {
		return null;
	}
}

function ensureSymlink(): void {
	if (existsSync(SYMLINK_PATH)) {
		const stat = lstatSync(SYMLINK_PATH);
		if (stat.isSymbolicLink()) {
			const target = resolve(dirname(SYMLINK_PATH), require("node:fs").readlinkSync(SYMLINK_PATH));
			if (target === PACKAGE_ROOT) {
				ok(`Symlink exists: ${SYMLINK_PATH} \u2192 ${PACKAGE_ROOT}`);
				return;
			}
			// Points elsewhere — remove and recreate
			log(`  Symlink points to ${target}, updating...`);
			unlinkSync(SYMLINK_PATH);
		} else {
			// Not a symlink — warn
			fail(`${SYMLINK_PATH} exists but is not a symlink. Remove it manually.`);
			process.exit(1);
		}
	}

	// Create parent directory and symlink
	const { mkdirSync } = require("node:fs");
	mkdirSync(EXTENSION_DIR, { recursive: true });
	symlinkSync(PACKAGE_ROOT, SYMLINK_PATH);
	ok(`Symlinked: ${SYMLINK_PATH} \u2192 ${PACKAGE_ROOT}`);
}

export async function runSetup(): Promise<void> {
	log("");
	log("pi-brainstorm setup");
	log("===================");
	log("");

	// 1. Check Pi
	log("Checking Pi...");
	const piVersion = checkPi();
	if (!piVersion) {
		fail("Pi is not installed.");
		log("  Install Pi first: https://github.com/mariozechner/pi-mono");
		process.exit(1);
	}
	ok(`Pi ${piVersion}`);
	log("");

	// 2. Symlink extension
	log("Symlinking extension...");
	ensureSymlink();
	log("");

	// 3. Detect providers
	log("Detecting agents...");
	log("");

	const agents: Record<string, MachineAgentState> = {};

	for (const provider of getProviders()) {
		const platforms = provider.supportedPlatforms();
		if (!platforms.includes(process.platform as NodeJS.Platform)) {
			log(`  ${provider.label} (${provider.name})`);
			log(`    Platform: \u2717 unsupported on ${process.platform}`);
			log("");
			continue;
		}

		log(`  ${provider.label} (${provider.name})`);

		// Resolve command
		const resolved = await provider.resolveCommand();
		if (!resolved) {
			log(`    Installed: \u2717 not found`);
			log(`    Install:   ${provider.installInstructions(process.platform as NodeJS.Platform)}`);
			log("");
			continue;
		}

		log(`    Installed: \u2713 ${resolved.path} (${resolved.source})`);

		// Auth smoke test
		const auth = await provider.checkAuth(resolved.path);
		if (auth.ok) {
			log(`    Auth:      \u2713 Ready`);
		} else {
			log(`    Auth:      \u2717 ${auth.error ?? "Failed"}`);
			log(`    Fix:       ${auth.loginCommand}`);
		}

		agents[provider.name] = {
			enabled: auth.ok,
			command: resolved.path,
			commandSource: resolved.source,
			auth: {
				ok: auth.ok,
				checkedAt: auth.checkedAt,
				error: auth.error,
			},
		};

		log("");
	}

	// 4. Permission policy
	const isInteractive = process.stdin.isTTY;
	let policy: "full" | "restricted" = "full";

	if (isInteractive) {
		const answer = await prompt("Permission policy: full access for all agents [Y/n] ");
		if (answer.toLowerCase() === "n" || answer.toLowerCase() === "no") {
			policy = "restricted";
		}
	}

	// Show policy notes per enabled agent
	for (const provider of getProviders()) {
		const agentState = agents[provider.name];
		if (!agentState?.enabled) continue;
		const perms = provider.describePermissions(policy);
		log(`  ${provider.label}: ${policy} \u2192 ${perms.notes[0]}`);
	}

	log("");

	// 5. Write config
	const config: BrainstormConfig = {
		version: 1,
		permissions: { defaultPolicy: policy },
		agents,
	};

	writeMachineConfig(undefined, config);
	const configPath = join(homedir(), ".pi", "brainstorm", "config.json");
	log(`Config written to ${configPath}`);

	const enabledCount = Object.values(agents).filter((a) => a.enabled).length;
	const totalCount = getProviders().length;
	const enabledNames = Object.entries(agents)
		.filter(([_, a]) => a.enabled)
		.map(([n]) => n)
		.join(", ");

	log(`Enabled: ${enabledNames || "none"} (${enabledCount} of ${totalCount} agents ready)`);
	log("");
	log("Next: start pi in any project and run /brainstorm");
}
```

- [ ] **Step 2: Fix the `readlinkSync` import** — the code above uses `require()`. Change to proper ESM import:

Replace the `require("node:fs").readlinkSync` usage with importing `readlinkSync` from `node:fs` at the top of the file alongside the other `fs` imports.

- [ ] **Step 3: Verify it compiles**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/setup/wizard.ts
git commit -m "feat: add setup wizard with Pi check, symlink, provider detection, auth smoke tests"
```

---

### Task 11: Doctor command

**Files:**
- Create: `src/setup/doctor.ts`

- [ ] **Step 1: Implement doctor**

```typescript
// src/setup/doctor.ts
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadMachineConfig, loadProjectConfig, mergeConfigs } from "../config.js";
import { getProviders } from "../providers/registry.js";
import type { BrainstormConfig } from "../providers/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "..", "..");
const SYMLINK_PATH = join(homedir(), ".pi", "agent", "extensions", "pi-brainstorm");

interface DoctorResult {
	ok: boolean;
	checks: DoctorCheck[];
}

interface DoctorCheck {
	name: string;
	status: "ok" | "warn" | "fail";
	message: string;
	detail?: string;
}

function checkPiVersion(): DoctorCheck {
	try {
		const version = execFileSync("pi", ["--version"], { encoding: "utf-8" }).trim();
		return { name: "pi", status: "ok", message: `Pi ${version}` };
	} catch {
		return { name: "pi", status: "fail", message: "Pi not installed" };
	}
}

function checkSymlink(): DoctorCheck {
	if (!existsSync(SYMLINK_PATH)) {
		return { name: "extension", status: "fail", message: "Not symlinked", detail: `Expected at ${SYMLINK_PATH}` };
	}
	const stat = lstatSync(SYMLINK_PATH);
	if (!stat.isSymbolicLink()) {
		return { name: "extension", status: "fail", message: `${SYMLINK_PATH} is not a symlink` };
	}
	const target = resolve(dirname(SYMLINK_PATH), readlinkSync(SYMLINK_PATH));
	if (target === PACKAGE_ROOT) {
		return { name: "extension", status: "ok", message: "pi-brainstorm (symlinked)" };
	}
	return { name: "extension", status: "warn", message: `Symlink points to ${target}, expected ${PACKAGE_ROOT}` };
}

function checkMachineConfig(): DoctorCheck & { config: BrainstormConfig | null } {
	const config = loadMachineConfig();
	if (!config) {
		return { name: "machine_config", status: "fail", message: "Machine config not found. Run: npm run setup", config: null };
	}
	const configPath = join(homedir(), ".pi", "brainstorm", "config.json");
	return { name: "machine_config", status: "ok", message: `Machine config: ${configPath}`, config };
}

function checkProjectConfig(cwd: string): DoctorCheck {
	const config = loadProjectConfig(cwd);
	if (!config) {
		return { name: "project_config", status: "ok", message: "Project config: not found (optional)" };
	}
	return { name: "project_config", status: "ok", message: `Project config: ${join(cwd, "brainstorm.config.json")}` };
}

export async function runDoctor(options: { json?: boolean; cwd?: string } = {}): Promise<DoctorResult> {
	const cwd = options.cwd ?? process.cwd();
	const checks: DoctorCheck[] = [];

	// Core checks
	checks.push(checkPiVersion());
	checks.push(checkSymlink());
	const configCheck = checkMachineConfig();
	checks.push(configCheck);
	checks.push(checkProjectConfig(cwd));

	// Agent checks
	const machineConfig = configCheck.config;
	const projectConfig = loadProjectConfig(cwd);
	const merged = machineConfig ? mergeConfigs(machineConfig, projectConfig) : null;

	for (const provider of getProviders()) {
		const platforms = provider.supportedPlatforms();
		if (!platforms.includes(process.platform as NodeJS.Platform)) {
			checks.push({
				name: `agent_${provider.name}`,
				status: "ok",
				message: `${provider.label}: unsupported on ${process.platform}`,
			});
			continue;
		}

		// Resolve command live (not from cached config)
		const resolved = await provider.resolveCommand();
		if (!resolved) {
			checks.push({
				name: `agent_${provider.name}`,
				status: "fail",
				message: `${provider.label}: not found`,
				detail: provider.installInstructions(process.platform as NodeJS.Platform),
			});
			continue;
		}

		// Auth smoke test (live check, not cached)
		const auth = await provider.checkAuth(resolved.path);
		const configState = merged?.agents[provider.name];
		const enabled = configState?.enabled ?? false;
		const policy = merged?.permissions.defaultPolicy ?? "full";
		const perms = provider.describePermissions(policy);

		if (auth.ok) {
			checks.push({
				name: `agent_${provider.name}`,
				status: "ok",
				message: `${provider.label}  ${resolved.path}  authenticated  ${enabled ? "enabled" : "disabled"}  ${perms.notes[0] ?? ""}`,
			});
		} else {
			const status = auth.error?.includes("timed out") || auth.error?.includes("spawn") ? "fail" : "fail";
			checks.push({
				name: `agent_${provider.name}`,
				status,
				message: `${provider.label}: ${auth.error ?? "auth failed"}`,
				detail: `Fix: ${auth.loginCommand}`,
			});
		}
	}

	const result: DoctorResult = {
		ok: checks.every((c) => c.status !== "fail"),
		checks,
	};

	if (options.json) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		console.log("");
		console.log("pi-brainstorm doctor");
		console.log("====================");
		console.log("");
		for (const check of checks) {
			const icon = check.status === "ok" ? "\u2713" : check.status === "warn" ? "!" : "\u2717";
			const prefix = check.status === "ok" ? ` ${icon}` : ` ${icon}`;
			console.log(`${prefix} ${check.message}`);
			if (check.detail) {
				console.log(`   ${check.detail}`);
			}
		}
		const issues = checks.filter((c) => c.status === "fail").length;
		if (issues > 0) {
			console.log("");
			console.log(`${issues} issue(s). Run npm run setup to fix.`);
		}
		console.log("");
	}

	return result;
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/setup/doctor.ts
git commit -m "feat: add doctor diagnostics command with live provider checks"
```

---

### Task 12: CLI entry point + package.json scripts

**Files:**
- Create: `src/cli.ts`
- Modify: `package.json`

- [ ] **Step 1: Create CLI entry point**

```typescript
// src/cli.ts
#!/usr/bin/env node
import { runSetup } from "./setup/wizard.js";
import { runDoctor } from "./setup/doctor.js";

const command = process.argv[2];

switch (command) {
	case "setup":
		await runSetup();
		break;
	case "doctor":
		await runDoctor({ json: process.argv.includes("--json") });
		break;
	default:
		console.log("pi-brainstorm CLI");
		console.log("");
		console.log("Usage:");
		console.log("  npm run setup     Setup extension, detect providers, write config");
		console.log("  npm run doctor    Run diagnostics");
		console.log("");
		console.log("Or directly:");
		console.log("  node dist/cli.js setup");
		console.log("  node dist/cli.js doctor");
		console.log("  node dist/cli.js doctor --json");
		process.exit(command ? 1 : 0);
}
```

- [ ] **Step 2: Update package.json**

Add `private: true`, `setup` and `doctor` scripts:

```json
{
  "private": true,
  "scripts": {
    "setup": "npm run build && node dist/cli.js setup",
    "doctor": "npm run build && node dist/cli.js doctor",
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest --run",
    "test:e2e": "vitest --run test/e2e-acp.test.ts"
  }
}
```

- [ ] **Step 3: Build and verify CLI works**

```bash
npm run build && node dist/cli.js --help
```

Expected: Prints usage text.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts package.json
git commit -m "feat: add CLI entry point with setup and doctor commands"
```

---

### Task 13: Runtime wiring — use config instead of DEFAULT_AGENTS

This is the critical integration task. It changes `src/extension/index.ts` to load config from the config system and build `AgentConfig[]` from the provider registry, instead of using the hardcoded `DEFAULT_AGENTS` constant.

**Files:**
- Modify: `src/extension/index.ts`
- Modify: `src/extension/types.ts` (remove `DEFAULT_AGENTS`)

- [ ] **Step 1: Update index.ts imports**

Add config import and remove DEFAULT_AGENTS import:

```typescript
// src/extension/index.ts — update imports
// REMOVE:
import { type AgentConfig, DEFAULT_AGENTS } from "./types.js";
// ADD:
import type { AgentConfig } from "./types.js";
import { resolveAgentConfigs } from "../config.js";
import { getProviders } from "../providers/registry.js";
```

- [ ] **Step 2: Replace DEFAULT_AGENTS usage in the brainstorm command handler**

In the `brainstorm` command handler, replace the config resolution block. Find this code (around line 308-326):

```typescript
// BEFORE: resolves from DEFAULT_AGENTS
let configs: AgentConfig[];
if (trimmed) {
    const requestedNames = trimmed.split(/\s+/);
    configs = [];
    for (const name of requestedNames) {
        const config = DEFAULT_AGENTS[name];
        if (config) {
            configs.push(config);
        } else {
            ctx.ui.notify(
                `Unknown agent: ${name}. Available: ${Object.keys(DEFAULT_AGENTS).join(", ")}`,
                "warning",
            );
        }
    }
    if (configs.length === 0) return;
} else {
    configs = Object.values(DEFAULT_AGENTS);
}
```

Replace with:

```typescript
// AFTER: resolves from config system + provider registry
const allConfigs = resolveAgentConfigs(ctx.cwd);
const availableNames = allConfigs.map((c) => c.name);

let configs: AgentConfig[];
if (trimmed) {
    const requestedNames = trimmed.split(/\s+/);
    configs = [];
    for (const name of requestedNames) {
        const config = allConfigs.find((c) => c.name === name);
        if (config) {
            configs.push(config);
        } else {
            ctx.ui.notify(
                `Unknown agent: ${name}. Available: ${availableNames.join(", ")}`,
                "warning",
            );
        }
    }
    if (configs.length === 0) return;
} else {
    configs = allConfigs;
}
```

- [ ] **Step 3: Replace DEFAULT_AGENTS usage in /brainstorm add handler**

Find the add handler (around line 241-260) and replace `DEFAULT_AGENTS[name]` lookups:

```typescript
// BEFORE:
const addConfig = DEFAULT_AGENTS[name];
if (!addConfig) {
    ctx.ui.notify(`Unknown agent: ${name}. Available: ${Object.keys(DEFAULT_AGENTS).join(", ")}`, "warning");
    return;
}

// AFTER:
const allConfigsForAdd = resolveAgentConfigs(ctx.cwd);
const addConfig = allConfigsForAdd.find((c) => c.name === name);
if (!addConfig) {
    ctx.ui.notify(`Unknown agent: ${name}. Available: ${allConfigsForAdd.map((c) => c.name).join(", ")}`, "warning");
    return;
}
```

- [ ] **Step 4: Replace DEFAULT_AGENTS usage in /brainstorm resume handler**

Find the resume handler (around line 277-280) and replace:

```typescript
// BEFORE:
const config = DEFAULT_AGENTS[agentName];

// AFTER:
const allConfigsForResume = resolveAgentConfigs(ctx.cwd);
const config = allConfigsForResume.find((c) => c.name === agentName);
```

- [ ] **Step 5: Replace DEFAULT_AGENTS usage in statusText helper**

Find the `statusText` function (around line 74-83) and replace:

```typescript
// BEFORE:
const names = agentNames().map((n) => {
    const config = DEFAULT_AGENTS[n];
    return config ? chalk.hex(config.color)(n) : n;
});

// AFTER:
const names = agentNames().map((n) => {
    const state = orchestrator?.getState().agents.get(n);
    const color = state?.config.color;
    return color ? chalk.hex(color)(n) : n;
});
```

- [ ] **Step 6: Remove DEFAULT_AGENTS from types.ts**

In `src/extension/types.ts`, remove the `DEFAULT_AGENTS` export (lines 48-84). Keep all the interfaces (`AgentConfig`, `AgentState`, `BrainstormMessage`, `BrainstormState`, `StreamChunk`, `AutoModeState`).

- [ ] **Step 7: Build and run tests**

```bash
npm run build && npm test
```

If tests in `test/orchestrator.test.ts` reference `DEFAULT_AGENTS`, update them to construct configs directly from the test fixtures they already use.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: wire runtime to config system, remove hardcoded DEFAULT_AGENTS"
```

---

### Task 14: Add /brainstorm setup and /brainstorm doctor slash commands

**Files:**
- Modify: `src/extension/index.ts`

- [ ] **Step 1: Add setup and doctor subcommands to the brainstorm command handler**

In the `brainstorm` command handler, add cases for `setup`, `doctor`, and `config` before the existing `stop`/`add`/`resume` cases:

```typescript
if (trimmed === "setup") {
    const { runSetup } = await import("../setup/wizard.js");
    await runSetup();
    ctx.ui.notify("Setup complete. Restart brainstorm to use new config.", "info");
    return;
}

if (trimmed === "doctor" || trimmed.startsWith("doctor")) {
    const { runDoctor } = await import("../setup/doctor.js");
    const json = trimmed.includes("--json");
    await runDoctor({ json, cwd: ctx.cwd });
    return;
}

if (trimmed === "config") {
    const { loadMachineConfig, loadProjectConfig, mergeConfigs } = await import("../config.js");
    const machine = loadMachineConfig();
    const project = loadProjectConfig(ctx.cwd);
    const merged = machine ? mergeConfigs(machine, project) : null;
    ctx.ui.notify(merged ? JSON.stringify(merged, null, 2) : "No config found. Run /brainstorm setup", "info");
    return;
}
```

Note: These use dynamic `import()` so that `src/extension/` does not have static imports from `src/setup/`. The setup code is only loaded when these commands are invoked.

- [ ] **Step 2: Build and verify**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/extension/index.ts
git commit -m "feat: add /brainstorm setup, doctor, and config slash commands"
```

---

### Task 15: README, CONTRIBUTING, LICENSE

**Files:**
- Modify: `README.md`
- Create: `CONTRIBUTING.md`
- Create: `LICENSE`

- [ ] **Step 1: Rewrite README.md**

Replace the current README with clone-and-run focused docs:

```markdown
# pi-brainstorm

Multi-agent brainstorming extension for [pi](https://github.com/mariozechner/pi-mono) coding-agent. Run collaborative AI discussions with Claude, Codex, and Gemini talking to each other.

## Prerequisites

- [pi](https://github.com/mariozechner/pi-mono) (v0.64.0+)
- Node.js 18+
- One or more agent CLIs:
  - **Claude**: `npm install -g @agentclientprotocol/claude-agent-acp` + `claude login`
  - **Codex**: `brew install zed-industries/codex-acp` + `codex auth`
  - **Gemini**: `npm install -g @google/gemini-cli` + `gemini auth`

## Setup

```bash
git clone <repo-url>
cd pi-brainstorm
npm install
npm run setup
```

Setup will:
1. Build the project
2. Symlink the extension into `~/.pi/agent/extensions/`
3. Detect installed providers
4. Run auth smoke tests
5. Write machine config to `~/.pi/brainstorm/config.json`

Re-run `npm run setup` after `git pull` or when adding new providers.

## Usage

Start pi in any project, then:

| Command | Purpose |
|---------|---------|
| `/brainstorm` | Start a session with all detected agents |
| `/brainstorm claude codex` | Start with specific agents |
| `/brainstorm stop` | End the session |
| `/brainstorm resume` | Resume a previous session |
| `/brainstorm setup` | Re-run setup from within pi |
| `/brainstorm doctor` | Run diagnostics |
| `/brainstorm config` | Print resolved config |
| `/auto [turns] [topic]` | Start autonomous discussion |
| `/auto continue [turns]` | Continue autonomous discussion |
| `/mute <agent>` | Mute an agent |
| `/unmute <agent>` | Unmute an agent |
| `/restart <agent>` | Restart an agent |
| `/stop` | Interrupt all agents |
| `/agents` | List agent status |

### @mentions

Type `@claude what do you think?` to direct a message to a specific agent.

### Keyboard shortcuts

- **Ctrl+E**: Toggle reasoning/thinking visibility

## Configuration

### Machine config (`~/.pi/brainstorm/config.json`)

Written by `npm run setup`. Contains resolved provider paths, auth state, and permission policy.

### Project config (`brainstorm.config.json`)

Optional. Commit to your repo to set team defaults:

```json
{
  "version": 1,
  "agents": {
    "claude": { "preferredModel": "claude-sonnet-4-5-20250514" },
    "codex": { "enabled": true },
    "gemini": { "enabled": true }
  }
}
```

Project config merges on top of machine config. `null` values reset to defaults.

## Permission model

Setup prompts for a permission policy: **full** (default) or **restricted**.

| Provider | Full access | Restricted |
|----------|-------------|------------|
| Claude | ACP bypassPermissions mode + env vars | Default mode with approval prompts |
| Codex | `danger-full-access` + `approval_policy="never"` | Default sandbox with approvals |
| Gemini | `--approval-mode=yolo` + `GEMINI_SANDBOX=false` | Default mode with optional sandbox |

## Diagnostics

```bash
npm run doctor          # human-readable output
node dist/cli.js doctor --json  # machine-readable
```

## Troubleshooting

- **Agent won't start**: Run `npm run doctor` to check command resolution and auth
- **Permission denied**: Check `~/.claude/settings.json` has `"permissions": { "defaultMode": "bypassPermissions" }` for Claude
- **Codex keychain popup**: Ensure `CODEX_CLI_AUTH_CREDENTIALS_STORE=file` is set (handled by setup)
- **Gemini ACP startup fails**: Check Node.js version compatibility and `gemini --acp` works standalone

## Development

```bash
npm run dev      # watch mode (tsc --watch)
npm run build    # one-time build
npm test         # unit tests
```
```

- [ ] **Step 2: Create CONTRIBUTING.md**

```markdown
# Contributing

## Setup

```bash
git clone <repo-url>
cd pi-brainstorm
npm install
npm run build
```

## Development

```bash
npm run dev      # watch mode
npm test         # run tests
npm run build    # build once
```

## Project structure

- `src/extension/` — Pi extension runtime (index, orchestrator, agents, renderer)
- `src/providers/` — Provider registry (claude, codex, gemini)
- `src/setup/` — Setup wizard and doctor
- `src/config.ts` — Config loading, merging, writing
- `src/prompt.ts` — Prompt template loading and interpolation
- `src/cli.ts` — CLI entry point
- `prompts/` — Default prompt templates
- `test/` — Unit tests

## Import boundaries

- Nothing in `src/extension/` may import from `src/setup/`
- Both may import from `src/providers/`, `src/config.ts`, `src/prompt.ts`

## Testing

Unit tests use vitest. Run with `npm test`.

Provider smoke tests (real ACP connections) are env-gated and run separately.
```

- [ ] **Step 3: Create LICENSE (MIT)**

```
MIT License

Copyright (c) 2026

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 4: Commit**

```bash
git add README.md CONTRIBUTING.md LICENSE
git commit -m "docs: rewrite README for clone-and-run setup, add CONTRIBUTING and LICENSE"
```

---

## Task dependency graph

```
Task 1 (restructure) ──→ Task 2 (prompts) ──→ Task 3 (provider types) ──→ Task 4 (smoke test)
                                                        │
                                           ┌────────────┼────────────┐
                                           ▼            ▼            ▼
                                      Task 5        Task 6       Task 7
                                      (claude)      (codex)      (gemini)
                                           │            │            │
                                           └────────────┼────────────┘
                                                        ▼
                                                   Task 8 (registry)
                                                        │
                                                        ▼
                                                   Task 9 (config)
                                                        │
                                           ┌────────────┼────────────┐
                                           ▼            ▼            ▼
                                     Task 10       Task 11      Task 12
                                     (wizard)      (doctor)      (CLI)
                                           │            │            │
                                           └────────────┼────────────┘
                                                        ▼
                                                  Task 13 (runtime wiring)
                                                        │
                                                        ▼
                                                  Task 14 (slash commands)
                                                        │
                                                        ▼
                                                  Task 15 (docs)
```

**Parallelizable groups:**
- Tasks 5, 6, 7 (providers) can run in parallel after Task 4
- Tasks 10, 11, 12 (setup/doctor/CLI) can run in parallel after Task 9
