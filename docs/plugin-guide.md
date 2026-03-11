# Writing Perception Plugins

A perception plugin is any executable that outputs text to stdout. That text becomes part of your agent's context — what it "sees" each cycle.

```
Shell Script → stdout → <plugin-name>output</plugin-name> → LLM context
```

Your agent's world is defined by its plugins. No plugins = blind agent.

## Quick Start

### 1. Write a script

```bash
#!/bin/bash
# plugins/weather.sh
curl -s 'wttr.in/?format=3' 2>/dev/null || echo "Weather unavailable"
```

```bash
chmod +x plugins/weather.sh
```

### 2. Register in asurada.yaml

```yaml
perception:
  plugins:
    - name: weather
      script: ./plugins/weather.sh
      category: environment
      interval: 300000   # 5 minutes
```

### 3. Your agent sees it

Each cycle, the LLM receives:

```xml
<weather>Taipei: ☀️ +28°C</weather>
```

The agent can now react to weather changes — no explicit programming needed.

## Plugin Anatomy

A plugin is defined by these fields:

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `name` | yes | — | Unique identifier. Becomes the XML tag name in context |
| `script` | yes | — | Shell command or path to executable |
| `category` | no | `"default"` | Groups plugins for shared interval defaults |
| `interval` | no | 60000 | Polling interval in ms. `0` = event-driven only |
| `timeout` | no | 10000 | Max execution time in ms |
| `enabled` | no | `true` | Set `false` to disable without removing |
| `outputCap` | no | 4000 | Max output chars before truncation |

### Interval Resolution

The system resolves intervals in this order:

1. Plugin-level `interval` (highest priority)
2. Category-level default from `categoryIntervals`
3. Global `defaultInterval`
4. Hardcoded 60s

```yaml
perception:
  defaultInterval: 60000
  categoryIntervals:
    workspace: 30000      # Fast: code changes matter quickly
    network: 120000       # Slow: external services don't change often
    heartbeat: 1800000    # Very slow: strategic-level data
  plugins:
    - name: git
      script: ./plugins/git-status.sh
      category: workspace           # → 30s (from categoryIntervals)
    - name: api-health
      script: ./plugins/api-health.sh
      category: network
      interval: 10000               # → 10s (plugin override wins)
```

## Real-World Examples

### Workspace Awareness

```bash
#!/bin/bash
# plugins/git-status.sh — What changed in the repo?
echo "Branch: $(git branch --show-current 2>/dev/null || echo 'N/A')"
CHANGES=$(git status --short 2>/dev/null | head -20)
if [ -n "$CHANGES" ]; then
  echo "Changes:"
  echo "$CHANGES"
else
  echo "Clean working tree"
fi
```

### System Health

```bash
#!/bin/bash
# plugins/system-health.sh — Is the machine OK?
echo "Load: $(uptime | awk -F'averages:' '{print $2}')"
echo "Disk: $(df -h / | awk 'NR==2 {print $5 " used (" $4 " free)"}')"
echo "Memory: $(vm_stat | awk '/Pages free/ {free=$3} /Pages active/ {active=$3} END {printf "%.0f%% used", (active/(free+active))*100}')"
```

### Task Tracking

```bash
#!/bin/bash
# plugins/task-tracker.sh — What needs doing?
TASKS_FILE="${ASURADA_MEMORY_DIR:-./memory}/TASKS.md"
if [ -f "$TASKS_FILE" ]; then
  # Show uncompleted tasks
  grep '^\- \[ \]' "$TASKS_FILE" | head -10
else
  echo "No task file found"
fi
```

### Web Monitoring

```bash
#!/bin/bash
# plugins/site-monitor.sh — Is my site up?
STATUS=$(curl -so /dev/null -w '%{http_code}' --max-time 5 "https://mysite.com" 2>/dev/null)
if [ "$STATUS" = "200" ]; then
  echo "Site: UP ($STATUS)"
else
  echo "Site: DOWN ($STATUS) ⚠️"
fi
```

