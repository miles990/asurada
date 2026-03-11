#!/bin/bash
# Chrome CDP Perception Plugin — reports browser state via Chrome DevTools Protocol.
#
# Requires Chrome running with --remote-debugging-port=9222
# Detects: CDP availability, active tab count, current URL, page title
#
# Output: structured text for agent context

CDP_PORT="${CDP_PORT:-9222}"
CDP_HOST="${CDP_HOST:-localhost}"
CDP_URL="http://${CDP_HOST}:${CDP_PORT}"

# Quick health check
VERSION=$(curl -sf --connect-timeout 2 "${CDP_URL}/json/version" 2>/dev/null)
if [ $? -ne 0 ] || [ -z "$VERSION" ]; then
  echo "CDP: offline (port ${CDP_PORT})"
  exit 0
fi

BROWSER=$(echo "$VERSION" | grep -o '"Browser":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "CDP: online (${BROWSER:-Chrome})"

# Get open tabs
TABS=$(curl -sf --connect-timeout 2 "${CDP_URL}/json/list" 2>/dev/null)
if [ -z "$TABS" ]; then
  echo "Tabs: unavailable"
  exit 0
fi

TAB_COUNT=$(echo "$TABS" | grep -c '"type":"page"')
echo "Tabs: ${TAB_COUNT} open"

# Show active tab info (first page type)
ACTIVE_URL=$(echo "$TABS" | grep -A5 '"type":"page"' | grep '"url"' | head -1 | sed 's/.*"url":"\([^"]*\)".*/\1/')
ACTIVE_TITLE=$(echo "$TABS" | grep -A5 '"type":"page"' | grep '"title"' | head -1 | sed 's/.*"title":"\([^"]*\)".*/\1/')

if [ -n "$ACTIVE_URL" ]; then
  echo "Active: ${ACTIVE_TITLE:-Untitled}"
  echo "URL: ${ACTIVE_URL}"
fi
