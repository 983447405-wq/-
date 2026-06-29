#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: %s <video-file-or-directory> [...]\n' "$(basename "$0")"
  printf 'Compress videos to WebM VP9/Opus, then rename originals with _back after all conversions succeed.\n'
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

fps_decimal() {
  awk -v rate="$1" 'BEGIN {
    split(rate, a, "/");
    if (a[1] == "" || a[1] == "0") { printf "0"; exit }
    if (a[2] == "" || a[2] == "0") { printf "%.6f", a[1]; exit }
    printf "%.6f", a[1] / a[2]
  }'
}

fps_filter_for() {
  local input="$1"
  local rate fps
  rate="$(ffprobe -v error -select_streams v:0 -show_entries stream=avg_frame_rate -of default=noprint_wrappers=1:nokey=1 "$input")"
  fps="$(fps_decimal "$rate")"
  if awk -v fps="$fps" 'BEGIN { exit !(fps > 30.0001) }'; then
    printf 'fps=30,scale=600:-2'
  else
    printf 'scale=600:-2'
  fi
}

probe_field() {
  ffprobe -v error "$@"
}

if [[ $# -eq 0 ]]; then
  usage
  exit 2
fi

require_command ffmpeg
require_command ffprobe
require_command awk

inputs=()
for arg in "$@"; do
  if [[ -d "$arg" ]]; then
    while IFS= read -r -d '' file; do
      inputs+=("$file")
    done < <(find "$arg" -maxdepth 1 -type f \( -iname '*.mp4' -o -iname '*.mov' -o -iname '*.m4v' -o -iname '*.mkv' -o -iname '*.avi' -o -iname '*.webm' \) -print0)
  elif [[ -f "$arg" ]]; then
    inputs+=("$arg")
  else
    printf 'Input not found: %s\n' "$arg" >&2
    exit 1
  fi
done

if [[ ${#inputs[@]} -eq 0 ]]; then
  printf 'No video files found.\n' >&2
  exit 1
fi

outputs=()
backups=()
conflicts=()
for input in "${inputs[@]}"; do
  dir="$(dirname "$input")"
  filename="$(basename "$input")"
  stem="${filename%.*}"
  ext="${filename##*.}"
  if [[ "$filename" == "$stem" ]]; then
    backup="$dir/${stem}_back"
  else
    backup="$dir/${stem}_back.$ext"
  fi
  output="$dir/${stem}.webm"

  [[ -w "$dir" ]] || conflicts+=("Directory is not writable: $dir")
  [[ "$input" != "$output" ]] || conflicts+=("Output would overwrite source WebM: $input")
  [[ ! -e "$backup" ]] || conflicts+=("Backup already exists: $backup")
  [[ ! -e "$output" ]] || conflicts+=("Output already exists: $output")

  for existing in "${outputs[@]}"; do
    [[ "$existing" != "$output" ]] || conflicts+=("Duplicate output target: $output")
  done
  for existing in "${backups[@]}"; do
    [[ "$existing" != "$backup" ]] || conflicts+=("Duplicate backup target: $backup")
  done

  outputs+=("$output")
  backups+=("$backup")
done

if [[ ${#conflicts[@]} -gt 0 ]]; then
  printf 'Conflicts found. No files were changed.\n' >&2
  for conflict in "${conflicts[@]}"; do
    printf ' - %s\n' "$conflict" >&2
  done
  exit 1
fi

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/webm-compress.XXXXXX")"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

tmp_outputs=()
for i in "${!inputs[@]}"; do
  input="${inputs[$i]}"
  output="${outputs[$i]}"
  tmp_output="$tmp_dir/${i}_$(basename "$output")"
  vf="$(fps_filter_for "$input")"

  printf 'Compressing: %s\n' "$input"
  ffmpeg -hide_banner -y -i "$input" \
    -map "0:v:0" -map "0:a?" \
    -vf "$vf" \
    -c:v libvpx-vp9 \
    -crf 31 -b:v 1.5M -maxrate 1.5M -bufsize 3M \
    -row-mt 1 -deadline good -cpu-used 4 \
    -pix_fmt yuv420p \
    -c:a libopus -b:a 96k \
    "$tmp_output"

  [[ -s "$tmp_output" ]] || {
    printf 'Compression produced an empty file: %s\n' "$input" >&2
    exit 1
  }

  width="$(probe_field -select_streams v:0 -show_entries stream=width -of default=noprint_wrappers=1:nokey=1 "$tmp_output")"
  rate="$(probe_field -select_streams v:0 -show_entries stream=avg_frame_rate -of default=noprint_wrappers=1:nokey=1 "$tmp_output")"
  fps="$(fps_decimal "$rate")"
  format="$(probe_field -show_entries format=format_name -of default=noprint_wrappers=1:nokey=1 "$tmp_output")"

  [[ "$width" == "600" ]] || {
    printf 'Validation failed for %s: width is %s, expected 600\n' "$input" "$width" >&2
    exit 1
  }
  awk -v fps="$fps" 'BEGIN { exit !(fps <= 30.0001) }' || {
    printf 'Validation failed for %s: FPS is %s, expected <= 30\n' "$input" "$fps" >&2
    exit 1
  }
  [[ "$format" == *webm* ]] || {
    printf 'Validation failed for %s: format is %s, expected WebM\n' "$input" "$format" >&2
    exit 1
  }

  tmp_outputs+=("$tmp_output")
done

printf '\nAll conversions succeeded. Moving files back to source folders.\n'
for i in "${!inputs[@]}"; do
  mv "${inputs[$i]}" "${backups[$i]}"
  mv "${tmp_outputs[$i]}" "${outputs[$i]}"
done

printf '\nSummary\n'
printf '%-36s %-10s %-12s %-10s %-10s\n' "Output" "Size" "Resolution" "FPS" "Duration"
for i in "${!outputs[@]}"; do
  output="${outputs[$i]}"
  backup="${backups[$i]}"
  [[ -s "$output" ]] || {
    printf 'Final validation failed: output missing or empty: %s\n' "$output" >&2
    exit 1
  }
  [[ -f "$backup" ]] || {
    printf 'Final validation failed: backup missing: %s\n' "$backup" >&2
    exit 1
  }
  width="$(probe_field -select_streams v:0 -show_entries stream=width -of default=noprint_wrappers=1:nokey=1 "$output")"
  height="$(probe_field -select_streams v:0 -show_entries stream=height -of default=noprint_wrappers=1:nokey=1 "$output")"
  rate="$(probe_field -select_streams v:0 -show_entries stream=avg_frame_rate -of default=noprint_wrappers=1:nokey=1 "$output")"
  fps="$(fps_decimal "$rate")"
  duration="$(probe_field -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$output")"
  size="$(du -h "$output" | awk '{print $1}')"
  printf '%-36s %-10s %-12s %-10s %-10.2f\n' "$(basename "$output")" "$size" "${width}x${height}" "$fps" "$duration"
done
