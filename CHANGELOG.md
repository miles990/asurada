# Changelog

## 0.1.0 — Initial Release

The perception-driven personal AI agent framework.

### Core Modules
- **EventBus** — Typed event system with wildcard patterns and reactive primitives (debounce, distinctUntilChanged)
- **PerceptionManager** — Plugin-based environment sensing with configurable intervals and deduplication
- **Memory** — File-based storage (Markdown + JSONL) with FTS5 full-text search
- **MemoryIndex** — Relational cognitive graph for cross-referencing memories
- **OODA Loop** — The agent heartbeat: Observe → Orient → Decide → Act
- **Multi-Lane** — Parallel task delegation with organic concurrency (up to 6 background lanes)
- **Config** — Unified YAML configuration with sensible defaults
- **Logging** — JSONL-based observability with structured tags
- **HTTP API** — RESTful endpoints for status, messaging, and perception data

### Integrations
- **Claude CLI Runner** — Zero-dependency LLM integration via Claude CLI
- **Anthropic API Runner** — Direct API integration with streaming support
- **Telegram** — Notification provider for agent-to-human communication
- **Obsidian** — Transparent memory visualization in your existing vault

### Developer Experience
- **CLI** — `asurada init/start/stop/status/logs` for full lifecycle management
- **Setup Wizard** — Interactive first-run configuration (LLM, notifications, memory space)
- **First-Run Greeting** — Agent introduces itself on first start
- **Environment Detection** — Auto-discovers available tools and capabilities

### Documentation
- Architecture overview with module map and data flow
- Perception plugin development guide
- Configuration reference with full YAML schema
- HTTP API reference
- Three working examples (minimal, with-perception, personality-configs)
