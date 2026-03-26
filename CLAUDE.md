# Pi Brainstorm

Multi-agent brainstorming extension for pi coding-agent via ACP (Agent Client Protocol).

## Before making changes

Always check the ACP spec and pi extension API before implementing anything:

- **ACP protocol**: https://agentclientprotocol.com — check the spec before adding/modifying agent communication, session management, permissions, or terminal/filesystem handling. Use standard ACP mechanisms, not custom workarounds.
- **Pi extension API**: Read `@mariozechner/pi-coding-agent` types (`ExtensionAPI`, `ExtensionContext`, etc.) before modifying the extension entry point or adding new commands/events. Pi may already provide what you need.
- **Pi TUI**: Check `@mariozechner/pi-tui` exports before building custom components. Use existing components where possible.

## Architecture

- `src/agents.ts` — ACP client, spawns agents as subprocesses via `@agentclientprotocol/sdk`
- `src/orchestrator.ts` — Message routing, @mentions, mute/unmute, auto mode loop
- `src/renderer.ts` — TUI rendering (streaming side-by-side, collapsed threaded view, box borders)
- `src/index.ts` — Pi extension entry point, slash commands, event wiring
- `src/prompt.ts` — Template loading, `{{variable}}` and `{{#conditional}}` interpolation
- `src/split-column.ts` — Side-by-side column component
- `src/types.ts` — Shared types and default agent configs
- `src/PROMPT.md` — System prompt for brainstorm sessions
- `src/AUTO_PROMPT.md` — Prompt for autonomous discussion turns

## Key decisions

- Permissions: ACP `requestPermission` auto-approves (standard for all agents). Agent-specific modes (`bypassPermissions`, `full-access`) set when available as optimization. Don't hardcode mode names per agent — use a priority list and pick the first match.
- The extension must implement ACP client capabilities (fs, terminal) because some bridges (codex-acp) delegate file/terminal operations to the client rather than handling them internally. Claude's bridge handles them internally via the Claude SDK.
- System prompt sent only on first message per agent. Auto mode uses a separate `AUTO_PROMPT.md` sent each turn.
- Codex requires `CODEX_CLI_AUTH_CREDENTIALS_STORE=file` env var to avoid macOS Keychain popups in non-interactive subprocesses.
- Claude bridge: `claude-agent-acp` (npm, `@zed-industries/claude-agent-acp`). Codex bridge: `codex-acp` (brew, `zed-industries/codex-acp`). The old `acp-claude-code` (Xuanwo) is archived — don't use it.
- The ACP SDK validates incoming notifications with zod. `claude-agent-acp` sends `tool_call` updates that fail validation — these are suppressed via console.error filter. Not fixable on our side.
- Pi's extension API has no `requestRender()` — use `ctx.ui.setStatus()` to trigger re-renders.
- Pi extensions must export a `default` function, not a named export.
- Prompt files (.md) must be copied to `dist/` in the build step — TypeScript doesn't copy non-ts files.

## Gotchas

- `pi-mono` is a third-party library — never modify it directly. Build features as extensions.
- Extension discovery path is `~/.pi/agent/extensions/`, NOT `~/.pi/extensions/`.
- Each ACP bridge handles capabilities differently. Always test with real bridges, not just mocks.
- Codex-acp `session/new` hangs if keychain auth fails silently. The `authenticate` call before `newSession` helps but isn't always sufficient — file-based auth via env var is the reliable fix.

## Dev

```bash
npm run build    # compile + copy prompt .md files to dist
npm run dev      # watch mode
npm test         # unit tests
npm run test:e2e # E2E tests (requires ACP bridges installed + authenticated)
```

Extension is symlinked at `~/.pi/agent/extensions/pi-brainstorm`.
