#!/usr/bin/env bash
# Spawns ../server_stub.mjs, extracts its SIDECAR_READY handoff, and runs the .NET adapter's test
# harness (StarfishFoundryAdapter.Tests) against it -- the same pattern ../run_tests.py uses for the
# Python adapter. Verified working tonight: 6/6 checks passed.
set -euo pipefail
cd "$(dirname "$0")"

STUB_LOG=$(mktemp)
node --experimental-strip-types ../server_stub.mjs > "$STUB_LOG" 2>&1 &
STUB_PID=$!
trap 'kill "$STUB_PID" 2>/dev/null || true; rm -f "$STUB_LOG"' EXIT

# Wait for the SIDECAR_READY line rather than a fixed sleep.
for _ in $(seq 1 50); do
  grep -q SIDECAR_READY "$STUB_LOG" 2>/dev/null && break
  sleep 0.1
done
READY_LINE=$(grep SIDECAR_READY "$STUB_LOG" || true)
if [ -z "$READY_LINE" ]; then
  echo "server_stub.mjs never printed SIDECAR_READY -- stub log:" >&2
  cat "$STUB_LOG" >&2
  exit 1
fi

eval "$(python3 -c "
import json, sys
line = '''$READY_LINE'''
data = json.loads(line[len('SIDECAR_READY '):])
print(f\"export STARFISH_URL={data['url']}\")
print(f\"export STARFISH_WORKER_TOKEN={data['tokens']['worker']}\")
print(f\"export STARFISH_OPERATOR_TOKEN={data['tokens']['operator']}\")
print(f\"export STARFISH_OPERATOR2_TOKEN={data['tokens']['operator2']}\")
")"

dotnet run --no-launch-profile --project StarfishFoundryAdapter.Tests
