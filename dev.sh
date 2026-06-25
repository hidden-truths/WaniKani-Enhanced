#!/usr/bin/env bash
#
# dev.sh — start the WKEnhanced local dev servers together:
#
#     • wk-enhanced-api  (Bun + Hono)   — default port 3000
#     • study-app        (Vite)         — default port 5173
#
# The two run CROSS-ORIGIN, exactly like prod (study app → api.wkenhanced.dev).
# This script wires them to each other so login / credentialed-CORS works on
# whatever ports they land on:
#
#     • the API is told to allow the study app's origin   (STUDY_APP_ORIGINS)
#     • the study app is told where the API lives          (VITE_API_BASE)
#     • the API's media base is pinned to its own port     (MEDIA_PUBLIC_BASE)
#
# Both inline env vars take precedence over the committed .env / .env.development
# (Bun and Vite both let real env vars override their dotenv files), so nothing
# on disk needs editing to use custom ports.
#
# Usage:
#     ./dev.sh                      # API :3000, study :5173
#     ./dev.sh -a 3001 -s 5174      # pick ports explicitly
#     ./dev.sh --find-free          # bump past any busy port automatically
#     ./dev.sh -a 4000 -f           # start the API search at 4000, auto-skip busy
#     ./dev.sh --help
#
# Ctrl-C stops both. If either server exits on its own, the other is stopped too.

set -uo pipefail

# Repo root = this script's directory, so it works from anywhere.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$ROOT/wk-enhanced-api"
STUDY_DIR="$ROOT/study-app"

API_PORT=3000
STUDY_PORT=5173
FIND_FREE=0

usage() {
  cat <<'EOF'
dev.sh — start the WKEnhanced dev servers (API + study app) together.

Usage:
  ./dev.sh [options]

Options:
  -a, --api-port N      API server port              (default 3000)
  -s, --study-port N    study-app (Vite) port        (default 5173)
  -f, --find-free       if a chosen port is busy, use the next free one
  -h, --help            show this help

Examples:
  ./dev.sh                    # API :3000, study :5173
  ./dev.sh -a 3001 -s 5174    # explicit ports
  ./dev.sh --find-free        # auto-skip busy ports
EOF
}

# ── arg parsing ────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    -a|--api-port)
      [ $# -ge 2 ] || { echo "✗ $1 requires a port number" >&2; exit 2; }
      API_PORT="$2"; shift 2 ;;
    -s|--study-port)
      [ $# -ge 2 ] || { echo "✗ $1 requires a port number" >&2; exit 2; }
      STUDY_PORT="$2"; shift 2 ;;
    -f|--find-free) FIND_FREE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "✗ Unknown option: $1" >&2; echo >&2; usage >&2; exit 2 ;;
  esac
done

is_port() {
  case "$1" in ''|*[!0-9]*) return 1 ;; esac
  [ "$1" -ge 1 ] && [ "$1" -le 65535 ]
}
is_port "$API_PORT"   || { echo "✗ Invalid --api-port: $API_PORT"   >&2; exit 2; }
is_port "$STUDY_PORT" || { echo "✗ Invalid --study-port: $STUDY_PORT" >&2; exit 2; }

# ── port resolution ────────────────────────────────────────────────────────
# True (rc 0) if something is LISTENing on the given TCP port.
port_in_use() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  elif command -v nc >/dev/null 2>&1; then
    nc -z localhost "$1" >/dev/null 2>&1
  else
    return 1   # no probe available — assume free
  fi
}

# Echo a usable port for $2 (a label), starting at $1. A 3rd arg is an already
# claimed port to skip (so the two servers can't collide under --find-free).
# Without --find-free a busy/claimed port is a hard error with a hint.
resolve_port() {
  local p="$1" label="$2" reserved="${3:-}"
  while port_in_use "$p" || { [ -n "$reserved" ] && [ "$p" = "$reserved" ]; }; do
    if [ "$FIND_FREE" -ne 1 ]; then
      echo "✗ $label port $p is already in use." >&2
      echo "  Re-run with --find-free to auto-pick the next open port," >&2
      echo "  or choose another with -a/--api-port / -s/--study-port." >&2
      exit 1
    fi
    p=$((p + 1))
    [ "$p" -le 65535 ] || { echo "✗ Ran out of ports searching for $label" >&2; exit 1; }
  done
  printf '%s\n' "$p"
}

API_PORT="$(resolve_port "$API_PORT" "API")"
STUDY_PORT="$(resolve_port "$STUDY_PORT" "study-app" "$API_PORT")"

# ── prerequisites ──────────────────────────────────────────────────────────
command -v bun >/dev/null 2>&1 || {
  echo "✗ bun not found on PATH. Install it from https://bun.sh" >&2; exit 1; }
[ -d "$API_DIR" ]   || { echo "✗ Missing $API_DIR"   >&2; exit 1; }
[ -d "$STUDY_DIR" ] || { echo "✗ Missing $STUDY_DIR" >&2; exit 1; }

ensure_deps() {  # $1 = project dir
  if [ ! -d "$1/node_modules" ]; then
    echo "▸ Installing deps in $(basename "$1") (first run)…"
    ( cd "$1" && bun install ) || { echo "✗ bun install failed in $1" >&2; exit 1; }
  fi
}
ensure_deps "$API_DIR"
ensure_deps "$STUDY_DIR"

# ── launch + lifecycle ─────────────────────────────────────────────────────
API_PID=""
STUDY_PID=""

cleanup() {
  trap - INT TERM HUP EXIT
  echo ""
  echo "▸ Shutting down…"
  [ -n "$API_PID" ]   && kill "$API_PID"   2>/dev/null
  [ -n "$STUDY_PID" ] && kill "$STUDY_PID" 2>/dev/null
  wait 2>/dev/null
}
# INT/TERM = Ctrl-C or `kill`; HUP = the terminal window closing. EXIT covers a
# server dying on its own (the monitor loop below falls through to here).
trap cleanup INT TERM HUP EXIT

# API: PORT + the study origin it must allow for credentialed CORS + a media
# base that matches its own port. exec keeps $! pointing at the bun process.
( cd "$API_DIR" && exec env \
    PORT="$API_PORT" \
    STUDY_APP_ORIGINS="http://localhost:$STUDY_PORT" \
    MEDIA_PUBLIC_BASE="http://localhost:$API_PORT/media" \
    bun dev ) &
API_PID=$!

# Study app: point it at the API, pin the Vite port (--strictPort so it fails
# loudly instead of silently incrementing onto an origin the API won't allow).
( cd "$STUDY_DIR" && exec env \
    VITE_API_BASE="http://localhost:$API_PORT" \
    bun run dev -- --port "$STUDY_PORT" --strictPort ) &
STUDY_PID=$!

cat <<EOF

  WKEnhanced dev servers
  ──────────────────────
  API     →  http://localhost:$API_PORT          (wk-enhanced-api · bun dev)
  Study   →  http://localhost:$STUDY_PORT          (study-app · vite)
            ↳ talking to the API at http://localhost:$API_PORT
  Docs    →  http://localhost:$API_PORT/docs
  Health  →  http://localhost:$API_PORT/v1/health

  Press Ctrl-C to stop both.

EOF

# Wait until either server exits, then the EXIT trap stops the survivor.
while kill -0 "$API_PID" 2>/dev/null && kill -0 "$STUDY_PID" 2>/dev/null; do
  sleep 1
done

echo ""
echo "▸ A server exited — stopping the other."
