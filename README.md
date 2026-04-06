# pi-brainstorm

Multi-agent brainstorming extension for [pi](https://github.com/mariozechner/pi-mono) coding-agent. Run collaborative AI discussions with Claude, Codex, and Gemini talking to each other in a side-by-side TUI.

## How it works

Each AI coding tool (Claude, Codex, Gemini) is a standalone CLI that speaks its own protocol. [ACP (Agent Client Protocol)](https://agentclientprotocol.com) is an open standard that gives them all a common interface — create sessions, send messages, stream responses, configure models. pi-brainstorm uses ACP to talk to all three agents the same way, without agent-specific code for each one.

Each agent needs two things installed:
- The **CLI tool** itself (`claude`, `codex`, `gemini`) — for direct use and authentication
- An **ACP bridge** (`claude-agent-acp`, `codex-acp`) — a thin wrapper that speaks ACP on one side and the agent's native protocol on the other. Gemini has ACP built in, so no separate bridge is needed.

## Prerequisites

- **Node.js 18+**
- **git**
- **[pi](https://github.com/mariozechner/pi-mono) v0.64.0+** — `npm install -g @mariozechner/pi-coding-agent`

## Install the coding tools

Install and authenticate the tools you want to use **before** running the wizard. The wizard will detect what's already on your PATH and skip those.

### Claude

```bash
npm install -g @anthropic-ai/claude-code
claude login

npm install -g @agentclientprotocol/claude-agent-acp
```

### Codex

```bash
brew install codex
codex login

brew install codex-acp
```

### Gemini

```bash
npm install -g @google/gemini-cli
gemini    # authenticates via browser on first run
```

> **nvm users**: Global npm packages are per-Node-version. Make sure you install everything with the same Node version you use day-to-day.

## Setup

```bash
git clone <repo-url>
cd pi-brainstorm
npm install
npm run wizard
```

The wizard will:
1. Check prerequisites (Node.js, git, pi)
2. Detect already-installed tools on your PATH
3. Offer to install anything missing (best-effort — manual install above is more reliable)
4. Symlink the extension into pi
5. Configure permissions

After the wizard finishes:

```bash
pi          # start pi in any project
/brainstorm # inside pi, start a brainstorm session
```

Re-run `npm run wizard` after `git pull` or when adding new providers.

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
| `/agents` | List agent status (model, thinking level, context window) |

### @mentions

Type `@claude what do you think?` to direct a message to a specific agent.

### Keyboard shortcuts

- **Ctrl+E**: Toggle reasoning/thinking visibility

## Configuration

### Machine config (`~/.pi/brainstorm/config.json`)

Written by the wizard. Contains resolved provider paths, auth state, and permission policy. You shouldn't need to edit this manually.

### Project config (`brainstorm.config.json`)

Optional. Commit to your repo to set team defaults:

```json
{
  "version": 1,
  "agents": {
    "claude": { "preferredModel": "claude-opus-4-6" },
    "codex": { "preferredModel": "gpt-5.4" },
    "gemini": { "preferredModel": "gemini-3.1-pro" }
  }
}
```

Project config merges on top of machine config. `null` values reset to defaults.

## Permission model

The wizard prompts for a permission policy: **full** (default) or **restricted**.

| Provider | Full access | Restricted |
|----------|-------------|------------|
| Claude | ACP bypassPermissions mode + env vars | Default mode with approval prompts |
| Codex | `danger-full-access` + `approval_policy="never"` | Default sandbox with approvals |
| Gemini | `--approval-mode=yolo` + `GEMINI_SANDBOX=false` | Default mode with optional sandbox |

## Troubleshooting

Run diagnostics first:

```bash
npm run doctor
```

Common issues:

- **`pi: command not found`**: Pi is a global npm package. If you use nvm, it must be installed for your current Node version. Run `npm install -g @mariozechner/pi-coding-agent` with the right Node version active.
- **Agent "not found" but it's installed**: Same nvm issue — global npm packages are per-Node-version. Install with the correct Node version active.
- **Agent won't start**: Run `npm run doctor` to check command resolution and auth status.
- **Permission denied (Claude)**: Check `~/.claude/settings.json` has `"permissions": { "defaultMode": "bypassPermissions" }`.
- **Codex keychain popup**: Ensure `CODEX_CLI_AUTH_CREDENTIALS_STORE=file` is set (the wizard handles this).
- **Gemini ACP startup fails**: Check Node.js version compatibility and that `gemini --acp` works standalone.

## Development

```bash
npm run dev      # watch mode (tsc --watch)
npm run build    # one-time build
npm test         # unit tests
npm run wizard   # full provisioning flow
npm run setup    # lighter setup (detect + configure, no install)
npm run doctor   # diagnostics
```
