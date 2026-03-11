#!/bin/bash
# Task Tracker Perception Plugin — reports pending tasks from HEARTBEAT.md
#
# Scans HEARTBEAT.md (or configurable file) for markdown task items.
# Reports counts and lists incomplete tasks.
#
# Output: structured text for agent context

HEARTBEAT="${ASURADA_HEARTBEAT:-memory/HEARTBEAT.md}"

if [ ! -f "$HEARTBEAT" ]; then
  echo "No task file found (${HEARTBEAT})"
  exit 0
fi

# Count tasks
TOTAL=$(grep -c '^\s*- \[' "$HEARTBEAT" 2>/dev/null || echo 0)
DONE=$(grep -c '^\s*- \[x\]' "$HEARTBEAT" 2>/dev/null || echo 0)
PENDING=$((TOTAL - DONE))

echo "Tasks: ${PENDING} pending, ${DONE} done (${TOTAL} total)"

# List pending tasks (max 10)
if [ "$PENDING" -gt 0 ]; then
  echo ""
  echo "Pending:"
  grep '^\s*- \[ \]' "$HEARTBEAT" | head -10 | sed 's/^\s*- \[ \] /  - /'
  if [ "$PENDING" -gt 10 ]; then
    echo "  ... and $((PENDING - 10)) more"
  fi
fi
