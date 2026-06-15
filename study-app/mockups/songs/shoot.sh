#!/bin/zsh
# Capture annotated mockup screens to PNG with Chrome headless.
# Two passes: (1) read <html data-h> to get the page height, (2) screenshot at that height
# (headless captures the viewport, not the full page). Usage: ./shoot.sh [name ...]
# No args = every screens/*.html. Retina (2x), light theme by default.
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
DIR="$(cd "$(dirname "$0")" && pwd)"
shoot() {
  local file="$1" theme="${2:-light}" sfx="${3:-}"
  local name="${file:t:r}"
  local url="file://$DIR/screens/$name.html?theme=$theme"
  local h=$("$CHROME" --headless=new --disable-gpu --virtual-time-budget=2500 --window-size=1180,800 --dump-dom "$url" 2>/dev/null | grep -oE 'data-h="[0-9]+"' | head -1 | grep -oE '[0-9]+')
  [ -z "$h" ] && h=1700
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --virtual-time-budget=2500 --window-size=1180,$h --screenshot="$DIR/screens/$name$sfx.png" "$url" 2>/dev/null
  echo "  $name$sfx -> 1180x${h}"
}
if [ $# -eq 0 ]; then set -- $DIR/screens/*.html; fi
for f in "$@"; do shoot "$f"; done
