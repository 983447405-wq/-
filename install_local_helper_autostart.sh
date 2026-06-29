#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "$0")" >/dev/null 2>&1 && pwd)"
LABEL="com.video-webm-compressor.helper"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
INSTALL_DIR="$HOME/Library/Application Support/VideoWebmCompressor/helper"
GUI_DOMAIN="gui/$(id -u)"
OUT_LOG="/tmp/video-webm-local-helper.out.log"
ERR_LOG="/tmp/video-webm-local-helper.err.log"

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$INSTALL_DIR/tools/ffmpeg"

cp "$ROOT_DIR/local_ffmpeg_server.py" "$INSTALL_DIR/local_ffmpeg_server.py"
cp "$ROOT_DIR/start_local_ffmpeg_server.sh" "$INSTALL_DIR/start_local_ffmpeg_server.sh"
cp "$ROOT_DIR/tools/ffmpeg/ffmpeg" "$INSTALL_DIR/tools/ffmpeg/ffmpeg"
cp "$ROOT_DIR/tools/ffmpeg/ffprobe" "$INSTALL_DIR/tools/ffmpeg/ffprobe"
chmod +x "$INSTALL_DIR/local_ffmpeg_server.py" "$INSTALL_DIR/start_local_ffmpeg_server.sh" "$INSTALL_DIR/tools/ffmpeg/ffmpeg" "$INSTALL_DIR/tools/ffmpeg/ffprobe"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$INSTALL_DIR/start_local_ffmpeg_server.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$INSTALL_DIR</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$OUT_LOG</string>
  <key>StandardErrorPath</key>
  <string>$ERR_LOG</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
PLIST

chmod 644 "$PLIST"

launchctl bootout "$GUI_DOMAIN" "$PLIST" >/dev/null 2>&1 || true

if command -v lsof >/dev/null 2>&1; then
  while IFS= read -r pid; do
    [[ -n "$pid" ]] && kill "$pid" >/dev/null 2>&1 || true
  done < <(lsof -ti tcp:17777 -sTCP:LISTEN 2>/dev/null || true)
fi

launchctl bootstrap "$GUI_DOMAIN" "$PLIST"
launchctl kickstart -k "$GUI_DOMAIN/$LABEL"

printf 'Installed and started local FFmpeg helper autostart.\n'
printf 'Helper files: %s\n' "$INSTALL_DIR"
printf 'LaunchAgent: %s\n' "$PLIST"
printf 'Health check: http://127.0.0.1:17777/health\n'
printf 'Logs: %s %s\n' "$OUT_LOG" "$ERR_LOG"
