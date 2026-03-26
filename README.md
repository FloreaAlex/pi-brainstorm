# pi-brainstorm

A [pi](https://github.com/badlogic/pi-mono) extension for multi-agent brainstorming. Send a message and get responses from Claude and Codex simultaneously. Watch them debate, agree, and build on each other's ideas in real time.

Uses the [Agent Client Protocol (ACP)](https://agentclientprotocol.com) to communicate with any ACP-compatible coding agent.

## Prerequisites

- [pi](https://github.com/badlogic/pi-mono) coding agent installed globally (`npm install -g @mariozechner/pi-coding-agent`)
- Node.js 18+
- At least one ACP bridge:

| Agent | Bridge | Install |
|-------|--------|---------|
| Claude Code | [claude-agent-acp](https://github.com/zed-industries/claude-agent-acp) | `npm install -g @zed-industries/claude-agent-acp` |
| Codex | [codex-acp](https://github.com/zed-industries/codex-acp) | `brew install codex-acp` |

Both agents must be authenticated separately (Claude via `claude` CLI, Codex via `codex` CLI).

## Install

```bash
git clone https://github.com/FloreaAlex/pi-brainstorm.git
cd pi-brainstorm
npm install
npm run build

# Link as a global pi extension
mkdir -p ~/.pi/agent/extensions
ln -sf "$(pwd)" ~/.pi/agent/extensions/pi-brainstorm
```

## Usage

Start pi in any project directory, then:

```
/brainstorm
```

Both agents spawn and you're in a 3-way conversation.

### Commands

| Command | Description |
|---------|-------------|
| `/brainstorm` | Start a brainstorm session with all configured agents |
| `/brainstorm stop` | End the session and kill agent processes |
| `@claude <message>` | Direct a message to Claude only (Codex still sees the history) |
| `@codex <message>` | Direct a message to Codex only |
| `/mute <agent>` | Mute an agent (it stops responding but still sees messages) |
| `/unmute <agent>` | Unmute an agent |
| `/agents` | List active agents and their status |
| `/restart <agent>` | Kill and re-spawn an agent |
| `/auto [turns] [topic]` | Start autonomous discussion (agents talk to each other) |
| `/auto continue [turns] [message]` | Continue auto discussion, optionally inject a steering message |

### Autonomous Mode

Let the agents debate without you:

```
/auto 3 discuss the architecture of this project
```

Each agent gets 3 turns. They go sequentially (one speaks, the other responds). A random agent summarizes at the end. Type anything to interrupt and take over.

```
/auto continue 2 focus on the auth bug specifically
```

Continue for 2 more turns each, with a steering message injected before they resume.

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+E` | Toggle reasoning/thinking blocks visibility |

## How It Works

```
You (pi TUI)
    |
    v
Orchestrator ──> ACP stdio ──> claude-agent-acp (subprocess)
    |                |
    |                └──> codex-acp (subprocess)
    v
TUI Renderer (side-by-side streaming, threaded collapse)
```

1. You type a message in pi
2. The extension intercepts it and sends to all active (unmuted) agents via ACP
3. Both agents stream responses in parallel, rendered side-by-side
4. When both finish, responses collapse to full-width threaded view
5. The full conversation history is shared -- agents see and build on each other's responses

### ACP Integration

Each agent is spawned as a subprocess communicating via JSON-RPC over stdio using the [ACP TypeScript SDK](https://www.npmjs.com/package/@agentclientprotocol/sdk). The extension acts as an ACP client:

- Advertises `fs` and `terminal` capabilities
- Implements `readTextFile`, `writeTextFile`, `createTerminal`, etc.
- Auto-approves permission requests via `requestPermission`
- Sets full-permission session modes when available (`bypassPermissions`, `full-access`)

### Adding More Agents

Any ACP-compatible CLI can be added. Edit `src/types.ts`:

```typescript
export const DEFAULT_AGENTS: Record<string, AgentConfig> = {
  claude: {
    name: "claude",
    command: "claude-agent-acp",
    args: [],
    color: "#4a9eff",
    label: "Claude",
  },
  codex: {
    name: "codex",
    command: "codex-acp",
    args: ["-c", 'sandbox_permissions=["disk-full-read-access","disk-full-write-access","network-full-access"]'],
    color: "#10b981",
    label: "Codex",
  },
  // Add your agent here:
  gemini: {
    name: "gemini",
    command: "gemini-cli-acp",
    args: [],
    color: "#f59e0b",
    label: "Gemini",
  },
};
```

Rebuild and restart pi.

## Customization

### System Prompt

Edit `src/PROMPT.md` to change how agents behave in the brainstorm. The prompt uses `{{variable}}` interpolation:

- `{{agent_name}}` -- the agent's internal name
- `{{agent_label}}` -- display name (e.g., "Claude")
- `{{participants}}` -- all participants in the session
- `{{working_directory}}` -- the current project path

You can also place a `BRAINSTORM_PROMPT.md` in your project root to override per-project.

### Auto Mode Prompt

Edit `src/AUTO_PROMPT.md` to customize autonomous discussion behavior. Supports conditional blocks:

```
{{#topic}}
## Focus topic
{{topic}}
{{/topic}}
```

## Development

```bash
npm run build     # Compile TypeScript + copy prompt files to dist
npm run dev       # Watch mode
npm test          # Unit tests
npm run test:e2e  # E2E tests (requires ACP bridges installed + authenticated)
```

### Project Structure

```
src/
  index.ts          Extension entry point, slash commands, event wiring
  orchestrator.ts   Message routing, @mentions, mute, auto mode loop
  agents.ts         ACP client, subprocess spawning, stream handling
  renderer.ts       TUI components (AgentBlock, SplitColumn, boxes)
  prompt.ts         Template loading and {{variable}} interpolation
  types.ts          Shared types, default agent configs
  split-column.ts   Side-by-side rendering component
  PROMPT.md         System prompt template
  AUTO_PROMPT.md    Auto mode prompt template
```

## Known Issues

- `claude-agent-acp` sends `tool_call` ACP notifications that don't pass the SDK's schema validation. These are suppressed (non-breaking -- message streaming works fine).
- Codex on macOS may require keychain access for ChatGPT auth on first launch. The extension sets `CODEX_CLI_AUTH_CREDENTIALS_STORE=file` to use file-based auth instead.

## License

MIT
