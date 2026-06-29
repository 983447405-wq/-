#!/usr/bin/env python3
import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("VIDEO_WEBM_HELPER_PORT", "17777"))
FFMPEG_BIN = os.environ.get("FFMPEG_BIN") or os.path.join(ROOT_DIR, "tools", "ffmpeg", "ffmpeg")
FFPROBE_BIN = os.environ.get("FFPROBE_BIN") or os.path.join(ROOT_DIR, "tools", "ffmpeg", "ffprobe")
VERSION = "2.0.7"


def resolve_tool(path, fallback_name):
  if os.path.isfile(path) and os.access(path, os.X_OK):
    return path
  fallback = shutil.which(fallback_name)
  if fallback:
    return fallback
  raise RuntimeError(f"Missing {fallback_name}. Expected bundled binary at: {path}")


def run_command(args):
  result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
  if result.returncode != 0:
    detail = result.stderr.strip() or result.stdout.strip() or f"exit code {result.returncode}"
    raise RuntimeError(detail[-4000:])
  return result.stdout


def fps_decimal(rate):
  if not rate:
    return 0.0
  parts = rate.split("/")
  try:
    if len(parts) == 2:
      numerator = float(parts[0] or 0)
      denominator = float(parts[1] or 0)
      return numerator / denominator if denominator else 0.0
    return float(rate)
  except ValueError:
    return 0.0


def probe_video(path):
  raw = run_command([
    FFPROBE,
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,avg_frame_rate:format=format_name,duration",
    "-of", "json",
    path,
  ])
  data = json.loads(raw)
  streams = data.get("streams") or []
  if not streams:
    raise RuntimeError("No video stream found")
  stream = streams[0]
  fmt = data.get("format") or {}
  fps = fps_decimal(stream.get("avg_frame_rate", "0/0"))
  return {
    "width": int(stream.get("width") or 0),
    "height": int(stream.get("height") or 0),
    "fps": fps,
    "duration": float(fmt.get("duration") or 0),
    "format": fmt.get("format_name") or "",
  }


def validate_output(path):
  if not os.path.isfile(path) or os.path.getsize(path) <= 0:
    raise RuntimeError("Output file is missing or empty")
  meta = probe_video(path)
  if meta["width"] != 600:
    raise RuntimeError(f"Output width is {meta['width']}, expected 600")
  if meta["fps"] > 30.0001:
    raise RuntimeError(f"Output FPS is {meta['fps']:.3f}, expected <= 30")
  if "webm" not in meta["format"]:
    raise RuntimeError(f"Output format is {meta['format']}, expected WebM")
  return meta


def safe_stem(filename):
  base = os.path.basename(filename or "video")
  stem, _ = os.path.splitext(base)
  cleaned = "".join("-" if ch in '\\/:*?"<>|' else ch for ch in stem).strip()
  return cleaned or "video"


