# Distributable Setup And Packaging Spec

## Summary

Turn `pi-brainstorm` from a prototype Pi extension into a clone-and-run project for teammates with:

- one-command setup after cloning
- first-class support for Claude, Codex, and Gemini
- guided auth verification via real ACP smoke tests
- explicit machine and project configuration
- provider-specific handling for trusted full-access execution
- a cleaner repo structure with prompts separated from code
- diagnostics and test coverage that is as polished as a good open source project

This is a clone-from-git distribution. There is no npm publish, no registry, no tarball workflow.
The repo and docs should be good enough that public open sourcing would be low-friction later, but v1 only needs to work well for colleagues who can clone the repo.

This spec replaces the current manual clone/build/symlink workflow in `README.md` and the current hardcoded agent model in `src/types.ts`.

## Audience And Release Stance

- distribution target is teammates and trusted colleagues who can clone the repo
- package quality target is open-source-grade: reproducible setup, docs, diagnostics, clean config model, stable tests
- there is no npm publish, no private registry, no tarball workflow
- the only distribution path is `git clone` followed by a setup command
- avoid assumptions that only work on the author's machine

## Current Problems

The current repository works, but it is still optimized for local development:

- install requires cloning the repo, running `npm install`, building, and manually symlinking into `~/.pi/agent/extensions`
- agent configuration is hardcoded in `src/types.ts`
- runtime spawning is PATH-only and assumes globally installed agent bridges
- prompt files live inside `src/` and are copied during build
- there is no setup or diagnostics flow for detecting installed providers or verifying auth
- there is no checked-in packaging/install spec for teammates
- full-access behavior is handled ad hoc and does not distinguish provider-specific constraints

## Goals

1. Clone-and-run path: `git clone`, `npm install && npm run setup`
2. Setup handles build, symlink, provider detection, auth checks, and config writing
3. Support these providers out of the box:
   - Claude via `claude-agent-acp`
   - Codex via `codex-acp`
   - Gemini via `gemini --acp`
4. Store resolved machine-specific state outside the repo
5. Allow optional repo-level team defaults via a committed project config
6. Remove build hacks around prompt files
7. Keep runtime code and setup code separate
8. Add doctor/diagnostics and tests
9. Make trusted full-access execution explicit and provider-aware

## Non-Goals

- adding arbitrary user-defined providers in v1
- npm publish, registry, or tarball distribution
- automatic installation of every provider binary via package manager APIs
- changing the core brainstorm UX, renderer layout, or auto mode behavior
- changing the existing conversation persistence format in `.pi/brainstorm/state.json`
- enforcing a corporate lockdown model; this tool is for trusted teammate workflows, not hostile endpoints

## Product Model

A single repo with two entrypoints:

1. Pi extension entrypoint — loaded by Pi at runtime
2. Setup CLI — run once after cloning to configure the local machine

### Package Identity

```json
{
  "name": "pi-brainstorm",
  "version": "1.0.0",
  "private": true,
  "pi": {
    "extensions": ["dist/extension/index.js"]
  },
  "scripts": {
    "setup": "npm run build && node dist/cli.js setup",
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest --run"
  }
}
```

Notes:

- `private: true` — this is not published anywhere
- `npm run setup` is the single command a new user runs after `npm install`
- setup handles building, symlinking into `~/.pi/agent/extensions/`, provider detection, and config writing

## Installation Path

```bash
git clone <repo-url>
cd pi-brainstorm
npm install
npm run setup
```

`npm run setup` runs `npm run build` then `node dist/cli.js setup`, which:

1. Builds the TypeScript source
2. Verifies Pi is installed (prints install instructions if missing)
3. Symlinks the repo into `~/.pi/agent/extensions/pi-brainstorm` (creates or updates the symlink)
4. Detects supported providers on PATH
5. Runs ACP auth smoke tests
6. Prompts for permission policy
7. Writes machine config to `~/.pi/brainstorm/config.json`

After setup, start Pi in any project and run `/brainstorm`.

For re-running setup after a `git pull` or to re-check providers:

