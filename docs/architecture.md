# Architecture

How Asurada works internally — for contributors and curious users.

## System Overview

Asurada is a perception-driven agent framework. The fundamental loop:

```
Perceive → Think → Act → Remember → Perceive again
```

Unlike goal-driven frameworks (AutoGPT, BabyAGI), Asurada doesn't start with a goal. It starts by observing the environment through **perception plugins**, then decides what to do. The architecture reflects this: perception is a first-class module, not an afterthought.

## Module Map

```
                          ┌─────────────┐
                          │  CLI / API  │  ← User entry points
                          └──────┬──────┘
                                 │
                          ┌──────▼──────┐
                          │   Runtime   │  ← Wires everything together
                          └──────┬──────┘
                                 │
          ┌──────────────────────┼──────────────────────┐
          │                      │                      │
    ┌─────▼─────┐         ┌─────▼─────┐         ┌─────▼─────┐
    │ Perception │         │ OODA Loop │         │   Lanes   │
    │  Manager   │────────►│ AgentLoop │         │  Manager  │
    └─────┬─────┘         └─────┬─────┘         └───────────┘
          │                     │                      ▲
     Shell plugins         ┌────▼────┐                 │
     (any language)        │ Runners │           delegate tasks
                           ├─────────┤
                           │ Claude  │
                           │ Anthro  │
                           └────┬────┘
                                │
                 ┌──────────────┼──────────────┐
                 │              │              │
          ┌──────▼──┐   ┌──────▼──┐   ┌──────▼──────┐
          │ Memory  │   │ Notif.  │   │   EventBus  │
          │ Store   │   │ Manager │   │  (backbone)  │
          │ Search  │   └─────────┘   └─────────────┘
          │ Index   │
          └─────────┘
```

All modules communicate through the **EventBus** — the nervous system. Direct coupling between modules is minimal.

## Data Flow: One OODA Cycle

```
1. Timer fires (or event triggers)
        │
2. AgentLoop gathers perception
   └─ PerceptionManager.getCachedResults()
      (plugins run independently on their own intervals)
        │
3. AgentLoop builds prompt
   └─ Perception data wrapped in XML tags: <git-status>...</git-status>
        │
4. Runner calls LLM (Claude CLI or Anthropic API)
        │
5. AgentLoop parses response for action tags
   └─ <agent:remember>, <agent:chat>, <agent:schedule>, <agent:delegate>, etc.
        │
6. onAction callback executes each action
   └─ Save to memory, send notification, spawn lane task, etc.
        │
7. Schedule next cycle
   └─ Default interval, or agent-requested via <agent:schedule next="5m">
```

## Core Modules

### Runtime (`src/runtime.ts`)

The bootstrap. `createAgent()` reads config, instantiates every module, wires them together, and returns an `Agent` object with `start()` / `stop()`.

```typescript
const agent = await createAgent('./asurada.yaml');
await agent.start();   // perception, lanes, loop all begin
// ...
await agent.stop();    // graceful shutdown
```

The Agent interface exposes every module for programmatic access:

```typescript
agent.events       // EventBus
agent.perception   // PerceptionManager
agent.memory       // MemoryStore (file-based)
agent.search       // MemorySearch (FTS5)
agent.index        // MemoryIndex (cognitive graph)
agent.vault        // VaultSync (Obsidian, if enabled)
agent.lanes        // LaneManager (parallel tasks)
agent.loop         // AgentLoop (OODA, if runner provided)
agent.notifications // NotificationManager
agent.logger       // Logger
```

### EventBus (`src/core/event-bus.ts`)

Typed event system with wildcard support. Namespace convention: `category:name`.

```typescript
// Emit
events.emit('trigger:workspace', { file: 'src/index.ts', change: 'modified' });

// Listen (exact)
events.on('trigger:workspace', (event) => { ... });

// Listen (wildcard — catches all trigger:* events)
events.on('trigger:*', (event) => { ... });
```

Categories:
- `trigger:*` — external stimuli (workspace changes, messages, timers)
- `action:*` — agent actions (chat, memory, delegation, lifecycle)
- `log:*` — structured logging events

Reactive primitives (zero dependencies): `debounce()`, `throttle()`, `distinctUntilChanged()`.

### Perception (`src/perception/`)

Plugins are shell scripts that output text. The framework handles scheduling, caching, change detection, and health.

**Manager** (`manager.ts`): Starts/stops plugin streams, serves cached results.

**Executor** (`executor.ts`): Runs a single plugin command with timeout.