### Docker Services

```bash
#!/bin/bash
# plugins/docker-status.sh — What containers are running?
docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null || echo "Docker not available"
```

### Inbox / Notifications

```bash
#!/bin/bash
# plugins/inbox.sh — Messages waiting for the agent
INBOX="./inbox.md"
if [ -s "$INBOX" ]; then
  cat "$INBOX"
else
  echo "(empty)"
fi
```

## Advanced Patterns

### Change Detection (distinctUntilChanged)

The perception manager automatically deduplicates output. If a plugin returns the same text twice in a row, the second result doesn't increment the version counter or trigger a new cycle.

This means:
- Your scripts don't need to track previous state
- Noisy plugins (like `git status` on a quiet repo) won't waste LLM cycles
- Only *actual changes* drive agent behavior

### Circuit Breaker

If a plugin times out 3 consecutive times, the manager automatically doubles its interval. This prevents a broken plugin from burning resources.

After the plugin succeeds again, the interval is restored to default.

### Health Check & Auto-Restart

Every 5 minutes, the manager checks for stale plugins (no update in 5× their interval). Stale plugins are automatically restarted, up to 3 times.

This makes the system self-healing — a plugin that crashes at 3 AM recovers without intervention.

### Event-Driven Plugins

Set `interval: 0` for plugins that should only run when triggered explicitly:

```yaml
plugins:
  - name: screenshot
    script: ./plugins/take-screenshot.sh
    interval: 0   # Only runs when triggered
```

Trigger from code:

```typescript
agent.perception.trigger('screenshot');
```

### Output Cap

Large outputs waste context tokens. Use `outputCap` to limit:

```yaml
plugins:
  - name: logs
    script: "tail -100 /var/log/app.log"
    outputCap: 2000    # Keep it concise
```

Output beyond the cap is truncated with `[... truncated]`.

## Design Principles

1. **Fast** — Plugins should complete in <5s. The agent waits for nobody.

2. **Concise** — Output what matters. 3 lines > 300 lines. The LLM's context window is finite.

3. **Fail-safe** — Always produce *something*. Use `|| echo "unavailable"` so a network failure doesn't leave a gap in perception.

4. **Stateless** — Don't track state in the script. The manager handles change detection. Your script just reports current reality.

5. **Any language** — Bash, Python, Go binary, Node script — anything executable works. Just make sure it's `chmod +x`.

## Categories as Umwelt

Categories aren't just for grouping intervals — they define your agent's *Umwelt* (perceptual world).

| Category | Purpose | Typical Interval |
|----------|---------|-----------------|
| `workspace` | Code changes, file system | 30-60s |
| `system` | CPU, memory, disk, processes | 60-120s |
| `network` | External services, APIs | 120-300s |
| `social` | Messages, notifications, feeds | 60-120s |
| `environment` | Weather, location, time-of-day | 300-1800s |
| `heartbeat` | Strategic data, goals, schedules | 1800s+ |

A coding agent needs `workspace` + `system`. A social agent needs `social` + `network`. A home assistant needs `environment` + `system`. The plugins you choose define what kind of agent yours becomes.

## Debugging

Check plugin health via the API:

```bash
curl -s http://localhost:3001/api/perception/stats | jq .
```

Each plugin reports: `runCount`, `avgMs`, `timeouts`, `restarts`, `healthy`.

If a plugin shows `healthy: false`, check:
- Script exists and is executable (`chmod +x`)
- Script completes within timeout
- Script doesn't require interactive input
- Dependencies are available (curl, docker, etc.)

## Next Steps

- Browse [examples/with-perception.ts](../examples/with-perception.ts) for a working setup
- See the default [asurada.yaml](../asurada.yaml) for configuration reference
- Check the [PerceptionManager source](../src/perception/manager.ts) for implementation details
