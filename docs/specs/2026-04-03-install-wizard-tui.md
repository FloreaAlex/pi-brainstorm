# Pi-Brainstorm Install Wizard Spec

This document extends [2026-04-03-distributable-setup-and-packaging.md](./2026-04-03-distributable-setup-and-packaging.md). It does not change the repo's release stance: distribution is still `git clone` for teammates, not `npm publish`.

## 1. Purpose

Add a true provisioning flow that can take a fresh teammate machine from cloned repo to working `pi-brainstorm`, while staying aligned with the repo's existing config model:

- `npm run wizard` performs full provisioning
- `npm run setup` remains repair/reconfigure for extension wiring and machine config
- `npm run doctor` remains diagnostic only and never mutates state

The wizard must reuse the same live environment scan as `doctor`. It must not wrap the current `runSetup()` implementation as a black box because that function already prompts for provider detection, auth status, and permission policy.

## 2. Packaging Prerequisite

Before implementing the wizard, the repo must become clean-clone installable.

### Required change

Replace the local `file:../pi-mono/...` entries in `package.json` with published versions of the same four packages:

- `@mariozechner/pi-coding-agent`
- `@mariozechner/pi-tui`
- `@mariozechner/pi-ai`
- `@mariozechner/pi-agent-core`

Use versioned npm dependencies such as `^0.65.0`. Do not introduce new package names. The runtime imports already reference these package names today.

### Acceptance criteria

- `npm install` succeeds in a clean clone without a sibling `../pi-mono`
- `npm run build` succeeds in a clean clone
- `src/extension/index.ts` continues to use the same runtime package imports

## 3. Command Contract

### Stage 0: checked-in bootstrap scripts

Add checked-in scripts:

- `scripts/bootstrap.sh`
- `scripts/bootstrap.ps1`

These are the fresh-machine entrypoints after cloning the repo. They are not hosted `curl | bash` installers.

Responsibilities:

- verify `git` exists
- verify `node` and `npm` exist, or guide/install via `nvm` when that is an accepted path
- run `npm install`
- invoke `npm run wizard`

### Stage 1: Node CLI commands

Update `package.json` and `src/cli.ts` to expose:

- `npm run wizard` -> full provisioning flow
- `npm run setup` -> symlink + machine config repair/reconfigure only
- `npm run doctor` -> live diagnostics only

Do not add `npm run install`; that collides with npm lifecycle semantics.

## 4. Config And State Model

### Machine config

Wizard and setup write machine-specific state to:

- `~/.pi/brainstorm/config.json`

This remains the source of truth for:

- enabled agents
- resolved command paths
- command source metadata
- permission policy
- auth check snapshot

### Project config

Repo-level overrides remain:

- `./brainstorm.config.json`

This file is optional and committed manually by a team when needed. The wizard must not write discovered machine paths into `brainstorm.config.json`.

### Managed tools

Wizard-managed tool assets live under:

- `~/.pi/brainstorm/tools/`

Suggested layout:

- `~/.pi/brainstorm/tools/node_modules/.bin/` for npm-installed bridges
- `~/.pi/brainstorm/tools/bin/` for direct binaries or wrappers if needed later

### Idempotency

Idempotency comes from live state, not persisted "completed phase" flags.

- reruns rescan the machine and skip work that is already satisfied
- partial success is inferred from reality: installed bridges, existing auth, symlink state, machine config contents
- if a separate transient checkpoint file is ever added, it must be optional and must not replace live scanning

## 5. Shared Environment Scan

Introduce a shared scan layer consumed by both `wizard` and `doctor`.

```ts
export interface EnvironmentReport {
  prerequisites: {
    node: { ok: boolean; version?: string };
    npm: { ok: boolean; version?: string };
    git: { ok: boolean; version?: string };
    pi: { ok: boolean; version?: string };
  };
  configs: {
    machineConfigPath: string;
    machineConfigExists: boolean;
    projectConfigPath: string;
    projectConfigExists: boolean;
  };
  extension: {
    symlinkPath: string;
    symlinked: boolean;
    targetOk: boolean;
    target?: string;
  };
  providers: Record<string, {
    supported: boolean;
    resolved?: ResolvedCommand;
    installed: boolean;
    authenticated: boolean;
    authError?: string;
    installSpec?: ProviderInstallSpec | null;
    loginCommand?: string;
  }>;
}
```

Rules:

- `EnvironmentReport` is a live scan result, not persisted installer progress
- `doctor` formats the report and exits non-zero on failures
- `wizard` uses the same report to decide what to prompt for and what to skip
- provider auth verification must run against the resolved binary path, not a pathless provider-level assumption

## 6. Provider Interface Changes

Refactor the provider abstraction so discovery and provisioning use explicit paths and explicit roots.

