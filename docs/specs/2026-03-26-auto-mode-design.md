# Auto Mode — Design Spec

## Summary

Add an autonomous discussion mode to the brainstorm extension where agents take turns talking to each other without human input. The human observes and can interrupt at any time (which ends auto mode). A summary turn is generated at the end.

## Commands

| Command | Effect |
|---------|--------|
| `/auto [turns] [topic]` | Start auto mode. Default 3 turns per agent. Topic is optional — if omitted, agents continue the existing conversation. |
| `/auto continue [turns]` | Resume auto for more turns (default 1 per agent). Picks up where it left off. |
| Any input during auto | Current agent's turn completes, auto mode deactivates, input is processed normally. |

## Architecture

### State

Auto mode is a state within the existing orchestrator, not a separate class. New state:

```typescript
interface AutoModeState {
  active: boolean;
  turnsRemaining: Map<string, number>;  // per-agent turns left
  turnOrder: string[];                   // randomized agent order
  currentTurnIdx: number;               // index into turnOrder
  topic?: string;                        // optional focus topic
}
```

### Turn Flow

1. `/auto 3 discuss architecture` parsed by command handler
2. Orchestrator enters auto mode, shuffles agent order randomly
3. First agent receives the auto prompt (from `AUTO_PROMPT.md`) with turn info + full conversation history
4. Agent responds sequentially — response streams into the UI with pulsing border animation
5. Response appended to shared conversation history
6. Next agent's turn — they see the full history including the previous agent's response
7. Repeat until all turns exhausted
8. Random agent gets a summary turn (`is_summary = true`)
9. Auto mode deactivates, user gets control back

### Sequential Execution

Turns are strictly sequential — Agent A responds fully, then Agent B sees that response and replies. No parallel streaming during auto mode. This ensures coherent conversation.

### Interruption

If the user types anything during auto mode:
1. The currently streaming agent's response completes (don't cut mid-stream)
2. Auto mode deactivates
3. The user's input is processed as a normal brainstorm message
4. All prior auto messages remain in the shared history

### Session Integration

Auto mode runs within the existing brainstorm session:
- Same shared history, same agents, same ACP connections
- Auto turns appear in the conversation thread like any other messages
- The "source" field on each message is the agent's name (same as @mention responses)
- After auto ends, normal brainstorming continues with full context

`/auto continue` re-enters auto mode with fresh turn counts, using the existing turn order.

## Auto Prompt

Stored in `src/AUTO_PROMPT.md`, loaded and interpolated the same way as `PROMPT.md`.

Variables:
- `agent_name`, `agent_label` — the responding agent
- `other_agents` — comma-separated list of other participants
- `current_turn`, `total_turns` — turn tracking
- `topic` — optional focus topic (conditional block)
- `is_summary` — triggers summary instructions (conditional block)
- `working_directory` — project path

Conditional blocks use `{{#variable}}...{{/variable}}` syntax — rendered only when variable is truthy. The `interpolatePrompt` function needs extension to support this.

## Visual

### Pulsing Border Animation

During auto mode, the active agent's box border pulses — alternates between bright and dim variants of their color on the existing 80ms timer. The waiting agent's box has a dim/muted border.

### Status Bar

Shows auto mode progress: `⚡ Brainstorm [AUTO 2/3] codex's turn`

### Between Turns

Brief visual transition — both borders dim momentarily before the next agent's border starts pulsing.

## Files Changed

| File | Change |
|------|--------|
| `src/AUTO_PROMPT.md` | New file — auto mode prompt template |
| `src/prompt.ts` | Add conditional block interpolation (`{{#var}}...{{/var}}`) and `loadAutoPromptTemplate()` |
| `src/orchestrator.ts` | Add `AutoModeState`, `startAuto()`, `continueAuto()`, `stopAuto()`, auto turn loop |
| `src/renderer.ts` | Add pulsing border animation on `AgentBlock` |
| `src/index.ts` | Register `/auto` command, handle interruption during auto mode |
| `src/types.ts` | Add `AutoModeState` type |

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Agent crashes during auto | Auto mode stops, user notified, surviving agent available |
| Agent times out (60s no chunks) | Skip to next agent's turn, mark timed-out agent |
| Only one agent active | Auto mode refused: "Need at least 2 agents for auto mode" |
| `/auto continue` when not in a session | Error: "No active brainstorm session" |
