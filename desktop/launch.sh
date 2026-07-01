#!/bin/bash
# Run ChemViewer from source in its own Electron window — no install ceremony,
# no rebundle. Clone → run → live; `git pull` → relaunch → updated (the dev
# stack compiles the latest source on the fly into a native window).
set -e
cd "$(cd "$(dirname "$0")/.." && pwd)" # repo root (desktop/launch.sh → ..)

# Finder-launched .apps inherit a minimal PATH (no node/npm). Recover the user's
# real login-shell PATH so the SAME node/npm as a normal terminal are used.
USER_PATH="$(/bin/zsh -lic 'printf %s "$PATH"' 2>/dev/null || true)"
export PATH="${USER_PATH:+$USER_PATH:}/opt/homebrew/bin:/usr/local/bin:$PATH"

# macOS desktop notification (the .app runs silently to a log, so give feedback).
note() {
  osascript -e "display notification \"$1\" with title \"ChemViewer\"" >/dev/null 2>&1 || true
}

# First run: install web + desktop (Electron) deps. Slow once; silent otherwise.
if [ ! -d node_modules ] || [ ! -d desktop/node_modules ]; then
  note "First run: installing dependencies… (a few minutes)"
fi
if [ ! -d node_modules ]; then npm install; fi
if [ ! -d desktop/node_modules ]; then (cd desktop && npm install); fi

note "Starting ChemViewer…"
exec node desktop/scripts/dev.mjs
