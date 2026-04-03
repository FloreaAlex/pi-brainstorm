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
npm run doctor
node dist/cli.js doctor --json
```

## Troubleshooting

- **Setup says agent "not found" but it's installed**: If you use nvm, agents are installed per Node version. Make sure you install agents with the same Node version you use day-to-day:
  ```bash
  nvm use 22  # or whichever version you use
  npm install -g @agentclientprotocol/claude-agent-acp @google/gemini-cli
  npm run setup
  ```
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
