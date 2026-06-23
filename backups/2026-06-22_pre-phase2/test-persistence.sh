#!/bin/bash
# test-persistence.sh — Tests MongoDB persistence through server restart
# Requires: MONGO_URI env var set, node installed
# Usage: MONGO_URI=mongodb+srv://... bash test-persistence.sh

set -e

PORT=3069
URL="http://localhost:$PORT"
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
PASSED=0
FAILED=0

pass() { echo -e "  ${GREEN}✅ $1${NC}"; ((PASSED++)); }
fail() { echo -e "  ${RED}❌ FAIL: $1${NC}"; ((FAILED++)); }

cleanup() { lsof -ti:$PORT | xargs kill -9 2>/dev/null || true; }

echo ""
echo "🧪 Persistence Test (kill/restart)"
echo ""

if [ -z "$MONGO_URI" ]; then
  echo "⚠️  MONGO_URI not set — skipping persistence test"
  echo "   Usage: MONGO_URI=mongodb+srv://... bash test-persistence.sh"
  exit 0
fi

# 1. Kill any existing server
cleanup
sleep 1

# 2. Start server
echo "1️⃣  Starting server..."
MONGO_URI="$MONGO_URI" node server.js &
SERVER_PID=$!
sleep 3

# Check it's running
STATUS=$(curl -s "$URL/status" | python3 -c "import sys,json; print(json.load(sys.stdin).get('version',''))" 2>/dev/null)
if [ -z "$STATUS" ]; then
  fail "Server didn't start"
  exit 1
fi
pass "Server started ($STATUS)"

# 3. Create a party via socket.io
echo ""
echo "2️⃣  Creating party + data..."
node -e "
import { io } from 'socket.io-client';
const s = io('$URL', { transports: ['websocket'] });
s.on('connect', () => {
  s.emit('host:startParty', { code: 'TEST42', profile: { name: 'TestDJ', emoji: '🎧' } });
  setTimeout(() => {
    s.emit('host:trackUpdate', { title: 'Test Track', artist: 'Test Artist', genre: 'House' });
    setTimeout(() => {
      console.log('Data sent');
      s.disconnect();
      process.exit(0);
    }, 500);
  }, 500);
});
"
sleep 2

# Verify party exists
PARTIES=$(curl -s "$URL/status" | python3 -c "import sys,json; print(json.load(sys.stdin).get('activeParties',0))" 2>/dev/null)
if [ "$PARTIES" = "1" ]; then
  pass "Party TEST42 created"
else
  fail "Party not created (got $PARTIES)"
fi

# 4. Wait for flush (35s)
echo ""
echo "3️⃣  Waiting for flush (35s)..."
sleep 35

# 5. Kill server hard (SIGKILL)
echo ""
echo "4️⃣  Killing server (SIGKILL)..."
kill -9 $SERVER_PID 2>/dev/null || true
sleep 2
pass "Server killed"

# 6. Restart server
echo ""
echo "5️⃣  Restarting server..."
MONGO_URI="$MONGO_URI" node server.js &
SERVER_PID=$!
sleep 3

# Check it's running
STATUS2=$(curl -s "$URL/status" | python3 -c "import sys,json; print(json.load(sys.stdin).get('version',''))" 2>/dev/null)
if [ -z "$STATUS2" ]; then
  fail "Server didn't restart"
  cleanup
  exit 1
fi
pass "Server restarted ($STATUS2)"

# 7. Verify party was restored
PARTIES2=$(curl -s "$URL/status" | python3 -c "import sys,json; print(json.load(sys.stdin).get('activeParties',0))" 2>/dev/null)
if [ "$PARTIES2" = "1" ]; then
  pass "Party TEST42 restored from MongoDB! 🎉"
else
  fail "Party not restored (got $PARTIES2 active parties)"
fi

# 8. Verify state integrity
echo ""
echo "6️⃣  Verifying state..."
TRACK=$(curl -s "$URL/api/state?code=TEST42" | python3 -c "
import sys,json
d = json.load(sys.stdin)
ct = d.get('currentTrack') or {}
print(ct.get('title',''))
" 2>/dev/null)
if [ "$TRACK" = "Test Track" ]; then
  pass "Track data preserved"
else
  fail "Track data lost (got '$TRACK')"
fi

# Cleanup
echo ""
echo "7️⃣  Cleanup..."
cleanup
sleep 1

echo ""
echo "════════════════════════════════════════"
echo "  Results: $PASSED passed, $FAILED failed"
echo "════════════════════════════════════════"
echo ""

exit $FAILED
