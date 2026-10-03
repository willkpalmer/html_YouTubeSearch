#!/bin/sh
# Start Subscription Search on http://localhost:8765/ (macOS / Linux).
cd "$(dirname "$0")"
URL="http://localhost:8765/"
( sleep 1; (command -v xdg-open >/dev/null && xdg-open "$URL") || (command -v open >/dev/null && open "$URL") ) >/dev/null 2>&1 &
echo "Subscription Search is running at $URL (Ctrl+C to stop)"
exec python3 -m http.server 8765 --bind 127.0.0.1
