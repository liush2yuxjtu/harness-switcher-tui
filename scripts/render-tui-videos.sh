#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHOWCASE="$PROJECT_ROOT/experiments/tui-showcase"
OUT_DIR="${1:-$PROJECT_ROOT/test-results/tui-videos}"
CAST_DIR="$OUT_DIR/casts"

mkdir -p "$OUT_DIR" "$CAST_DIR"
npm ci --prefix "$SHOWCASE" --ignore-scripts
cargo build --manifest-path "$SHOWCASE/rust/Cargo.toml" --release
(
  cd "$SHOWCASE/go"
  go mod download
  go build -mod=mod -o "$SHOWCASE/go/bubble-tea-demo" .
)

python3 "$SHOWCASE/record.py" --all --out "$CAST_DIR"

for name in ink opentui ratatui bubble-tea; do
  agg --font-size 15 "$CAST_DIR/$name.cast" "$OUT_DIR/$name.gif"
  ffmpeg -hide_banner -loglevel error -y -i "$OUT_DIR/$name.gif" \
    -vf 'fps=30,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x0b0f19,format=yuv420p' \
    -c:v libx264 -preset medium -crf 20 -movflags +faststart "$OUT_DIR/$name.mp4"
  ffprobe -v error -show_entries format=duration,size -of compact "$OUT_DIR/$name.mp4"
done

comparison_filter='[0:v]scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2:color=0x0b0f19[v0];[1:v]scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2:color=0x0b0f19[v1];[2:v]scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2:color=0x0b0f19[v2];[3:v]scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2:color=0x0b0f19[v3];[v0][v1]hstack=inputs=2[top];[v2][v3]hstack=inputs=2[bottom];[top][bottom]vstack=inputs=2[out]'
ffmpeg -hide_banner -loglevel error -y \
  -i "$OUT_DIR/ink.mp4" -i "$OUT_DIR/opentui.mp4" \
  -i "$OUT_DIR/ratatui.mp4" -i "$OUT_DIR/bubble-tea.mp4" \
  -filter_complex "$comparison_filter" \
  -map '[out]' -shortest -r 30 -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -movflags +faststart \
  "$OUT_DIR/tui-comparison.mp4"

ffmpeg -hide_banner -loglevel error -y -i "$OUT_DIR/tui-comparison.mp4" \
  -vf 'fps=1,scale=640:-1,tile=3x2:padding=8:margin=8:color=0x0b0f19' -frames:v 1 \
  "$OUT_DIR/tui-comparison-contact.png"

python3 - "$OUT_DIR" <<'PY'
import json
import subprocess
import sys
from pathlib import Path

out = Path(sys.argv[1])
items = []
for path in sorted(out.glob('*.mp4')):
    probe = subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_entries', 'format=duration,size',
        '-of', 'json', str(path),
    ])
    data = json.loads(probe)['format']
    items.append({'file': path.name, 'duration': float(data['duration']), 'bytes': int(data['size'])})
(out / 'manifest.json').write_text(json.dumps({'videos': items}, indent=2) + '\n')
PY

printf 'videos written to %s\n' "$OUT_DIR"