```bash
npm run setup
```

The `/brainstorm setup` and `/brainstorm doctor` commands inside Pi remain available for re-checking without leaving Pi.

## Provider Support Matrix

| Provider | Primary command | Variant | Install instructions | Auth command | Runtime notes |
|----------|------------------|---------|----------------------|--------------|---------------|
| Claude | `claude-agent-acp` | `claude-code-acp` | `npm install -g @agentclientprotocol/claude-agent-acp` | `claude login` | Uses ACP bridge; ACP permission mode available |
| Codex | `codex-acp` | none | `brew install zed-industries/codex-acp` | `codex auth` | Uses ACP bridge; full access is configured via Codex CLI config/flags, not ACP mode |
| Gemini | `gemini` | none | `npm install -g @google/gemini-cli` | `gemini auth` | Native ACP via `--acp`; full auto-approval uses Gemini CLI flags; ACP startup must be smoke-tested because binary presence alone is insufficient |

Provider support must be OS-aware:

- unsupported providers are reported as `unsupported`
- missing providers are reported as `not_found`
- setup output must not tell users to install unsupported providers on the wrong platform
- setup and doctor must distinguish `installed_but_broken` from `not_found`

## Provider Registry

Replace hardcoded `DEFAULT_AGENTS` with provider modules under `src/providers/`.

### Interface

