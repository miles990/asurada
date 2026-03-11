# Configuration Reference

Asurada uses a single YAML file to define the entire agent. Every section maps directly to a core module.

## File Location

```
./asurada.yaml          # Project root (default)
./config/asurada.yaml   # Config subdirectory
```

Use `npx asurada init` to generate one interactively.

## Full Schema

```yaml
# === Identity (required) ===
agent:
  name: "Kuro"                    # Agent name
  persona: "Curious AI assistant" # One-line persona
  port: 3001                      # HTTP API port

# === OODA Loop ===
loop:
  enabled: true         # Enable autonomous loop (default: true)
  interval: "5m"        # Cycle interval — "30s", "5m", "2h" (default: "5m")
  model: "sonnet"       # LLM model (default: "sonnet")
  runner: "claude-cli"  # Runner type: "claude-cli" | "anthropic-api"

# === Perception Plugins ===
perception:
  categoryIntervals:
    workspace: 60000      # 1 min (default)
    network: 120000       # 2 min (default)
    heartbeat: 1800000    # 30 min (default)
  plugins:
    - name: git-status
      script: "./plugins/git-status.sh"
      category: workspace           # Groups with shared interval
      interval: 30000               # Override category interval (ms)
      outputCap: 4000               # Max output chars (default: 4000)
      enabled: true                 # Toggle on/off

# === Memory ===
memory:
  dir: "./memory"          # Memory directory path
  topics: true             # Topic-scoped memory (default: true)
  search:
    enabled: true          # FTS5 full-text search (default: true)
    maxResults: 5          # Max search results (default: 5)

# === Notification ===
notification:
  providers:
    - type: console                   # Print to stdout
    - type: telegram                  # Telegram Bot
      options:
        botToken: "${TELEGRAM_BOT_TOKEN}"
        chatId: "${TELEGRAM_CHAT_ID}"
      minTier: "signal"              # Only send signal+ tier

# === Multi-Lane Parallelism ===
lanes:
  maxConcurrent: 6         # Max parallel tasks (default: 6)
  maxTimeoutMs: 600000     # Hard cap 10 min (default)
  maxTurnsCap: 10          # Max LLM turns (default: 10)
  outputTailChars: 5000    # Output buffer size (default: 5000)
  typeDefaults:            # Per-type defaults
    code:     { maxTurns: 5, timeoutMs: 300000 }   # 5 min
    learn:    { maxTurns: 3, timeoutMs: 300000 }   # 5 min
    research: { maxTurns: 5, timeoutMs: 480000 }   # 8 min
    create:   { maxTurns: 5, timeoutMs: 480000 }   # 8 min
    review:   { maxTurns: 3, timeoutMs: 180000 }   # 3 min

# === Obsidian Vault ===
obsidian:
  enabled: true                        # Enable vault sync (default: true)
  pagesSubdir: "index-pages"           # Index entry pages
  conversationsSubdir: "conversations" # Conversation summaries
  generateDailySummaries: true         # .md from JSONL logs (default: true)

# === Logging ===
logging:
  dir: "./logs"
  categories:              # Log categories to enable
    - agent
    - api
    - error
    - diag
    - behavior

# === Skills ===
skills:
  - "./skills/github-ops.md"
  - "./skills/delegation.md"

# === Cron Jobs ===
cron:
  - schedule: "*/30 * * * *"
    task: "Check pending tasks and execute if any"
  - schedule: "0 9 * * *"
    task: "Send daily summary"

# === Paths (auto-resolved) ===
paths:
  data: "~/.local/share/asurada"    # XDG default
  memory: "./memory"
  logs: "./logs"
```

## Section Details

### `agent` (required)

The only required section. Everything else has sensible defaults.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | — | **Required.** Your agent's name |
| `persona` | string | — | One-line personality description. Seeds the SOUL.md |
| `port` | number | `3001` | HTTP API port for status, webhooks, and communication |

### `loop`

Controls the autonomous OODA cycle.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Set `false` for manual-trigger-only mode |
| `interval` | string | `"5m"` | Time between cycles. Supports `s`, `m`, `h` suffixes |
| `model` | string | `"sonnet"` | LLM model identifier |
| `runner` | string | auto | `"claude-cli"` or `"anthropic-api"`. Auto-detected from code |

### `perception`

Defines what your agent can see. Each plugin is a shell command that outputs text.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `categoryIntervals` | object | see below | Category-level polling intervals (ms) |
| `plugins` | array | `[]` | Plugin definitions |

**Default category intervals:**

| Category | Interval | Use case |
|----------|----------|----------|
| `workspace` | 60s | Git, files, processes |
| `network` | 120s | HTTP checks, APIs |
| `heartbeat` | 30min | System health, summaries |

**Plugin fields:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | — | **Required.** Unique identifier. Becomes the XML tag name |
| `script` | string | — | **Required.** Shell command or script path |
| `category` | string | `"workspace"` | Category for interval grouping |
| `interval` | number | — | Override interval in ms. `0` = event-driven only |
| `outputCap` | number | `4000` | Max output characters. Truncated with notice |
| `enabled` | boolean | `true` | Toggle without removing the entry |

