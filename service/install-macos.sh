#!/usr/bin/env bash
# Install cube-relay broker as a macOS launchd user agent (auto-start on login,
# auto-restart on crash via KeepAlive). Token is read from ~/.config/cube-relay/token.
# Usage: service/install-macos.sh        (PORT env optional, default 8787)
set -euo pipefail

LABEL=work.rulrulmo.cube-relay
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE="$(command -v node || true)"
PORT="${PORT:-${CUBE_RELAY_PORT:-8787}}"
UID_NUM="$(id -u)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/cube-relay.log"

[ -n "$NODE" ] || { echo "node를 PATH에서 못 찾음"; exit 1; }
[ -f "$HOME/.config/cube-relay/token" ] || {
  echo "토큰 없음 → 먼저 설정:"; echo "  mkdir -p ~/.config/cube-relay && printf '%s' 'YOUR_TOKEN' > ~/.config/cube-relay/token && chmod 600 ~/.config/cube-relay/token"; exit 1; }

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$REPO/broker.mjs</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key><string>$PORT</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF

# (re)load — modern bootstrap with legacy fallback
launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID_NUM" "$PLIST" 2>/dev/null || launchctl load -w "$PLIST"
launchctl kickstart -k "gui/$UID_NUM/$LABEL" 2>/dev/null || true

echo "installed: $LABEL"
echo "  node:  $NODE"
echo "  exec:  $REPO/broker.mjs  (port $PORT)"
echo "  token: ~/.config/cube-relay/token"
echo "  log:   $LOG"
echo "  상태:  launchctl print gui/$UID_NUM/$LABEL | grep state"
echo "  중지:  service/uninstall-macos.sh"
