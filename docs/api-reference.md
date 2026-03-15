# API Reference

Asurada exposes a lightweight HTTP API for observing and interacting with your agent.

## Server Setup

The API server starts automatically with `agent.start()` if configured, or manually:

```typescript
import { startServer } from 'asurada';

const server = await startServer(agent, {
  port: 3000,           // default: PORT env or 3000
  apiKey: 'secret',     // optional — protects all routes except /health
  corsOrigin: '*',      // default: *
});
```

## Authentication

If `apiKey` is set (or `ASURADA_API_KEY` env var exists), all routes except `/health` require authentication:

```bash
# Bearer token
curl -H "Authorization: Bearer <key>" http://localhost:3000/status

# Query parameter
curl http://localhost:3000/status?key=<key>
```

## Endpoints

### `GET /health`

Health check. Always accessible (no auth required).

**Response:**

```json
{
  "status": "ok",
  "uptime": 123456,
  "version": "0.1.0"
}
```

---

### `GET /status`

Agent status — loop state, lane stats, perception info.

**Response:**

```json
{
  "agent": {
    "name": "my-agent",
    "instanceId": "abc123",
    "running": true,
    "uptime": 123456
  },
  "loop": {
    "running": true,
    "cycles": 42
  },
  "lanes": {
    "running": 2,
    "queued": 0,
    "completed": 15
  },
  "perception": {
    "plugins": 5,
    "lastRun": null
  }
}
```

`loop` is `null` if the OODA loop hasn't been started.

---

### `GET /context`

All perception data, formatted as XML sections (same format the OODA loop sees).

**Response:**

```json
{
  "context": "<system-monitor>\ncpu: 12%\nmemory: 4.2GB\n</system-monitor>\n\n<git-status>\nbranch: main\nclean\n</git-status>"
}
```

Useful for debugging what your agent can "see".

---

### `GET /api/events`

Server-Sent Events (SSE) stream. Receives all events from the agent's EventBus in real-time.

```bash
curl -N http://localhost:3000/api/events
```

**Event format:**

```
data: {"type":"trigger:message","data":{"message":{"id":"2026-03-11-001","from":"user","text":"hello"}}}

data: {"type":"action:loop","data":{"cycle":43}}
```

Sends a `: heartbeat` comment every 30 seconds to keep the connection alive.

---

### `POST /api/message`

Send a message to the agent. Triggers a `trigger:message` event that the OODA loop picks up.

**Request:**

```json
{
  "from": "user",
  "text": "What's the current system status?",
  "replyTo": "2026-03-11-001"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `from` | string | yes | Sender identifier |
| `text` | string | yes | Message content |
| `replyTo` | string | no | Message ID to reply to (threading) |

Mentions are auto-extracted from `@name` patterns in the text.

**Response** (`201`):

```json
{
  "id": "2026-03-11-002",
  "timestamp": "2026-03-11T06:30:00.000Z"
}
```

---

### `GET /api/messages`

Recent messages (from `messages.jsonl`).

**Query parameters:**

| Param | Default | Description |
|-------|---------|-------------|
| `limit` | 50 | Max messages to return |

**Response:**

```json
{
  "messages": [
    {
      "id": "2026-03-11-001",
      "from": "user",
      "text": "hello @agent",
      "mentions": ["agent"],
      "timestamp": "2026-03-11T06:00:00.000Z"
    }
  ]
}
```

---

### `GET /api/tasks`

List all active tasks (excludes soft-deleted).

**Response:**

```json
{
  "tasks": [
    {
      "id": "task-abc123",
      "title": "Investigate login timeout",
      "status": "doing",
      "assignee": "agent",
      "labels": ["bug"],
      "verify": "curl -s localhost:3000/health | jq .status",
      "createdAt": "2026-03-15T02:00:00.000Z",
      "updatedAt": "2026-03-15T02:30:00.000Z"
    }
  ]
}
```

---

### `POST /api/tasks`

Create a new task.

**Request:**

```json
{
  "title": "Fix memory leak in perception loop",
  "assignee": "agent",
  "labels": ["bug", "perception"],
  "verify": "pnpm test",
  "by": "user"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | yes | Task description |
| `assignee` | string | no | Who should work on it |
| `labels` | string[] | no | Categorization tags |
| `verify` | string | no | Shell command to verify completion |
| `messageRef` | string | no | Related message ID |
| `by` | string | no | Creator identifier (default: `"unknown"`) |

**Response** (`201`):

```json
{
  "task": { "id": "task-def456", "title": "Fix memory leak in perception loop", "status": "todo", ... }
}
```

---

### `PATCH /api/tasks/:id`

Update a task's status, title, assignee, or labels.

**Request:**

```json
{
  "status": "done",
  "by": "agent"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | One of: `todo`, `doing`, `done`, `abandoned` |
| `assignee` | string | Reassign the task |
| `labels` | string[] | Replace labels |
| `title` | string | Update title |
| `by` | string | Who made the change |

**Response:** `{ "task": { ... } }` or `404` if not found.

---

### `DELETE /api/tasks/:id`

Soft-delete a task (excluded from `GET /api/tasks` but preserved in storage).

**Response:** `{ "ok": true }` or `404` if not found.

---

## Extending the Server

The `AgentServer` object exposes the Express app for custom routes:

```typescript
const server = await startServer(agent, { port: 3000 });

// Add custom routes
server.app.get('/api/custom', (req, res) => {
  res.json({ custom: 'data' });
});
```

## Storage

Messages are stored in `{dataDir}/messages.jsonl` — one JSON object per line, append-only. Human-readable, `grep`-able, `git`-trackable.