**Key patterns** (battle-tested in 1,400+ production cycles):
- **distinctUntilChanged**: Output is hashed. If unchanged from last run, no version increment — prevents redundant LLM processing
- **Circuit breaker**: 3 consecutive timeouts → interval doubles automatically
- **Health check**: Every 5 minutes, detects stale plugins and auto-restarts (up to 3 times)
- **Backpressure metrics**: Per-plugin duration, timeout count, total run time

Plugins run in **any language** — they're just shell commands. Python, Go, curl, whatever outputs text to stdout.

### OODA Loop (`src/loop/`)

The heartbeat. Perception → Prompt → LLM → Parse → Act → Schedule.

**AgentLoop** (`agent-loop.ts`):
- Subscribes to EventBus trigger patterns (configurable, default: `trigger:*`)
- Debounces: if a cycle is already running, incoming triggers are skipped
- Builds prompt from perception data (XML-wrapped sections)
- Calls runner (bring-your-own LLM)
- Parses response for `<namespace:tag>` action tags
- Executes `onAction` callback for each parsed action
- Schedules next cycle (default interval or agent-requested)
- Error backoff: failed cycles retry at 2x interval

**Action Parser** (`action-parser.ts`): Extracts `<agent:tag attr="value">content</agent:tag>` from LLM response. Self-closing tags supported.

**Runners** (`runners/`):
- `ClaudeCliRunner` — spawns `claude -p` subprocess
- `AnthropicApiRunner` — direct HTTP to Anthropic API

Both implement `CycleRunner`: `run(prompt, systemPrompt) → Promise<string>`.

### Memory (`src/memory/`)

Three layers — store, search, and index.

**MemoryStore** (`store.ts`): File-based append-only storage.
- Main memory: `memory/MEMORY.md`
- Topics: `memory/topics/{topic}.md`
- Format: `- [YYYY-MM-DD] content`
- Human-readable, git-versionable

**MemorySearch** (`search.ts`): FTS5 full-text search via better-sqlite3.
- BM25 ranking
- unicode61 tokenizer (works for CJK at character level)
- Auto-indexes `MEMORY.md` + `topics/*.md`
- Graceful degradation if sqlite3 unavailable

**MemoryIndex** (`memory-index.ts`): Append-only JSONL cognitive graph.
- Nodes: concepts, topics, sources
- Edges: relationships between nodes
- Supports Obsidian wikilinks via VaultSync

### Lanes (`src/lanes/`)

Multi-tentacle parallelism. Like slime mold — explore multiple directions simultaneously.

**LaneManager** (`manager.ts`):
- Fire-and-forget `spawn()`: returns task ID immediately
- Configurable concurrency (default: 6 concurrent)
- Auto-queuing when at capacity
- Per-task timeout with graceful abort
- Post-completion verify commands
- Type-specific defaults (code: 5 turns/5min, learn: 3 turns/5min, research: 5 turns/8min)

```typescript
lanes.spawn({
  type: 'research',
  prompt: 'Summarize the top 5 HN stories',
  workdir: '/path/to/workspace',
});
```

Tasks are executed by a **TaskExecutor** (user-provided). The LaneManager handles lifecycle, output collection, timeout, verify, and event emission.

### Notification (`src/notification/`)

Provider-based notification system.

**NotificationManager** (`manager.ts`): Dispatches to all registered providers.

Built-in providers:
- `ConsoleProvider` — always registered as fallback
- `TelegramProvider` — bot token + chat ID

Interface for custom providers:

```typescript
interface NotificationProvider {
  readonly type: string;
  send(message: string): Promise<void>;
}
```

### Obsidian Integration (`src/obsidian/`)

Optional bi-directional sync with Obsidian vaults.

- **VaultSync**: Generates `.md` pages with frontmatter from JSONL index, syncs topics, creates daily conversation summaries
- **Frontmatter**: Standardized YAML frontmatter with wikilinks
- **Vault Init**: Creates starter structure (templates, daily notes folder)

Edit in Obsidian → agent picks up changes next cycle (through file-based perception).

### Logging (`src/logging/`)

JSONL structured logging.

```typescript
slog('perception', 'Plugin "git-status" completed in 45ms');
// → {"ts":"2026-03-11T...","tag":"perception","msg":"Plugin..."}
```

Configurable categories, file rotation, instance-scoped log directory.

### Config (`src/config/`)

YAML-based configuration with sensible defaults.

**Loader** (`loader.ts`): Reads `asurada.yaml` / `asurada.yml`, merges with defaults.