Plugin output appears in the LLM context as `<name>output here</name>`.

### `memory`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `dir` | string | auto | Memory directory. Auto-resolved from `paths.data` if omitted |
| `topics` | boolean | `true` | Enable topic-scoped memory (`topics/*.md`) |
| `search.enabled` | boolean | `true` | FTS5 full-text search index |
| `search.maxResults` | number | `5` | Max results per search query |

### `notification`

Multiple providers can run simultaneously. Each has a `minTier` filter.

**Provider types:**

| Type | Required options | Description |
|------|-----------------|-------------|
| `console` | — | Print to stdout. Good for development |
| `telegram` | `botToken`, `chatId` | Telegram Bot API |

**Notification tiers** (lowest to highest): `info` → `signal` → `alert`

### `lanes`

Multi-lane parallel delegation. Background tasks run alongside the main OODA cycle.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxConcurrent` | number | `6` | Max parallel background tasks |
| `maxTimeoutMs` | number | `600000` | Hard timeout cap (10 min) |
| `maxTurnsCap` | number | `10` | Max LLM conversation turns |
| `outputTailChars` | number | `5000` | Characters to keep from output tail |
| `typeDefaults` | object | see above | Per-type `maxTurns` and `timeoutMs` |

Built-in task types: `code`, `learn`, `research`, `create`, `review`. You can define custom types in `typeDefaults`.

### `obsidian`

Syncs memory to an Obsidian vault with wikilinks and frontmatter.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable vault sync |
| `pagesSubdir` | string | `"index-pages"` | Directory for index entry pages |
| `conversationsSubdir` | string | `"conversations"` | Directory for conversation summaries |
| `generateDailySummaries` | boolean | `true` | Auto-generate daily .md from JSONL logs |

### `skills`

Array of Markdown file paths. Loaded as system prompt extensions during the OODA cycle.

```yaml
skills:
  - "./skills/github-ops.md"     # Relative to config file
  - "~/shared-skills/writing.md" # Absolute path
```

### `cron`

Scheduled tasks using cron expressions.

```yaml
cron:
  - schedule: "*/30 * * * *"   # Every 30 minutes
    task: "Check HEARTBEAT for pending tasks"
  - schedule: "0 9 * * 1-5"   # Weekdays at 9 AM
    task: "Send daily standup summary"
```

### `paths`

Auto-resolved based on OS conventions. Override if you need custom locations.

| Field | Default (macOS) | Default (Linux) |
|-------|----------------|-----------------|
| `data` | `~/Library/Application Support/asurada` | `~/.local/share/asurada` |
| `memory` | `{data}/memory` | `{data}/memory` |
| `logs` | `{data}/logs` | `{data}/logs` |

## Environment Variables

Environment variables in YAML values are expanded at load time:

```yaml
notification:
  providers:
    - type: telegram
      options:
        botToken: "${TELEGRAM_BOT_TOKEN}"
        chatId: "${TELEGRAM_CHAT_ID}"
```

## Common Configurations

### Minimal (just get started)

```yaml
agent:
  name: "My Agent"
```

Everything else uses defaults: 5-minute cycle, console notifications, no plugins.

### Developer Assistant

```yaml
agent:
  name: "Dev"
  persona: "Watches my codebase, reminds me of TODOs"
  port: 3001

perception:
  plugins:
    - name: git
      script: "git status --porcelain | head -20"
      category: workspace
    - name: todos
      script: "grep -rn 'TODO\\|FIXME' src/ --include='*.ts' | tail -10"
      category: workspace
      interval: 300000

cron:
  - schedule: "0 * * * *"
    task: "Review uncommitted changes and suggest commits"
```

### Research Agent

```yaml
agent:
  name: "Scout"
  persona: "Explores topics in parallel, reports findings"

loop:
  interval: "10m"

lanes:
  maxConcurrent: 6
  typeDefaults:
    research: { maxTurns: 8, timeoutMs: 480000 }

skills:
  - "./skills/web-research.md"

notification:
  providers:
    - type: telegram
      options:
        botToken: "${TELEGRAM_BOT_TOKEN}"
        chatId: "${TELEGRAM_CHAT_ID}"
```

### Quiet Monitor (no autonomous loop)

```yaml
agent:
  name: "Watch"
  persona: "Silent monitor, alerts only when needed"

loop:
  enabled: false

perception:
  plugins:
    - name: disk
      script: "df -h / | tail -1 | awk '{print $5}'"
      category: system
      interval: 300000
    - name: docker
      script: "docker ps --format 'table {{.Names}}\t{{.Status}}' 2>/dev/null"
      category: system

notification:
  providers:
    - type: telegram
      options:
        botToken: "${TELEGRAM_BOT_TOKEN}"
        chatId: "${TELEGRAM_CHAT_ID}"
      minTier: "alert"
```

Trigger cycles manually via `POST /api/loop/trigger` when you want the agent to act.