class Handler(BaseHTTPRequestHandler):
  server_version = "VideoWebmLocalHelper/2.0.7"

  def log_message(self, fmt, *args):
    sys.stdout.write("%s - %s\n" % (self.address_string(), fmt % args))
    sys.stdout.flush()

  def send_cors(self):
    self.send_header("Access-Control-Allow-Origin", "*")
    self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    self.send_header("Access-Control-Allow-Headers", "Content-Type")
    self.send_header("Access-Control-Expose-Headers", "X-Output-File-Name-B64, X-Video-Width, X-Video-Height, X-Video-Fps, X-Video-Duration")

  def send_json(self, status, payload):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    self.send_response(status)
    self.send_cors()
    self.send_header("Content-Type", "application/json; charset=utf-8")
    self.send_header("Content-Length", str(len(data)))
    self.end_headers()
    self.wfile.write(data)

  def do_OPTIONS(self):
    self.send_response(204)
    self.send_cors()
    self.end_headers()

  def do_GET(self):
    path = urlparse(self.path).path
    if path != "/health":
      self.send_json(404, {"ok": False, "error": "Not found"})
      return
    try:
      ffmpeg_version = run_command([FFMPEG, "-version"]).splitlines()[0]
      ffprobe_version = run_command([FFPROBE, "-version"]).splitlines()[0]
      self.send_json(200, {
        "ok": True,
        "version": VERSION,
        "engine": "native-ffmpeg",
        "ffmpeg": ffmpeg_version,
        "ffprobe": ffprobe_version,
      })
    except Exception as error:
      self.send_json(500, {"ok": False, "error": str(error)})

  def do_POST(self):
    path = urlparse(self.path)
    if path.path != "/convert":
      self.send_json(404, {"ok": False, "error": "Not found"})
      return

    length = int(self.headers.get("Content-Length") or "0")
    if length <= 0:
      self.send_json(400, {"ok": False, "error": "Missing request body"})
      return

    query = parse_qs(path.query)
    filename = (query.get("filename") or ["video.mp4"])[0]
    stem = safe_stem(filename)
    source_ext = os.path.splitext(filename)[1] or ".mp4"
    request_id = str(uuid.uuid4())

    with tempfile.TemporaryDirectory(prefix="webm-helper.") as tmp_dir:
      input_path = os.path.join(tmp_dir, f"input-{request_id}{source_ext}")
      output_path = os.path.join(tmp_dir, f"output-{request_id}.webm")
      try:
        remaining = length
        with open(input_path, "wb") as handle:
          while remaining > 0:
            chunk = self.rfile.read(min(1024 * 1024, remaining))
            if not chunk:
              break
            handle.write(chunk)
            remaining -= len(chunk)
        if remaining != 0:
          raise RuntimeError("Upload stream ended before all bytes were received")

        source_meta = probe_video(input_path)
        vf = "fps=30,scale=600:-2" if source_meta["fps"] > 30.0001 else "scale=600:-2"
        command = [
          FFMPEG,
          "-hide_banner",
          "-y",
          "-i", input_path,
          "-map", "0:v:0",
          "-map", "0:a?",
          "-vf", vf,
          "-c:v", "libvpx-vp9",
          "-crf", "31",
          "-b:v", "1.5M",
          "-maxrate", "1.5M",
          "-bufsize", "3M",
          "-row-mt", "1",
          "-deadline", "good",
          "-cpu-used", "4",
          "-pix_fmt", "yuv420p",
          "-c:a", "libopus",
          "-b:a", "96k",
          output_path,
        ]
        run_command(command)
        output_meta = validate_output(output_path)
        output_name = f"{stem}.webm"
        encoded_name = base64.urlsafe_b64encode(output_name.encode("utf-8")).decode("ascii")
        file_size = os.path.getsize(output_path)

        self.send_response(200)
        self.send_cors()
        self.send_header("Content-Type", "video/webm")
        self.send_header("Content-Length", str(file_size))
        self.send_header("Content-Disposition", 'attachment; filename="output.webm"')
        self.send_header("X-Output-File-Name-B64", encoded_name)
        self.send_header("X-Video-Width", str(output_meta["width"]))
        self.send_header("X-Video-Height", str(output_meta["height"]))
        self.send_header("X-Video-Fps", f"{output_meta['fps']:.6f}")
        self.send_header("X-Video-Duration", f"{output_meta['duration']:.6f}")
        self.end_headers()
        with open(output_path, "rb") as handle:
          shutil.copyfileobj(handle, self.wfile)
      except Exception as error:
        self.send_json(500, {"ok": False, "error": str(error)})


if __name__ == "__main__":
  try:
    FFMPEG = resolve_tool(FFMPEG_BIN, "ffmpeg")
    FFPROBE = resolve_tool(FFPROBE_BIN, "ffprobe")
  except Exception as error:
    print(error, file=sys.stderr)
    sys.exit(1)

  print(f"Video WebM local helper {VERSION}")
  print(f"Using ffmpeg: {FFMPEG}")
  print(f"Using ffprobe: {FFPROBE}")
  print(f"Listening on http://127.0.0.1:{PORT}")
  print("Keep this window open while using the Chrome extension.")
  server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
  try:
    server.serve_forever()
  except KeyboardInterrupt:
    print("\nStopping local helper.")
