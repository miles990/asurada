# Memory

This directory is your agent's memory space. It is created and populated by `asurada init`.

## Structure

| Path | Purpose |
|------|---------|
| `SOUL.md` | Agent identity (name, persona, traits, limits) |
| `MEMORY.md` | Long-term memory entries |
| `memory-index.jsonl` | Structured memory index |
| `topics/` | Scoped knowledge by topic keyword |
| `conversations/` | Conversation logs (JSONL) |
| `daily/` | Daily snapshots |
| `.obsidian/` | Obsidian vault config (for visual knowledge graph) |

All personal data in this directory is gitignored. Only framework templates are tracked.
