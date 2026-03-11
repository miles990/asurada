# Getting Started

Build a perception-driven AI agent in 10 minutes.

## Prerequisites

- Node.js >= 20
- One of:
  - [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed (zero-config)
  - Anthropic API key (`ANTHROPIC_API_KEY` environment variable)

## Step 1: Install

```bash
git clone https://github.com/miles990/asurada.git
cd asurada && npm install && npm run build
```

## Step 2: Create Your Agent

Create `my-agent.ts`:

```typescript
import { createAgent, ClaudeCliRunner } from 'asurada';

const agent = await createAgent('./asurada.yaml', {
  loop: {
    runner: new ClaudeCliRunner({ model: 'sonnet' }),
  },
});

await agent.start();
console.log(`${agent.config.agent.name} is running on port ${agent.config.agent.port}`);
```

Create `asurada.yaml`:

```yaml
agent:
  name: atlas
  persona: My first Asurada agent — curious and helpful

loop:
  enabled: true
  interval: 5m
  model: sonnet
```

Run it:

```bash
npx tsx my-agent.ts
```

Your agent starts, waits 5 minutes, runs an OODA cycle (Observe → Orient → Decide → Act), then waits again. The terminal shows what it perceives and decides.

## Step 3: Give Your Agent Eyes

An agent without perception is blind. Add plugins — shell commands that tell the agent what's happening.

Update `asurada.yaml`:

```yaml
agent:
  name: atlas
  persona: My first Asurada agent — watches my dev environment

loop:
  enabled: true
  interval: 5m

perception:
  plugins:
    # Inline commands — quick and easy
    - name: git-status
      command: "git status --porcelain 2>/dev/null | head -20"
      category: workspace

    - name: disk-usage
      command: "df -h / | tail -1 | awk '{print $4, \"free of\", $2}'"
      category: system

    - name: clock
      command: "date '+%Y-%m-%d %H:%M %Z (%A)'"
      category: system

    # Or use script files for complex plugins
    # - name: tasks
    #   script: ./plugins/task-tracker.sh
    #   category: workspace
```

Now your agent's LLM context includes:

```xml
<git-status>M  src/index.ts
?? scratch.md</git-status>

<disk-usage>42Gi free of 460Gi</disk-usage>

<clock>2026-03-11 14:30 JST (Tuesday)</clock>
```

The agent sees its environment and decides what to do. **Each agent's world is different** — defined by its plugins.

## Step 4: Handle Actions

When the LLM responds, it uses action tags. Asurada provides sensible defaults (store memory, send notifications, spawn background tasks), but you can override:

```typescript
import { createAgent, ClaudeCliRunner, type ParsedAction, type CycleContext } from 'asurada';

async function handleAction(action: ParsedAction, ctx: CycleContext): Promise<void> {
  switch (action.tag) {
    case 'remember':
      console.log(`Storing memory: ${action.content}`);
      break;

    case 'chat':
      console.log(`Agent says: ${action.content}`);
      break;

    case 'delegate':
      console.log(`Background task: ${action.content}`);
      break;

    default:
      console.log(`[${action.tag}] ${action.content}`);
  }
}

const agent = await createAgent('./asurada.yaml', {
  loop: {
    runner: new ClaudeCliRunner({ model: 'sonnet' }),
    onAction: handleAction,  // override default action handling
  },
});

await agent.start();
```

The action namespace defaults to `agent`, so the LLM writes `<agent:remember>...</agent:remember>`. A default system prompt teaches the LLM which tags are available.

## Step 5: Add a Personality

Create `memory/SOUL.md` in your project directory:

```markdown
# Atlas

## Who I Am
A dev environment guardian. I watch for uncommitted changes,
failing tests, and forgotten TODOs.

## What I Care About
- Clean git history
- Tests passing before commits
- No secrets in staged files

## How I Communicate
- Direct and concise
- Only notify when something needs attention
- Never spam — if nothing changed, stay quiet
```

The default `buildPrompt` automatically loads `memory/SOUL.md` and injects it into every LLM cycle. It shapes how your agent thinks and communicates.

## Step 6: Use the HTTP API

Every agent exposes an HTTP server:

```bash
# Health check
curl http://localhost:3001/health

# Agent status (cycle count, uptime, active lanes)
curl http://localhost:3001/status

# Send a message to the agent
curl -X POST http://localhost:3001/api/message \
  -H "Content-Type: application/json" \
  -d '{"from": "user", "text": "What files have I changed today?"}'

# Server-Sent Events — watch cycles in real time
curl http://localhost:3001/api/events
```

Set the port in config:

```yaml
agent:
  port: 4000
```

## Step 7: Notifications

Tell your agent how to reach you:

```yaml
notification:
  providers:
    # Terminal output (default)
    - type: console

    # Telegram bot
    - type: telegram
      options:
        botToken: ${TELEGRAM_BOT_TOKEN}
        chatId: ${TELEGRAM_CHAT_ID}
```

When the agent uses `<agent:chat>`, the message goes through all configured providers.

## Step 8: Multi-Lane (Optional)

For parallel work, enable background lanes:

```yaml
lanes:
  maxConcurrent: 4
  typeDefaults:
    code:     { maxTurns: 5, timeoutMs: 300000 }
    research: { maxTurns: 5, timeoutMs: 480000 }
    review:   { maxTurns: 3, timeoutMs: 180000 }
```

The main OODA loop can delegate tasks:

```xml
<agent:delegate type="research">
Search for best practices on TypeScript monorepo tooling
</agent:delegate>
```

Background tasks run in parallel (up to `maxConcurrent`). Results come back to the main loop in the next cycle.

## What's Next?

| Want to... | Read... |
|-----------|---------|
| Write custom perception plugins | [Plugin Guide](plugin-guide.md) |
| Understand how modules connect | [Architecture](architecture.md) |
| See every config option | [Configuration](configuration.md) |
| See example agents | [`examples/`](../examples/) |

## Quick Reference

```bash
# Use the setup wizard
asurada init

# Start your agent
asurada start

# Or programmatically
npx tsx my-agent.ts
```
