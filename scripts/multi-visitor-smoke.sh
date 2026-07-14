#!/usr/bin/env bash
# Multi-visitor sandbox smoke test for the public demo.
#
# Spins up two independent cookie jars (two "visitors"), confirms each gets
# its own session token AND its own sandbox SQLite file. Then mutates state
# in jar A (creates a new tag) and verifies it does NOT leak into jar B.
#
# Usage: bash scripts/multi-visitor-smoke.sh [URL]
#        URL defaults to https://demo.astroledger.app

set -e
URL="${1:-https://demo.astroledger.app}"
JAR_A=$(mktemp)
JAR_B=$(mktemp)
trap "rm -f \"$JAR_A\" \"$JAR_B\" ./.sb-* 2>/dev/null" EXIT

echo "[1] Visitor A: initial GET (triggers start-session)"
curl -sL -c "$JAR_A" -b "$JAR_A" -o /dev/null -w "  HTTP %{http_code}\n" "$URL/"
TOKEN_A=$(grep -E 'authjs.session-token|__Secure-authjs.session-token' "$JAR_A" | awk '{print $NF}' | head -1)
echo "  cookie A: ${TOKEN_A:0:24}..."

echo "[2] Visitor B: initial GET (triggers start-session)"
curl -sL -c "$JAR_B" -b "$JAR_B" -o /dev/null -w "  HTTP %{http_code}\n" "$URL/"
TOKEN_B=$(grep -E 'authjs.session-token|__Secure-authjs.session-token' "$JAR_B" | awk '{print $NF}' | head -1)
echo "  cookie B: ${TOKEN_B:0:24}..."

if [ "$TOKEN_A" = "$TOKEN_B" ]; then echo "FAIL: tokens collided"; exit 1; fi

echo "[3] Visitor A: GET /api/tags (initial list)"
curl -sL -b "$JAR_A" -o ./.sb-a-tags1.json -w "  HTTP %{http_code}\n" "$URL/api/tags"
COUNT_A1=$(node -e "const d=JSON.parse(require('fs').readFileSync('./.sb-a-tags1.json','utf8')); console.log((d.tags||[]).length)")
echo "  visitor A sees $COUNT_A1 tags"

echo "[4] Visitor B: GET /api/tags (initial list)"
curl -sL -b "$JAR_B" -o ./.sb-b-tags1.json -w "  HTTP %{http_code}\n" "$URL/api/tags"
COUNT_B1=$(node -e "const d=JSON.parse(require('fs').readFileSync('./.sb-b-tags1.json','utf8')); console.log((d.tags||[]).length)")
echo "  visitor B sees $COUNT_B1 tags"

UNIQUE_NAME="leak-test-$(date +%s%N | tail -c 7)"
echo "[5] Visitor A: POST /api/tags name=$UNIQUE_NAME"
curl -sL -b "$JAR_A" -X POST -H 'Content-Type: application/json' \
  -d "{\"name\":\"$UNIQUE_NAME\",\"kind\":\"secondary\"}" \
  -o ./.sb-a-create.json -w "  HTTP %{http_code}\n" "$URL/api/tags"
cat ./.sb-a-create.json | head -c 200; echo

echo "[6] Visitor A: re-GET /api/tags (expect +1)"
curl -sL -b "$JAR_A" -o ./.sb-a-tags2.json "$URL/api/tags"
COUNT_A2=$(node -e "const d=JSON.parse(require('fs').readFileSync('./.sb-a-tags2.json','utf8')); console.log((d.tags||[]).length)")
HAS_A=$(node -e "const d=JSON.parse(require('fs').readFileSync('./.sb-a-tags2.json','utf8')); console.log((d.tags||[]).some(t=>t.name==='$UNIQUE_NAME'))")
echo "  visitor A now sees $COUNT_A2 tags; new tag present: $HAS_A"

echo "[7] Visitor B: re-GET /api/tags (expect unchanged)"
curl -sL -b "$JAR_B" -o ./.sb-b-tags2.json "$URL/api/tags"
COUNT_B2=$(node -e "const d=JSON.parse(require('fs').readFileSync('./.sb-b-tags2.json','utf8')); console.log((d.tags||[]).length)")
HAS_B=$(node -e "const d=JSON.parse(require('fs').readFileSync('./.sb-b-tags2.json','utf8')); console.log((d.tags||[]).some(t=>t.name==='$UNIQUE_NAME'))")
echo "  visitor B still sees $COUNT_B2 tags; A's new tag present in B: $HAS_B"

echo
echo "=== Sandbox isolation summary ==="
echo "  A start: $COUNT_A1 tags → after create: $COUNT_A2 (has '$UNIQUE_NAME': $HAS_A)"
echo "  B start: $COUNT_B1 tags → no edits:     $COUNT_B2 (has '$UNIQUE_NAME': $HAS_B)"

FAIL=0
[ "$HAS_A" = "true" ] || { echo "FAIL: A doesn't see its own new tag"; FAIL=1; }
[ "$HAS_B" = "false" ] || { echo "FAIL: B sees A's new tag (LEAK)"; FAIL=1; }
[ "$COUNT_A2" -gt "$COUNT_A1" ] || { echo "FAIL: A's tag count didn't grow"; FAIL=1; }
[ "$COUNT_B2" = "$COUNT_B1" ] || { echo "FAIL: B's tag count changed"; FAIL=1; }
[ $FAIL = 0 ] && echo "PASS: sandboxes are isolated."
exit $FAIL