```ts
export interface ResolvedCommand {
  path: string;
  source: "managed" | "node_modules" | "path" | "variant";
}

export interface ProviderInstallSpec {
  kind: "npm" | "brew" | "manual";
  summary: string;
  command?: string;
  args?: string[];
  autoInstallable: boolean;
}

export interface ResolveContext {
  packageRoot: string;
  managedToolsRoot: string;
}

export interface Provider {
  name: string;
  label: string;
  color: string;
  supportedPlatforms(): NodeJS.Platform[];
  resolveCommand(context: ResolveContext): Promise<ResolvedCommand | null>;
  getInstallSpec(platform: NodeJS.Platform, context: ResolveContext): ProviderInstallSpec | null;
  getAuthCommand(command: string): { command: string; args: string[]; env?: Record<string, string> };
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

### Resolution order

Provider resolution must stop using `process.cwd()` or implicit repo-relative lookup. Resolution order becomes:

1. `~/.pi/brainstorm/tools/...` managed install path
2. `<packageRoot>/node_modules/.bin/<command>`
3. `PATH` primary command
4. `PATH` variant commands

This fixes the current inconsistency where provider lookup depends on the caller's working directory.

## 7. Platform Matrix

The wizard must be honest about what it can auto-install versus what it can only detect.

| Platform | Bootstrap support | Claude | Codex | Gemini |
| --- | --- | --- | --- | --- |
| macOS | `bootstrap.sh` | auto-install via managed npm tools | auto-install via Homebrew if available; otherwise instruct manually | auto-install via managed npm tools |
| Linux | `bootstrap.sh` | auto-install via managed npm tools | detect + instruct manually unless a supported package flow is added | auto-install via managed npm tools |
| Windows | `bootstrap.ps1` | auto-install via managed npm tools | unsupported, skip clearly | auto-install via managed npm tools |

Notes:

- Do not describe Homebrew as a Linux prerequisite in the current spec
- On macOS, Homebrew is only relevant if the user selects Codex and Codex is not already installed
- Unsupported providers are shown as unsupported, not missing

## 8. Wizard Flow

### Phase 1: bootstrap handoff

After `npm install`, `npm run wizard` starts by running `scanEnvironment()`.

### Phase 2: prerequisite summary

Show the current state of:

- Node
- npm
- git
- Pi
- extension symlink
- machine/project config presence

If Pi is missing, stop with actionable instructions. The wizard does not need to manage Pi login state.

### Phase 3: provider install selection

Offer provider actions based on `EnvironmentReport`:

- already installed and authenticated -> skip by default
- installed but unauthenticated -> schedule auth only
- auto-installable and missing -> offer installation
- supported but manual-install-only -> show instructions and optionally continue without enabling
- unsupported on this platform -> display and skip

Installations target `~/.pi/brainstorm/tools` where supported by the install method. System-managed installs such as Homebrew remain valid when a provider does not have a portable managed install path.

### Phase 4: interactive auth

For each provider that needs auth:

1. suspend wizard prompt handling
2. spawn the provider auth command with `stdio: "inherit"`
3. resume wizard prompt handling after the child exits
4. rerun `checkAuth(resolved.path)` using the resolved binary

Prefer plain inherited stdio first. Only introduce `node-pty` if a provider demonstrably fails with inherited stdio.

### Phase 5: extension and machine config

Do not call the current `runSetup()` wholesale. Refactor setup into shared primitives, then compose them:

- `ensureExtensionSymlink()`
- `promptPermissionPolicy()`
- `buildMachineConfig(report, selections, policy)`
- `writeMachineConfig(configDir, config)`

The wizard uses those primitives after provisioning. `setup` also uses the same primitives, but without running install/package-manager phases.

### Phase 6: final verification

Run the same scan again and print a concise summary equivalent to a focused `doctor` pass.

## 9. Setup And Doctor Refactor Requirements

### `setup`

`npm run setup` should become:

- ensure extension symlink
- rescan providers using the shared scan logic
- prompt for permission policy if interactive
- write `~/.pi/brainstorm/config.json`

It must not install packages through npm/brew and must not own the wizard's provisioning flow.

### `doctor`

`npm run doctor` should become a formatter over `scanEnvironment()` plus merged config awareness.

It remains non-mutating:

- no installs
- no auth commands
- no config writes

## 10. Acceptance Criteria

The spec is considered implemented only when all of the following are true:

- clean clone: `npm install` works without `../pi-mono`
- `npm run wizard` exists in `package.json` and `src/cli.ts`
- wizard writes only `~/.pi/brainstorm/config.json`, not `brainstorm.config.json`
- provider auth verification runs against resolved command paths
- provider resolution does not depend on `process.cwd()`
- `setup` and `doctor` both consume the shared scan layer
- Windows behavior is explicit: Claude/Gemini supported, Codex skipped as unsupported
- rerunning `wizard` or `setup` on a healthy machine is effectively a no-op except for confirmation output

## 11. Suggested Implementation Order

1. Replace `file:../pi-mono` dependencies with published package versions
2. Add `wizard` to `package.json` and `src/cli.ts`
3. Introduce `ResolveContext`, `ProviderInstallSpec`, and updated provider resolution
4. Build `scanEnvironment()` and refactor `doctor` to consume it
5. Extract shared setup primitives from `src/setup/wizard.ts`
6. Implement `src/installer/` for the provisioning flow
7. Add `bootstrap.sh` and `bootstrap.ps1`
8. Add unit coverage for scan/provider resolution and an integration-style wizard smoke test
