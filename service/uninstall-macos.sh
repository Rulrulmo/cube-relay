#!/usr/bin/env bash
# Stop and remove the cube-relay launchd user agent.
set -euo pipefail
LABEL=work.rulrulmo.cube-relay
UID_NUM="$(id -u)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
echo "uninstalled: $LABEL (plist 제거, 서비스 중지)"