**Paths** follow XDG convention:
- Config: `~/.config/asurada/`
- Data: `~/.local/share/asurada/{instance}/`
- Or user-specified in YAML

### Setup (`src/setup/`)

First-run experience.

- **Detect** (`detect.ts`): OS, git, Chrome path, available LLMs, Obsidian vault
- **Wizard** (`wizard.ts`): Interactive — name your agent, choose persona, configure notifications
- **Scaffold** (`scaffold.ts`): Creates directory structure + starter SOUL.md
- **First Run** (`first-run.ts`): Agent introduces itself with system snapshot

### Process Management (`src/process/`)

Cross-platform daemon support.

- **Factory** (`factory.ts`): Detects OS → returns appropriate manager
- **Launchd** (`launchd.ts`): macOS — generates plist, KeepAlive
- **PID file** (`pidfile.ts`): Process tracking

### HTTP API (`src/api/`)

Express-based API server.

Endpoints:
- `GET /health` — liveness check
- `GET /status` — aggregated agent status
- `POST /api/message` — send message to agent
- `GET /api/events` — SSE stream for real-time updates

## Extension Points

| What to customize | How |
|---|---|
| **Perception** | Add plugins in `asurada.yaml` — any shell command |
| **LLM** | Implement `CycleRunner` interface |
| **Notifications** | Implement `NotificationProvider` interface |
| **Task execution** | Implement `TaskExecutor` interface |
| **Actions** | Handle custom tags in `onAction` callback |
| **Memory** | Direct access via `agent.memory` / `agent.search` / `agent.index` |

## Design Decisions

**Why shell plugins for perception?**
Language-agnostic, zero-dependency, composable. A `curl` one-liner is a valid plugin. So is a Python script that talks to an API. The framework doesn't care — it just reads stdout.

**Why file-based memory?**
`cat` to read, `git` to version, Obsidian to visualize. No migration scripts, no schema upgrades, no vendor lock-in. FTS5 provides search when you need it, but the source of truth is always Markdown.

**Why EventBus over direct calls?**
Decoupling. The OODA loop doesn't need to know about notifications. Perception doesn't need to know about lanes. New integrations subscribe to events without modifying existing code.

**Why bring-your-own runner?**
The framework shouldn't lock you to a specific LLM provider. Claude CLI, Anthropic API, or your own local model — implement `run(prompt, systemPrompt) → string` and you're done.

## File Structure

```
src/
├── index.ts              # Public API exports
├── runtime.ts            # Bootstrap + Agent factory
├── cli.ts                # CLI entry point
├── core/
│   └── event-bus.ts      # EventBus + reactive primitives
├── config/
│   ├── loader.ts         # YAML config reader
│   ├── defaults.ts       # Default values
│   └── types.ts          # Config type definitions
├── perception/
│   ├── manager.ts        # Stream lifecycle + caching
│   ├── executor.ts       # Single plugin execution
│   └── types.ts
├── loop/
│   ├── agent-loop.ts     # OODA cycle orchestration
│   ├── action-parser.ts  # <tag> extraction from LLM response
│   ├── runners/
│   │   ├── claude-cli.ts # Claude Code CLI runner
│   │   └── anthropic-api.ts  # Direct API runner
│   └── types.ts
├── memory/
│   ├── store.ts          # File-based append-only storage
│   ├── search.ts         # FTS5 full-text search
│   ├── memory-index.ts   # Cognitive graph (JSONL)
│   └── types.ts
├── lanes/
│   ├── manager.ts        # Multi-tentacle task orchestration
│   └── types.ts
├── notification/
│   ├── manager.ts        # Provider dispatch
│   └── providers/
│       ├── console.ts
│       └── telegram.ts
├── obsidian/
│   ├── vault-sync.ts     # Bi-directional Obsidian sync
│   ├── vault-init.ts     # Vault scaffolding
│   └── frontmatter.ts    # Frontmatter generation
├── logging/
│   └── logger.ts         # JSONL structured logging
├── process/
│   ├── factory.ts        # OS-aware process manager
│   ├── launchd.ts        # macOS launchd integration
│   └── pidfile.ts        # PID tracking
├── setup/
│   ├── detect.ts         # Environment detection
│   ├── wizard.ts         # Interactive setup
│   ├── scaffold.ts       # Directory + SOUL.md creation
│   └── first-run.ts      # First-run greeting
├── api/
│   └── server.ts         # HTTP API + SSE
└── ui/                   # Dashboard (if any)
```
