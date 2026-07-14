#!/usr/bin/env bash
# Smoke-test the demo at https://demo.astroledger.app
# Confirms:
#   - 307 redirect to /api/demo/start-session
#   - start-session sets the authjs cookie + 302s back to next path
#   - follow-up GET with cookie returns 200 from / (dashboard)

set -e
URL="${1:-https://demo.astroledger.app}"
echo "== smoking $URL =="

echo "-- expect 307 -> /api/demo/start-session"
curl -sI "$URL/" | head -5

echo
echo "-- expect 302 + Set-Cookie: __Secure-authjs.session-token"
curl -sI "$URL/api/demo/start-session?next=/" | head -8

echo
echo "-- expect 200 with body (jar follows redirect chain)"
JAR=$(mktemp)
trap "rm -f $JAR" EXIT
HTTP=$(curl -sL -o /tmp/demo-body.html -w '%{http_code}' -c "$JAR" -b "$JAR" "$URL/")
echo "final HTTP: $HTTP"
echo "body bytes: $(wc -c < /tmp/demo-body.html)"
grep -oE '<title>[^<]+</title>' /tmp/demo-body.html | head -1
echo
echo "cookies set:"
cat "$JAR" | grep -v '^#' | grep -v '^$'
