# Contributing

## Setup

```bash
git clone <repo-url>
cd pi-brainstorm
npm install
npm run build
```

## Development

```bash
npm run dev      # watch mode
npm test         # run tests
npm run build    # build once
```

## Project structure

- `src/extension/` -- Pi extension runtime (index, orchestrator, agents, renderer)
- `src/providers/` -- Provider registry (claude, codex, gemini)
- `src/setup/` -- Setup wizard and doctor
- `src/config.ts` -- Config loading, merging, writing
- `src/prompt.ts` -- Prompt template loading and interpolation
- `src/cli.ts` -- CLI entry point
- `prompts/` -- Default prompt templates
- `test/` -- Unit tests

## Import boundaries

- Nothing in `src/extension/` may import from `src/setup/`
- Both may import from `src/providers/`, `src/config.ts`, `src/prompt.ts`

## Testing

Unit tests use vitest. Run with `npm test`.

Provider smoke tests (real ACP connections) are env-gated and run separately.
