#!/usr/bin/env bash
set -euo pipefail

LABEL="com.video-webm-compressor.helper"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
INSTALL_DIR="$HOME/Library/Application Support/VideoWebmCompressor/helper"
GUI_DOMAIN="gui/$(id -u)"

launchctl bootout "$GUI_DOMAIN" "$PLIST" >/dev/null 2>&1 || true
rm -f "$PLIST"
rm -rf "$INSTALL_DIR"

printf 'Removed local FFmpeg helper autostart.\n'
