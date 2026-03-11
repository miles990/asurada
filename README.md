# Asurada

[![CI](https://github.com/miles990/asurada/actions/workflows/ci.yml/badge.svg)](https://github.com/miles990/asurada/actions/workflows/ci.yml)

> The AI agent framework that grows with you — not just for you.

Asurada is a **perception-driven personal AI agent framework**. Instead of executing goals blindly, your agent observes the environment first, then decides what to do — like a co-pilot that learns your patterns, nudges you when you're stuck, and evolves alongside you.

Named after the AI navigation system in *Future GPX Cyber Formula* — autonomous judgment, environmental awareness, guiding the driver.

## Why Asurada?

Most AI agent frameworks give you a tool. Asurada gives you a **growth partner**.

- **Perception-first**: OODA cycle (Observe → Orient → Decide → Act) as the heartbeat. Plugins define what your agent can see — each agent's world is different
- **File = Truth**: All state in Markdown + JSONL. No database. `cat` to read, `git` to version, Obsidian to visualize
- **Multi-lane parallelism**: Main OODA cycle + foreground lane + 6 background tentacles. Like slime mold — explore multiple directions, strengthen what works, prune what doesn't
- **Self-evolution**: Error pattern detection, perception citation tracking, decision quality scoring. Your agent gets smarter the more it runs
- **Co-evolution**: The agent observes your behavior patterns, suggests improvements, and adapts to your feedback. You both grow

## Quick Start

```bash
git clone https://github.com/miles990/asurada.git
cd asurada && npm install && npm run build
```

```typescript
import { createAgent, ClaudeCliRunner } from 'asurada';

const agent = await createAgent('./asurada.yaml', {
  loop: {
    runner: new ClaudeCliRunner({ model: 'sonnet' }),
  },
});

await agent.start();
// Agent is now running — perceiving, thinking, acting
```

Or use the Anthropic API directly:

```typescript
import { createAgent, AnthropicApiRunner } from 'asurada';

const agent = await createAgent('./asurada.yaml', {
  loop: {
    runner: new AnthropicApiRunner({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    }),
  },
});

await agent.start();
```

### Config (`asurada.yaml`)

```yaml
agent:
  name: my-agent
  persona: A curious and helpful personal assistant

perception:
  plugins:
    - name: system-monitor
      command: "echo \"Load: $(uptime | sed 's/.*load averages: //')\""
      category: system

memory:
  dir: ./data

notification:
  providers:
    - type: console  # or telegram, discord, slack

loop:
  enabled: true
  model: sonnet
  interval: 5m
```

## Architecture

```
Perception (See)  →  OODA Loop (Think)  →  Actions (Do)
     ↓                    ↓                    ↓
  Plugins            Memory Index         Notifications
  Streams            Multi-Lane           HTTP API
  CDP Web            Self-Evolution       Obsidian Sync
```

### Core Modules

| Module | What it does |
|--------|-------------|
| **Perception** | Plugin system + streams. Shell scripts as sensors, `distinctUntilChanged` dedup |
| **OODA Loop** | Perception → build context → LLM cycle → parse actions → execute. Crash-resumable |
| **Memory** | Append-only JSONL store + FTS5 full-text search + cognitive graph index + ContextBuilder |
| **Event Bus** | Typed events + wildcard patterns + reactive primitives (debounce, throttle) |
| **Multi-Lane** | Main + foreground + 6 background lanes. Organic parallelism |
| **Notification** | Provider interface — console, Telegram, Discord, Slack, email |
| **HTTP API** | `/health`, `/status`, `/api/message`, `/api/events` (SSE) |
| **Obsidian** | Vault sync — frontmatter, wikilinks, graph view colors by cognitive type |
| **Process Mgmt** | launchd (macOS) / pidfile (Linux). Auto-restart on crash |
| **Config** | YAML-based. Sensible defaults, zero-config possible |
| **Logging** | Structured `slog()` + `diagLog()` + behavior tracking |
| **CLI** | `asurada start`, `asurada status`, `asurada init` |
| **CycleRunners** | Built-in: `ClaudeCliRunner` (zero-config) + `AnthropicApiRunner` (direct API) |

### Action Tags

Your LLM responds with action tags that Asurada parses and executes:

```xml
<agent:remember>Learned something important</agent:remember>
<agent:chat>Hey, I noticed something interesting</agent:chat>
<agent:schedule next="5m" reason="Following up on a task" />
```

### Memory Architecture

```
Hot    (In-Memory)  → Recent conversations
Warm   (Daily)      → daily/YYYY-MM-DD.md
Cold   (Long-term)  → MEMORY.md + topics/*.md
Index  (Graph)      → memory-index.jsonl — unified cognitive graph
```

The memory index uses `refs[]` to link any entry to any other entry, forming a natural knowledge graph. `ContextBuilder` combines topic loading + index-based relevance boosting + direction-change audit trails into cycle prompts. Combined with Obsidian's `[[wikilinks]]`, you can visualize your agent's thinking in graph view.

## Obsidian Integration

Open Obsidian → see your agent's mind.

- Topics become markdown files with YAML frontmatter
- `refs[]` become `[[wikilinks]]` — navigate the knowledge graph
- Graph view colors by cognitive type: green=memories, blue=learning, orange=commitments, purple=threads
- Edit in Obsidian → agent picks up changes next cycle

## How It Differs

| | Goal-driven (AutoGPT, BabyAGI) | Platform (OpenClaw) | **Asurada** |
|---|---|---|---|
| Paradigm | Given goal → execute steps | Agent on platform | **Perceive environment → decide** |
| Data | Database | Platform-managed | **Files (Markdown + JSONL)** |
| Identity | None | Platform identity | **SOUL.md — user-defined** |
| Memory | Vector DB | Opaque | **Transparent (cat, git, Obsidian)** |
| Runs on | Cloud | Platform | **Your machine** |
| Evolves | No | Limited | **Self-improving (skills, perception, behavior)** |

## Setup Wizard

First time? The wizard walks you through everything:

```bash
asurada init
```

It detects your environment (OS, Chrome, available LLMs), asks you to name your agent and choose a persona, connects your notification channel (Telegram, Discord, or console), and scaffolds a memory directory with a starter SOUL.md.

On first start, your agent introduces itself — showing what it can perceive and how to interact with it.

## Examples

| Example | What it shows |
|---------|--------------|
| [`minimal.ts`](examples/minimal.ts) | Mock runner, basic action parsing. No LLM needed |
| [`with-perception.ts`](examples/with-perception.ts) | Real perception plugins (git, disk, uptime). Shows environment-driven behavior |
| [`personality-configs.ts`](examples/personality-configs.ts) | Same framework, 3 different agents — dev assistant, research companion, security sentinel |

```bash
npx tsx examples/minimal.ts          # Quick test
npx tsx examples/with-perception.ts  # See perception in action
```

## Writing Perception Plugins

A plugin is a shell command or script that outputs text:

```yaml
perception:
  plugins:
    # Inline command — quick and simple
    - name: weather
      command: "curl -s 'wttr.in/?format=3'"
      category: environment

    # Script file — for complex logic
    - name: tasks
      script: ./plugins/task-tracker.sh
      category: workspace
```

The output appears in the LLM's context as `<weather>Taipei: +28C</weather>`. Your agent sees the world through its plugins — each agent's Umwelt is different.

**Tips:**
- Use `command:` for inline shell commands, `script:` for file-based plugins
- Plugins should be fast (<10s) and produce concise output
- Use `category` to group related plugins and set shared intervals
- `outputCap` limits output length (default: 4000 chars)
- `distinctUntilChanged` automatically deduplicates — unchanged output doesn't trigger a new cycle

For the full guide — real-world examples, advanced patterns (circuit breaker, auto-restart, event-driven), and design principles — see **[docs/plugin-guide.md](docs/plugin-guide.md)**.

## Documentation

| Doc | Description |
|-----|-------------|
| [Architecture](docs/architecture.md) | How Asurada works internally — module map, data flow, extension points |
| [Configuration](docs/configuration.md) | Complete YAML config reference — every field, defaults, and common setups |
| [Plugin Guide](docs/plugin-guide.md) | Writing perception plugins — examples, advanced patterns, design principles |
| [API Reference](docs/api-reference.md) | HTTP endpoints — health, status, context, messages, SSE events |
| [Design Philosophy](docs/design-philosophy.md) | Why interfaces shape cognition — the 3-question framework behind every Asurada design decision |

## Requirements

- Node.js >= 20
- Claude Code CLI or Anthropic API key

## Status

Alpha — feature-complete and tested (77 tests, CI green). The core architecture is stable: perception loop, memory index, multi-lane execution, model routing, Obsidian integration. APIs may change before 1.0.

Born from [mini-agent](https://github.com/miles990/mini-agent), a perception-driven personal AI that has run 1,400+ autonomous cycles.

## License

MIT