```ts
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

### Resolution Order

Per provider, command resolution order is:

1. local `node_modules/.bin/<command>`
2. PATH lookup for primary command
3. PATH lookup for known variants

This keeps runtime spawning simple while still allowing better-than-PATH behavior.

### Auth Check

Auth status must be verified via a real ACP smoke test:

1. spawn provider command
2. initialize ACP connection
3. create session
4. send prompt `reply OK`
5. require a successful response within timeout

Do not infer auth from dotfiles or token caches.

If the process crashes before ACP initialize or before a smoke-test response:

- treat the provider as `installed_but_broken`
- surface the stderr or startup error in doctor output
- do not enable the provider automatically

This is especially important for Gemini, where a local install may still fail to start ACP mode due to runtime incompatibilities.

## Permissions And Trust Model

The product is for trusted teammate workflows, so the default machine policy should remain low-friction:

- interactive setup prompt: `full access for all agents`
- non-interactive default: `full`
- restricted mode remains available for cautious environments and troubleshooting

Full access is provider-specific and must not be treated as a purely generic ACP feature.

### Policy Levels

Machine config stores:

```ts
permissions: {
  defaultPolicy: "full" | "restricted";
}
```

Semantics:

- `full`: best-effort provider-specific configuration for unattended reads, edits, and shell use in trusted repos
- `restricted`: default/safe provider mode with approval prompts or sandboxing left intact

### Claude

For `full` policy, Claude provider must use all of these layers where available:

1. ACP `requestPermission` auto-approve handler
2. ACP `setSessionMode("bypassPermissions")` when the mode exists
3. ACP `setSessionConfigOption` for `category: "mode"` when present
4. `[ACP:PERMISSION:BYPASS]` prompt marker in prompt templates
5. spawn env:
   - `ACP_PERMISSION_MODE=bypassPermissions`
   - `CLAUDE_CODE_PERMISSION_MODE=bypassPermissions`

Doctor should also check for an effective Claude settings fallback:

```json
{
  "permissions": {
    "defaultMode": "bypassPermissions"
  }
}
```

in one of:

- `~/.claude/settings.json`
- `<project>/.claude/settings.json`
- `<project>/.claude/settings.local.json`

Notes:

- Claude ACP currently exposes a real ACP permission mode and mode config option, so ACP can drive full mode directly
- local settings fallback is still worth documenting because it is the most reliable non-ACP default

### Codex

For `full` policy, Codex provider must not rely on ACP session modes. Current behavior should assume:

- ACP may expose model and reasoning config
- ACP may expose no permission mode at all

So full access for Codex must be configured at launch using official Codex settings, not ACP mode selection:

```ts
args: [
  "-c", 'sandbox_mode="danger-full-access"',
  "-c", 'approval_policy="never"',
]
```

Recommended env:

```ts
{
  CODEX_CLI_AUTH_CREDENTIALS_STORE: "file",
  CODEX_HOME: `${process.env.HOME}/.codex`
}
```

Notes:

- `sandbox_mode="danger-full-access"` gives host-level command execution without sandboxing
- `approval_policy="never"` prevents approval prompts
- older ad hoc `sandbox_permissions=[...]` usage should be retired in favor of the official config keys above

### Gemini

For `full` policy, Gemini provider must use Gemini CLI flags and config, not ACP permission modes.

Required launch shape:

```ts
command: "gemini"
args: ["--acp", "--approval-mode=yolo"]
env: {
  GEMINI_SANDBOX: "false"
}
```

Rationale:

- Gemini CLI documents that YOLO mode auto-approves all tool calls
- Gemini CLI documents that YOLO can only be enabled by CLI flag, not persisted as default config
- Gemini CLI documents that sandboxing becomes enabled by default when using YOLO
- Gemini CLI documents `GEMINI_SANDBOX=false` as a valid override for disabling sandboxing

Implementation requirements:

- treat `GEMINI_SANDBOX=false` with `--approval-mode=yolo` as the target full-access launch config
- if Gemini ignores that override in practice on a given release, doctor must report that `full` policy is degraded for Gemini on that machine
- if Gemini folder trust is enabled, the workspace must be trusted or tool auto-acceptance may be suppressed
- setup must warn if `security.disableYoloMode=true` is present in Gemini settings

For `restricted` policy:

- use `gemini --acp`
- do not pass YOLO flags
- allow Gemini's normal prompt behavior and optional sandboxing

### Prompt Wording

Prompt templates may state that tools are available, but they must not be the only permission mechanism.
Provider launch config and ACP/session behavior remain authoritative.

## Configuration Model

There are three layers:

| Layer | Location | Committed | Purpose |
|-------|----------|-----------|---------|
| provider defaults | `src/providers/*.ts` | yes | built-in defaults |
| machine config | `~/.pi/brainstorm/config.json` | no | resolved commands, auth state, local policy |
| project config | `brainstorm.config.json` | optional | team defaults for this repo |

### Merge Semantics

- objects merge recursively
- scalars override
- arrays replace entirely
- `null` resets to provider default

### Machine Config Schema

```ts
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
```

### Project Config Example

```json
{
  "version": 1,
  "permissions": {
    "defaultPolicy": "full"
  },
  "agents": {
    "claude": {
      "enabled": true,
      "preferredModel": "claude-sonnet-4-5-20250514"
    },
    "codex": {
      "enabled": true,
      "preferredModel": "gpt-5.4"
    },
    "gemini": {
      "enabled": true
    }
  }
}
```

### Runtime State

The existing brainstorm conversation state remains project-local and ephemeral:

```text
.pi/brainstorm/state.json
```

This file is not configuration and is not part of the new config model.

## Setup Flow

CLI (after cloning):

```bash
npm run setup
```

Or directly:

```bash
node dist/cli.js setup
```

### Setup State Machine

1. Build TypeScript source (if run via `npm run setup`).
2. Check whether Pi is installed.
3. If missing, print install instructions and exit non-zero.
4. Symlink the repo directory into `~/.pi/agent/extensions/pi-brainstorm`.
   - If the symlink already exists and points to this repo, skip.
   - If it points elsewhere, warn and ask before overwriting.
5. For each built-in provider:
   - skip as `unsupported` if platform does not match
   - resolve command
   - if unresolved, print install instructions
   - if resolved, run ACP auth smoke test
   - collect provider-specific permission notes
6. Prompt once for permission policy in interactive mode.
7. Write `~/.pi/brainstorm/config.json`.
8. Print next-step guidance.

### Permission Policy

Interactive mode:

```text
Permission policy: full access for all agents [Y/n]
```

Non-interactive mode:

- default to `full`
- persist that choice in machine config

Setup output should include a short provider-specific note when `full` means different things per provider:

- Claude: ACP bypass mode
- Codex: danger-full-access + never approvals
- Gemini: ACP + YOLO + sandbox disabled override

### Example Output

```text
$ npm run setup

pi-brainstorm setup
===================

Checking Pi... ✓ v0.64.2
Symlinking extension... ✓ ~/.pi/agent/extensions/pi-brainstorm → /Users/you/pi-brainstorm

Detecting agents...

  Claude (claude-agent-acp)
    Installed: ✓ /usr/local/bin/claude-agent-acp (path)
    Auth:      ✓ Ready
    Policy:    full → ACP bypassPermissions

  Codex (codex-acp)
    Installed: ✓ /opt/homebrew/bin/codex-acp (path)
    Auth:      ✓ Ready
    Policy:    full → danger-full-access + approval_policy=never

  Gemini (gemini --acp)
    Installed: ✗ ACP startup failed
               → Syntax/runtime error before handshake
               → Check Node/runtime compatibility or Gemini CLI version

Permission policy: full access for all agents [Y/n] y

Config written to ~/.pi/brainstorm/config.json
Enabled: claude, codex (2 of 3 agents ready)

Next: start pi in any project and run /brainstorm
```

## Doctor Flow

CLI:

```bash
pi-brainstorm doctor
pi-brainstorm doctor --json
```

Or from Pi:

```text
/brainstorm doctor
```

Doctor revalidates the live environment. It does not rely only on cached config.

Doctor must check:

- Pi presence/version
- package installation/version
- machine config presence and validity
- project config presence and merged result
- each provider's command resolution
- ACP startup/auth smoke test
- provider-specific full-access prerequisites

Provider-specific doctor checks:

- Claude: whether `bypassPermissions` ACP mode is available; warn if only fallback layers remain
- Codex: whether launch config still uses official `sandbox_mode` and `approval_policy`
- Gemini:
  - whether `gemini --acp` starts successfully
  - whether `security.disableYoloMode` is forcing restricted execution
  - whether folder trust, if enabled, blocks tool auto-acceptance
  - whether full policy would be degraded because sandbox override or startup behavior is incompatible

### Example Output

```text
$ pi-brainstorm doctor

pi-brainstorm doctor
====================

 ✓ Pi v0.64.2
 ✓ pi-brainstorm (symlinked)
 ✓ Machine config: ~/.pi/brainstorm/config.json
 ✗ Project config: not found (optional)

Agents:
 ✓ Claude    /usr/local/bin/claude-agent-acp   authenticated   enabled    full via ACP bypassPermissions
 ✓ Codex     /opt/homebrew/bin/codex-acp       authenticated   enabled    full via danger-full-access
 ✗ Gemini    /usr/local/bin/gemini             BROKEN STARTUP  disabled   → check runtime / version

Prompts:
 ✓ brainstorm: prompts/BRAINSTORM.md (default)
 ✓ auto:       prompts/AUTO.md (default)

1 issue. Run pi-brainstorm setup to fix.
```

## Repo Restructure

Target layout:

```text
pi-brainstorm/
├── src/
│   ├── cli.ts
│   ├── extension/
│   │   ├── index.ts
│   │   ├── orchestrator.ts
│   │   ├── agents.ts
│   │   ├── renderer.ts
│   │   ├── split-column.ts
│   │   └── types.ts
│   ├── providers/
│   │   ├── registry.ts
│   │   ├── claude.ts
│   │   ├── codex.ts
│   │   └── gemini.ts
│   ├── setup/
│   │   ├── wizard.ts
│   │   ├── doctor.ts
│   │   └── config.ts
│   └── prompt.ts
├── prompts/
│   ├── BRAINSTORM.md
│   └── AUTO.md
├── test/
│   ├── providers/
│   ├── setup/
│   ├── orchestrator.test.ts
│   ├── agents.test.ts
│   └── prompt.test.ts
├── docs/
│   └── specs/
├── brainstorm.config.json  (optional project config example)
├── README.md
├── CONTRIBUTING.md
├── LICENSE
└── package.json            (private: true)
```

## Runtime Boundaries

This must be a strict rule:

- nothing in `src/extension/` imports from `src/setup/`
- both runtime and setup may import from `src/providers/`
- prompt loading logic must work from package root

The runtime should consume resolved configuration and provider registry behavior only. It should not know about the interactive setup flow.

## Prompt Handling

Move prompt files out of `src/`:

- `src/PROMPT.md` → `prompts/BRAINSTORM.md`
- `src/AUTO_PROMPT.md` → `prompts/AUTO.md`

Requirements:

- no more `cp src/PROMPT.md src/AUTO_PROMPT.md dist/` in build
- prompt lookup must work in dev and published package layouts
- prompt paths may be overridden via config
- prompt text may mention full tool availability, but must not claim provider behavior that setup/doctor has already identified as unavailable

## Commands

Existing brainstorm commands remain, with new additions:

| Command | Purpose |
|---------|---------|
| `/brainstorm` | start session using merged config |
| `/brainstorm setup` | run environment detection and write machine config |
| `/brainstorm doctor` | run diagnostics |
| `/brainstorm config` | print resolved config |

Other existing commands such as `/auto`, `/mute`, `/unmute`, `/restart`, `/stop`, and resume behavior remain intact unless implementation constraints require a change.

## Documentation Expectations

Docs should be open-source-quality so public release is low-friction later:

- `README.md` with clone/setup instructions, provider matrix, troubleshooting, and permission model
- `CONTRIBUTING.md` with local dev and test commands
- `LICENSE` present to preserve future open-source optionality
- explicit statement of supported platforms and provider prerequisites
- explicit troubleshooting notes for provider startup failures, not just auth failures

## Implementation Phases

1. Provider interface, config schema, merge logic
2. Claude, Codex, and Gemini provider modules
3. Provider-specific permission behavior and doctor checks
4. CLI `setup` (with build + symlink) and `doctor`
5. Runtime wiring to resolved config and provider registry
6. Repo restructure into `src/extension`, `src/providers`, `src/setup`
7. Prompt relocation to `prompts/`
8. README rewrite
9. Tests and env-gated smoke tests

## Acceptance Criteria

1. `git clone` + `npm install` + `npm run setup` on a clean machine (with Pi and provider CLIs already installed):
   - builds the project
   - symlinks the extension into Pi
   - detects built-in providers
   - runs auth smoke tests
   - writes machine config
2. `node dist/cli.js doctor --json` returns stable, parseable JSON
3. prompts resolve correctly in dev layout (no build-step copy needed)
4. `/brainstorm` starts a session using merged config
5. if credentials already exist, setup enables at least one ready provider
6. `full` policy results in provider-specific full-access launch config for Claude, Codex, and Gemini
7. Gemini failures before ACP handshake are reported as runtime incompatibility, not misclassified as missing binary or auth failure
8. `npm run setup` is idempotent — safe to re-run after `git pull`

## Test Strategy

Always-run tests:

- unit tests for provider resolution
- unit tests for config merging semantics
- unit tests for provider-specific spawn config under `full` and `restricted`
- unit tests for auth state handling with mocked ACP flows
- prompt resolution tests in dev layout

Env-gated tests:

- real Claude smoke test
- real Codex smoke test
- real Gemini smoke test
- Pi extension smoke test that verifies `/brainstorm` can start

When real-provider smoke tests run, they should assert:

- Claude: ACP mode `bypassPermissions` is available or fallback behavior is clearly reported
- Codex: startup works with `sandbox_mode="danger-full-access"` and `approval_policy="never"`
- Gemini: `gemini --acp` starts; if `--approval-mode=yolo` plus `GEMINI_SANDBOX=false` does not behave as expected, mark degraded and fail the full-access test

## Notes For Implementation

- preserve existing orchestrator and renderer behavior where possible
- treat this as a distribution and packaging improvement, not a full product rewrite
- prefer incremental phases that keep tests green throughout the transition
- use real ACP behavior, not assumptions, when classifying providers as ready for teammate use
