# Pi Brainstorm

Multi-agent brainstorming extension for pi coding-agent via ACP (Agent Client Protocol).

## Before making changes

Always check the ACP spec and pi extension API before implementing anything:

- **ACP protocol**: https://agentclientprotocol.com — check the spec before adding/modifying agent communication, session management, permissions, or terminal/filesystem handling. Use standard ACP mechanisms, not custom workarounds.
- **Pi extension API**: Read `@mariozechner/pi-coding-agent` types (`ExtensionAPI`, `ExtensionContext`, etc.) before modifying the extension entry point or adding new commands/events. Pi may already provide what you need.
- **Pi TUI**: Check `@mariozechner/pi-tui` exports before building custom components. Use existing components where possible.

## Architecture

- `src/agents.ts` — ACP client, spawns agents as subprocesses via `@agentclientprotocol/sdk`. Sets thinking level and preferred model via ACP `setSessionConfigOption`.
- `src/orchestrator.ts` — Message routing, @mentions, mute/unmute, auto mode loop
- `src/renderer.ts` — TUI rendering (streaming side-by-side, collapsed threaded view, box borders). Uses pi-tui's `truncateToWidth` for safe line truncation.
- `src/index.ts` — Pi extension entry point, slash commands (`/brainstorm`, `/auto`, `/add`, `/mute`, `/unmute`, `/restart`, `/stop`, `/agents`), event wiring
- `src/prompt.ts` — Template loading, `{{variable}}` and `{{#conditional}}` interpolation
- `src/split-column.ts` — Side-by-side column component
- `src/types.ts` — Shared types, default agent configs
- `src/PROMPT.md` — System prompt for brainstorm sessions
- `src/AUTO_PROMPT.md` — Prompt for autonomous discussion turns
## Key decisions

- Permissions: ACP `requestPermission` auto-approves (standard for all agents). Agent-specific modes (`bypassPermissions`, `full-access`) set when available as optimization. Don't hardcode mode names per agent — use a priority list and pick the first match.
- The extension must implement ACP client capabilities (fs, terminal) because some bridges (codex-acp) delegate file/terminal operations to the client rather than handling them internally. Claude's bridge handles them internally via the Claude SDK.
- System prompt sent only on first message per agent. Auto mode uses a separate `AUTO_PROMPT.md` sent each turn.
- Reasoning tokens (thought chunks) are filtered out of shared conversation history — agents only see each other's message content, not reasoning.
- After session creation, the extension sets the highest available `thought_level` via ACP `setSessionConfigOption` (brainstorming benefits from max reasoning effort).
- Agents can specify a `preferredModel` in their config — set via ACP `setSessionConfigOption` with `category: "model"` after session creation.
- Codex requires `CODEX_CLI_AUTH_CREDENTIALS_STORE=file` env var to avoid macOS Keychain popups in non-interactive subprocesses.
- Claude bridge: `claude-agent-acp` (npm, `@zed-industries/claude-agent-acp`). Codex bridge: `codex-acp` (brew, `zed-industries/codex-acp`). The old `acp-claude-code` (Xuanwo) is archived — don't use it.
- The ACP SDK validates incoming notifications with zod. `claude-agent-acp` sends `tool_call` updates that fail validation — these are suppressed via console.error filter. Not fixable on our side.
- Pi's extension API has no `requestRender()` — use `ctx.ui.setStatus()` to trigger re-renders. Use a single status key to avoid footer clutter.
- Pi extensions must export a `default` function, not a named export.
- Prompt files (.md) must be copied to `dist/` in the build step — TypeScript doesn't copy non-ts files.
- Pi already has a built-in `/resume` command — our resume is `/brainstorm resume` (subcommand).
- State is saved to `.pi/brainstorm/state.json` in the project directory. Save AFTER agents respond (on `all_done`), not when the user sends the message.
- Session state also saved via `api.appendEntry()` for pi's own session system.

## Permissions — the full story

Getting agents to have bash/edit access requires multiple layers:

1. **ACP `requestPermission`** handler auto-approves — works for all agents.
2. **ACP `setSessionMode`** to `bypassPermissions` (Claude) or `full-access` (Codex) — reduces permission prompts.
3. **ACP `setSessionConfigOption`** with `configId` matching a `category: "mode"` option — another path some bridges read. Note: the field is `configId`, NOT `optionId`.
4. **`[ACP:PERMISSION:BYPASS]`** marker at the top of prompt templates — inline override that `claude-agent-acp` reads.
5. **`ACP_PERMISSION_MODE=bypassPermissions`** env var on Claude's spawn — may or may not be read depending on bridge version.
6. **`~/.claude/settings.json`** with `"permissions": { "defaultMode": "bypassPermissions" }` — this is what `claude-agent-acp` actually reads via the Claude Agent SDK's `SettingsManager`. This is the most reliable for Claude.
7. **Codex** uses `-c sandbox_permissions=[...]` CLI flag for file/network access and `full-access` ACP mode.

If agents still complain about blocked tools, check `~/.claude/settings.json` first.

## Gotchas

- `pi-mono` is a third-party library — never modify it directly. Build features as extensions.
- Extension discovery path is `~/.pi/agent/extensions/`, NOT `~/.pi/extensions/`.
- Each ACP bridge handles capabilities differently. Always test with real bridges, not just mocks.
- Codex-acp `session/new` hangs if keychain auth fails silently. The `authenticate` call before `newSession` helps but isn't always sufficient — file-based auth via env var is the reliable fix.
- The spinner interval (80ms) must be cleared on `all_done`, `auto_complete`, `/stop`, and cleanup. Leaked intervals cause ghost renders.
- When tracking mutable state for status bar updates (like auto turn info), use a module-level variable — don't capture event data in interval closures or it goes stale.
- TUI components MUST truncate all rendered lines to the given `width`. Use pi-tui's `truncateToWidth()` and `visibleWidth()` — never roll your own ANSI-aware truncation. Pi-tui throws if any line exceeds terminal width.
- Use `visibleWidth()` instead of `.length` when calculating layout with Unicode/ANSI strings. JS `.length` counts code units, not display columns.

## Dev

```bash
npm run build    # compile + copy prompt .md files to dist
npm run dev      # watch mode
npm test         # unit tests
```

Extension is symlinked at `~/.pi/agent/extensions/pi-brainstorm`.
