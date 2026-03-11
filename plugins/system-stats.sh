#!/bin/bash
# System Stats Perception Plugin — reports basic system metrics
#
# Reports: uptime, load average, memory, disk usage.
# Cross-platform: macOS and Linux.
#
# Output: structured text for agent context

# Uptime
if command -v uptime &>/dev/null; then
  LOAD=$(uptime | sed 's/.*load average[s]*: /Load: /')
  echo "$LOAD"
fi

# Memory
if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS
  MEM_TOTAL=$(sysctl -n hw.memsize 2>/dev/null)
  if [ -n "$MEM_TOTAL" ]; then
    MEM_GB=$((MEM_TOTAL / 1073741824))
    # Get memory pressure
    PRESSURE=$(memory_pressure 2>/dev/null | grep "System-wide" | head -1 | sed 's/.*: //')
    echo "Memory: ${MEM_GB}GB total${PRESSURE:+, pressure: ${PRESSURE}}"
  fi
else
  # Linux
  if [ -f /proc/meminfo ]; then
    MEM_TOTAL=$(awk '/MemTotal/ {printf "%.0f", $2/1024/1024}' /proc/meminfo)
    MEM_AVAIL=$(awk '/MemAvailable/ {printf "%.0f", $2/1024/1024}' /proc/meminfo)
    echo "Memory: ${MEM_AVAIL}GB free / ${MEM_TOTAL}GB total"
  fi
fi

# Disk usage (root partition)
DISK=$(df -h / 2>/dev/null | tail -1 | awk '{print "Disk: " $3 " used / " $2 " total (" $5 " full)"}')
if [ -n "$DISK" ]; then
  echo "$DISK"
fi
