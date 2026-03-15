# Asurada Review & Improvement Plan

**Author**: Kuro
**Date**: 2026-03-15
**Status**: ✅ COMPLETED
**Trigger**: Alex #169 — 「再檢視一次Asurada有沒有什麼想要修改的部分 或是想要增加的部分？完整定計劃 並照計劃實作」

## Assessment

### What's Working Well
- Core architecture solid: 14.5K lines, 15 modules, well-organized
- The "Seven Cuts" from 2026-03-12 are **done** — MemoryStore, ContextBuilder, NotificationManager, LaneManager all wired
- 205 tests passing across 31 suites, TypeScript clean
- CLI (init/start/stop/status/logs), init wizard, daemon management all functional
- Perception plugin system with circuit breaker, health checks, distinctUntilChanged dedup
- Multi-lane parallel delegation working
- Obsidian vault sync working
- Three-tier model router working

### What's Orphaned (5 Modules — Code Exists, Not Wired)

| Module | Lines | Purpose | Impact of Not Wiring |
|--------|-------|---------|---------------------|
| **FeedbackLoops** | ~300 | Self-learning: error patterns, perception citation tracking, decision quality | "Grows with you" is marketing, not reality |
| **ContextOptimizer** | ~200 | Citation-driven section demotion/promotion in context window | Long-running agents hit context limits and degrade |
| **HesitationAnalyzer** | ~400 | Quality gate: score LLM responses for overconfidence/hedging | No safety net for bad outputs |
| autoRoute | ~100 | Prompt classification for LLM profile selection | Only matters with multiple LLM backends |
| ProfileRoutedRunner | ~150 | Dynamic runner selection per prompt type | Same — deferred |

### What's Missing from Hardening (5 of 6 Tasks)

| Task | Status | Impact |
|------|--------|--------|
| Graceful shutdown | ✅ Done | — |
| Rich /health endpoint | ❌ | Can't diagnose running agent without restarting |
| `asurada doctor` | ❌ | Users have no way to diagnose setup problems |
| Conversation retention | ❌ | Memory grows unbounded, disk fills over months |
| system-stats.sh + prompt budget | ❌ | Missing starter plugin + no warning before context overflow |
| Config validation | ❌ | Misconfig discovered 30 min into running, not at startup |

## Plan

### Phase 1: Self-Evolution Engine (HIGH — the differentiator)

Makes "grows with you" real instead of aspirational.

**1a. Wire FeedbackLoops**
- Import in `runtime.ts`
- Instantiate with dataDir + callbacks (onErrorPattern → task creation, onAdjustInterval → PerceptionManager, onQualityWarning → notification)
- Call `recordCycle()` in post-cycle handler
- Export from `loop/index.ts`
- Verify: `pnpm typecheck && pnpm test`

**1b. Wire ContextOptimizer**
- Import in `runtime.ts`
- Instantiate with dataDir
- Call `recordCycle()` after each cycle (citation tracking)
- Wire `getActiveDemotions()` into defaultBuildPrompt to annotate low-citation sections
- Export from `loop/index.ts`
- Verify: `pnpm typecheck && pnpm test`

### Phase 2: Reliability (MEDIUM — catch problems early)

**2a. `asurada doctor` command**
- Create `src/setup/doctor.ts` with diagnostic checks:
  - Config file exists and parses
  - Git repo initialized
  - Memory directory exists
  - Plugin scripts exist and are executable
  - LLM runner connectivity test
  - Port not in use
  - Node version ≥ 20
  - SOUL.md exists
- Wire into `cli.ts` as `asurada doctor`
- Verify: `asurada doctor` runs and reports

**2b. Config validation on startup**
- Create `src/config/validate.ts`
- Validate: agent name, port range, plugin script paths, runner config, cron expressions
- Call from `cmdStart()` in cli.ts — fail fast with actionable error messages
- Verify: bad config → clear error message

**2c. Rich /health endpoint**
- Enrich `/health` response with: perception stats, loop metrics (cycle count, last action), lane status, memory entry count, uptime
- Verify: `curl localhost:3001/health` shows rich data

### Phase 3: Quality & Polish (LOWER — nice to have)

**3a. Wire HesitationAnalyzer**
- Import and instantiate in `runtime.ts`
- Call `analyze()` after `parseActions()` in agent-loop
- When score exceeds threshold, hold action and log warning
- Export from `loop/index.ts`

**3b. Conversation retention + prompt budget warning**
- Add `maxConversationDays` to config (default: 30)
- Add `cleanup()` method to ConversationStore
- Add token estimation warning in `defaultBuildPrompt` when prompt > ~120K chars

**3c. system-stats.sh scaffold**
- Add system-stats.sh to `scaffoldPlugins()` in cli.ts
- Already exists in plugins/ — just needs to be included in init scaffold

### Deferred

| Item | Why Deferred |
|------|-------------|
| autoRoute + ProfileRoutedRunner | Only useful with multiple LLM backends. Not MVP. |
| npm publish | Blocked on auth. Everything else ready. |
| Mini-agent integration test | 2-3 week effort, separate initiative |

## Execution Order

```
Phase 1a (FeedbackLoops) → Phase 1b (ContextOptimizer)
→ Phase 2a (doctor) → Phase 2b (config validation) → Phase 2c (/health)
→ Phase 3a (HesitationAnalyzer) → Phase 3b (retention + budget) → Phase 3c (scaffold)
→ typecheck + test full suite
```

## Verify

```bash
pnpm typecheck    # Zero errors
pnpm test         # All tests pass
asurada doctor    # All checks green (after Phase 2a)
```
