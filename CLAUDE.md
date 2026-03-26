# Pi Brainstorm

Multi-agent brainstorming extension for pi coding-agent via ACP (Agent Client Protocol).

## Before making changes

Always check the ACP spec and pi extension API before implementing anything:

- **ACP protocol**: https://agentclientprotocol.com — check the spec before adding/modifying agent communication, session management, permissions, or terminal/filesystem handling. Use standard ACP mechanisms, not custom workarounds.
- **Pi extension API**: Read `@mariozechner/pi-coding-agent` types (`ExtensionAPI`, `ExtensionContext`, etc.) before modifying the extension entry point or adding new commands/events. Pi may already provide what you need.
- **Pi TUI**: Check `@mariozechner/pi-tui` exports before building custom components. Use existing components where possible.

## Architecture

- `src/agents.ts` — ACP client, spawns agents as subprocesses via `@agentclientprotocol/sdk`
- `src/orchestrator.ts` — Message routing, @mentions, mute/unmute, conversation state
- `src/renderer.ts` — TUI rendering (streaming side-by-side, collapsed threaded view)
- `src/index.ts` — Pi extension entry point, slash commands, event wiring
- `src/prompt.ts` — PROMPT.md template loading and interpolation
- `src/split-column.ts` — Side-by-side column component
- `src/types.ts` — Shared types and default agent configs

## Key decisions

- Permissions: ACP `requestPermission` auto-approves (standard). Agent-specific modes (`bypassPermissions`, `full-access`) set when available as optimization.
- System prompt sent only on first message per agent, built dynamically to reflect current participants.
- Codex requires `CODEX_CLI_AUTH_CREDENTIALS_STORE=file` env var to avoid macOS Keychain popups.
- Claude bridge: `claude-agent-acp` (npm). Codex bridge: `codex-acp` (brew).

## Dev

```bash
npm run build    # compile + copy PROMPT.md to dist
npm test         # unit tests
npm run test:e2e # E2E tests (requires ACP bridges installed)
```

Extension is symlinked at `~/.pi/agent/extensions/pi-brainstorm`.
