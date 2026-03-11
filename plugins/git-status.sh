#!/bin/bash
# Git Status Perception Plugin — reports workspace git state
#
# Detects: branch, uncommitted changes, unpushed commits, recent activity.
# Works with any git repository.
#
# Output: structured text for agent context

# Check if we're in a git repo
if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  echo "Git: not a repository"
  exit 0
fi

BRANCH=$(git branch --show-current 2>/dev/null || echo "detached")
echo "Branch: ${BRANCH}"

# Uncommitted changes
STAGED=$(git diff --cached --numstat 2>/dev/null | wc -l | tr -d ' ')
UNSTAGED=$(git diff --numstat 2>/dev/null | wc -l | tr -d ' ')
UNTRACKED=$(git ls-files --others --exclude-standard 2>/dev/null | wc -l | tr -d ' ')

if [ "$STAGED" -gt 0 ] || [ "$UNSTAGED" -gt 0 ] || [ "$UNTRACKED" -gt 0 ]; then
  echo "Changes: ${STAGED} staged, ${UNSTAGED} modified, ${UNTRACKED} untracked"
else
  echo "Changes: clean"
fi

# Unpushed commits
UPSTREAM=$(git rev-parse --abbrev-ref "@{upstream}" 2>/dev/null)
if [ -n "$UPSTREAM" ]; then
  UNPUSHED=$(git log "${UPSTREAM}..HEAD" --oneline 2>/dev/null | wc -l | tr -d ' ')
  if [ "$UNPUSHED" -gt 0 ]; then
    echo "Unpushed: ${UNPUSHED} commits"
  fi
fi

# Recent commits (last 3)
RECENT=$(git log --oneline -3 2>/dev/null)
if [ -n "$RECENT" ]; then
  echo ""
  echo "Recent:"
  echo "$RECENT" | sed 's/^/  /'
fi
