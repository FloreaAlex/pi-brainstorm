# Specification: Pi-Brainstorm Install Wizard (TUI)

## 1. Overview
The Install Wizard is a one-stop-shop terminal interface designed to take a fresh machine to a fully functional `pi-brainstorm` environment. It automates the installation of Node.js dependencies, the Pi coding agent, ACP bridges (Claude, Codex, Gemini), and handles interactive authentication.

## 2. Architecture & Commands

### Stage 0: The Shell Bootstrapper (`scripts/bootstrap.sh`)
**Goal:** Entry point for fresh clones. Ensures Node.js and Git are present.
- **Checks:** `node` (>=18), `npm`, `git`, `brew` (macOS/Linux).
- **Action:** 
  1. Detect/Install `nvm` if Node is missing.
  2. Run `npm install` (using published `@mariozechner/pi-*` packages).
  3. Execute `npm run wizard`.

### Stage 1: The Node Wizard (`npm run wizard`)
**Goal:** Interactive provisioning and configuration.
- **UI:** Line-oriented ANSI using `clack` (prompts) and `ora` (spinners).
- **Interactive Auth:** Uses a "Suspend/Resume" pattern (pausing `stdin`) to spawn `claude login`, `codex auth`, etc., with `stdio: 'inherit'`.

### Command Suite
- `npm run wizard`: Full interactive provisioning (Discovery -> Install -> Auth -> Setup).
- `npm run setup`: Re-runs extension symlinking and machine configuration (Idempotent).
- `npm run doctor`: Non-mutating diagnostic based on the shared `EnvironmentReport`.

## 3. The Shared Gap Model (`scanEnvironment`)
To ensure consistency between the Wizard and the Doctor, both will consume a shared `scanEnvironment()` utility.

```typescript
export interface EnvironmentReport {
  pi: { installed: boolean; version?: string };
  prerequisites: { node: boolean; npm: boolean; git: boolean; brew?: boolean };
  providers: Record<string, {
    installed: boolean;
    command?: string;
    commandSource?: string;
    authenticated: boolean;
    authError?: string;
    version?: string;
  }>;
  extension: { symlinked: boolean; configExists: boolean };
}
```

## 4. Provider Interface Extensions
Refactor `src/providers/types.ts` to include declarative specs:

```typescript
export interface Provider {
  readonly id: string;
  readonly name: string;
  
  // Declarative Installation Spec
  getInstallSpec(platform: NodeJS.Platform): {
    type: 'npm' | 'brew' | 'binary';
    package: string;
    description: string;
  } | null;

  // Declarative Auth Spec
  getAuthCommand(): { command: string; args: string[] } | null;
  checkAuth(): Promise<{ authenticated: boolean; user?: string; error?: string }>;
}
```

## 5. Managed Tool Location
ACP bridges installed by the wizard are machine-scoped, not repo-scoped:
- **Path:** `~/.pi/brainstorm/tools/`
- **Resolution:** `Registry.resolve()` prioritizes this path before the global `PATH`.

## 6. Implementation Phases

### Phase 1: Portability (Prerequisite)
- Replace `file:../pi-mono` links in `package.json` with published `@mariozechner/pi-*` versions (`^0.65.0`).

### Phase 2: Environment Discovery
- Wizard runs `scanEnvironment()`.
- Displays a "Gap Report" showing missing prerequisites, bridges, or unauthenticated accounts.

### Phase 3: Provisioning (Multi-select)
- User selects which ACP bridges to install.
- Wizard installs selected bridges into `~/.pi/brainstorm/tools/`.

### Phase 4: Interactive Authentication
- For each unauthenticated provider, the wizard:
  1. Pauses its own `stdin`.
  2. Spawns `getAuthCommand()` with `stdio: 'inherit'`.
  3. Resumes on process exit and re-runs `checkAuth()`.

### Phase 5: Extension Configuration
- Creates symlink `~/.pi/agent/extensions/pi-brainstorm` -> repo root.
- Writes `brainstorm.config.json` with detected tool paths.

## 7. Error Handling & Idempotency
- **State Persistence:** Partial success (e.g., successful auth) is written to `~/.pi/brainstorm/config.json`.
- **Re-runs:** The wizard skips any phase already marked as "Complete" in the `EnvironmentReport`.
- **Doctor Integration:** If the wizard fails, it suggests running `npm run doctor` for a detailed trace.
