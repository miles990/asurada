# Contributing to Asurada

Thanks for your interest in contributing! Asurada is a perception-driven AI agent framework, and we welcome contributions of all kinds.

## Getting Started

```bash
git clone https://github.com/miles990/asurada.git
cd asurada
npm install
npm run build
npm test
```

Verify everything works by running an example:

```bash
npx tsx examples/minimal.ts
```

## Project Structure

```
src/
├── core/           # EventBus, reactive primitives
├── config/         # YAML config loader + types
├── perception/     # Plugin-based environment sensing
├── loop/           # OODA cycle + action parsing + LLM runners
├── memory/         # File-based storage + FTS5 search + cognitive graph
├── lanes/          # Multi-lane parallel task execution
├── notification/   # Provider-based notifications (console, Telegram)
├── obsidian/       # Vault sync, frontmatter, wikilinks
├── logging/        # JSONL structured logging
├── process/        # Daemon management (launchd, pidfile)
├── setup/          # Wizard, environment detection, scaffolding
├── api/            # HTTP API + SSE
├── plugins/        # Built-in perception plugins
└── ui/             # Dashboard assets

docs/               # User-facing documentation
examples/           # Working examples (minimal, perception, personalities)
```

## Development Workflow

### TypeScript

Asurada uses TypeScript strict mode. Always typecheck before committing:

```bash
npm run typecheck    # tsc --noEmit
npm run build        # Full compile
npm test             # Run all tests
```

### Tests

Tests use Node.js built-in test runner (`node --test`). Test files live next to source files:

```
src/core/event-bus.ts       # Source
src/core/event-bus.test.ts  # Tests
```

Write tests for new modules:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('MyModule', () => {
  it('does the thing', () => {
    assert.strictEqual(1 + 1, 2);
  });
});
```

### Adding a Perception Plugin

A perception plugin is any shell command that outputs text. See [docs/plugin-guide.md](docs/plugin-guide.md) for the full guide.

### Adding a Notification Provider

Implement the `NotificationProvider` interface:

```typescript
interface NotificationProvider {
  readonly type: string;
  send(message: string): Promise<void>;
}
```

Register it in `src/notification/providers/` and add config support in `src/config/types.ts`.

### Adding a CycleRunner

Implement the `CycleRunner` interface:

```typescript
interface CycleRunner {
  run(prompt: string, systemPrompt?: string): Promise<string>;
}
```

See `src/loop/runners/` for existing implementations (Claude CLI, Anthropic API).

## Design Principles

Before proposing changes, understand what Asurada values:

1. **Perception before action** — The agent observes first, then decides
2. **File = Truth** — All state in readable files (Markdown + JSONL). No database migrations
3. **Interface shapes cognition** — Every design choice trains a cognitive pattern. See [docs/design-philosophy.md](docs/design-philosophy.md)
4. **Participation over automation** — Keep the user in the loop. Friction is sometimes intentional
5. **Minimal dependencies** — 3 runtime deps (better-sqlite3, express, yaml). Think twice before adding more

## Pull Requests

1. Fork the repo and create a feature branch
2. Make your changes with tests
3. Run `npm run typecheck && npm test`
4. Open a PR with a clear description of what and why

Keep PRs focused — one feature or fix per PR. Large changes benefit from opening an issue first to discuss the approach.

## Reporting Issues

Open an issue at [github.com/miles990/asurada/issues](https://github.com/miles990/asurada/issues) with:

- What you expected vs what happened
- Steps to reproduce
- Your environment (OS, Node.js version, config)

## Code of Conduct

Be respectful. We're building something together.

## License

By contributing, you agree that your contributions will be licensed under MIT.
