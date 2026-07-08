#!/usr/bin/env bash
# Self-healing wrapper: auto-restart ioc-loop on CRASH (RPC ECONNRESET/ENOTFOUND
# => non-zero exit), but STOP on clean exit (code 0 = gas-abort or maxCycles,
# which needs a refuel, not a restart). Retries every 8s while RPC is flapping.
# Usage: NETWORK=mainnet bash scripts/run-loop.sh <pool> <qty> <buyLimit> <sellLimit> <cycleMs> <maxCycles> <floor> <ceiling>
set -u
ARGS="$*"
n=0
while true; do
  n=$((n+1))
  echo "=== run-loop attempt #$n: ioc-loop $ARGS ==="
  npx tsx scripts/ioc-loop.ts $ARGS
  code=$?
  echo "=== ioc-loop exited code=$code (attempt #$n) ==="
  if [ "$code" -eq 0 ]; then
    echo "=== clean exit (gas-abort / maxCycles) — stopping wrapper, refuel needed ==="
    break
  fi
  echo "=== crash (code=$code, likely RPC) — restarting in 8s ==="
  sleep 8
done
