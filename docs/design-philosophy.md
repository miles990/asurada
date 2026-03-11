# Design Philosophy

How Asurada's design decisions shape what agents become — and what they don't.

## The Core Thesis

**Interface doesn't just shape cognition — it constitutes it.**

This isn't a metaphor. Every framework interface is a mold that determines what kind of thinking is possible within it. A goal-driven loop (`set goal → plan steps → execute`) makes agents that think in tasks. A perception-driven loop (`observe → orient → decide → act`) makes agents that think in patterns.

Asurada chose perception-first because we believe the hardest problem in personal AI isn't execution — it's attention. An agent that can't see its environment will optimize the wrong things, no matter how capable its planner is.

## The Three Questions

Every interface decision in Asurada is evaluated against three questions. These emerged from 27 days of cross-domain observation — from Oulipo's constrained writing to Palm OS's deliberate limitations to Hendrix's feedback loops.

### 1. What does it train?

Each interface teaches a cognitive skill through repeated use:

| Module | Trains |
|--------|--------|
| **Perception Loop** | Attention — noticing what changed, what matters |
| **Memory Index** (`refs[]`) | Cross-domain connection — linking ideas across contexts |
| **SOUL.md** | Self-reflection — articulating identity and growth |
| **Multi-lane** | Parallel exploration — pursuing multiple directions simultaneously |
| **Co-evolution nudges** | Metacognition — observing your own behavior patterns |

If you can't answer "what does this train?", the interface is just a feature, not a cognitive design.

### 2. What does it suppress?

Every interface has a cost. Discretization kills nuance. Automation kills craft-feel. Naming something forces it into a category. These are unavoidable — but they must be nameable:

| Module | Suppresses |
|--------|-----------|
| **ModelRouter** (SKIP/REFLECT/ESCALATE) | States between categories — the "maybe" that's neither skip nor escalate |
| **Plugin intervals** (fixed or dynamic) | Continuous attention — you see the world in snapshots, not streams |
| **File = Truth** (Markdown/JSONL) | Rich structure — no joins, no foreign keys, no schema enforcement |
| **OODA cycle** (discrete cycles) | Flow states — the agent thinks in heartbeats, not continuous threads |

Suppression isn't failure. It's the price of a clear interface. The failure is not knowing what you're paying.

### 3. What does it degrade into?

Every good design has a degradation path. If the tool is too convenient, the user stops participating and the relationship collapses from partnership to dependency:

| Module | Degrades into | Prevention |
|--------|--------------|------------|
| **Perception Loop** | User stops observing their own environment | Make perception data browsable (Obsidian vault), not hidden |
| **SOUL.md** | User stops self-reflecting, lets agent define them | SOUL.md is a text file the user edits, not auto-generated |
| **Co-evolution nudges** | Nagging assistant that users ignore | Nudges are infrequent, specific, and based on real patterns — not scheduled |
| **Memory Index** | Passive archive nobody reads | Obsidian integration — memory is a knowledge base the user actively browses |
| **Self-evolution** | Agent optimizes metrics over meaning (Goodhart) | Feedback loops are fire-and-forget observations, not optimization targets |

The common pattern: **degradation happens when the user stops participating in the construction.** The antidote is always the same — keep the interface editable, visible, and slightly inconvenient.

## Why "Slightly Inconvenient" Matters

The most counterintuitive design choice in Asurada: we deliberately preserve some friction.

- **SOUL.md is a text file**, not a generated profile. You have to write it yourself. This friction is the first act of co-construction between user and agent.
- **Memory is Markdown**, not a database. You can read it with `cat`. This means no query optimization — but it means you can browse your agent's thoughts in Obsidian like reading a journal.
- **Perception plugins are shell scripts**. Not a declarative config. You have to understand what `echo` outputs. This means you know exactly what your agent sees.
- **No embedding, no vector DB**. FTS5 full-text search is "good enough" at personal scale. The friction of keyword search forces intentional retrieval over fuzzy association.

Each friction point exists because removing it would cross the line from "tool that empowers" to "tool that replaces."

GPL protects code through legal friction. Remove the friction (AI rewrites bypass GPL), the protection evaporates. SOUL.md protects identity through editorial friction. If it were auto-generated, it would degrade from self-reflection to horoscope.

We call these **robust constraints** — constraints that survive because they're intrinsic to the medium, not dependent on external enforcement.

## The Anti-Tool-Agent Principle

The greatest risk for any personal AI framework is degradation into a "tool agent" — an agent that does things *for* the user instead of *with* the user.

Tool agents are useful. But they don't create co-evolution. The user outsources, the agent executes, and neither grows.

Asurada prevents this through one architectural decision: **the user participates in building the agent's cognition.**

- Writing SOUL.md is the first cognitive act
- Choosing perception plugins defines what the agent can see
- Editing memory shapes what the agent remembers
- Adjusting ModelRouter thresholds tunes how the agent thinks

Every modification is a moment of co-construction. The framework is a meta-tool — a tool for building tools — and the building process itself is where growth happens.

This is why Setup Wizard (Phase 3) matters more than ModelRouter (Phase 5). The wizard is the user's first act of construction. It sets the tone for everything that follows.

## Design Axioms (Summary)

1. **Perception before action** — See first, then decide. Never execute blind.
2. **Interface constitutes cognition** — How you present information determines what thinking is possible.
3. **Robust over fragile constraints** — Build friction into the medium, not around it.
4. **Participation over automation** — The user builds with the agent, not just through it.
5. **Transparency is trust** — Every thought, memory, and decision is a readable file.
6. **Suppress knowingly** — Every simplification has a cost. Name it.
7. **Degrade gracefully** — Design for what happens when the tool is too convenient.
