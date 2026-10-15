#!/usr/bin/env bash
# Renders the Inkcast demo film and poster, masters audio to -14 LUFS, and writes the
# landing-page assets. Needs public/clips (see README.md) and the narration/sound stems.
set -euo pipefail
cd "$(dirname "$0")"
dest=../web/public/showcase
mkdir -p out "$dest"
npx remotion render src/index.ts InkcastDemo out/raw.mp4 --codec h264 --crf 18 --pixel-format yuv420p --color-space bt709 --audio-bitrate 320k
measured=$(ffmpeg -nostats -i out/raw.mp4 -af loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 |
  sed -n '/^{/,/^}/p' |
  python3 -c "import json,sys; d=json.load(sys.stdin); print(f\"measured_I={d['input_i']}:measured_TP={d['input_tp']}:measured_LRA={d['input_lra']}:measured_thresh={d['input_thresh']}:offset={d['target_offset']}\")")
ffmpeg -v error -y -i out/raw.mp4 -c:v copy -af "loudnorm=I=-14:TP=-1.5:LRA=11:${measured}:linear=true,aresample=48000" \
  -c:a aac -b:a 192k -movflags +faststart "$dest/inkcast-demo.mp4"
npx remotion still src/index.ts Poster out/poster.png
ffmpeg -v error -y -i out/poster.png -vf scale=1600:-1 -q:v 3 "$dest/inkcast-demo-poster.jpg"
cp public/captions.en.vtt "$dest/inkcast-demo.vtt"
echo "Wrote $dest/{inkcast-demo.mp4,inkcast-demo-poster.jpg,inkcast-demo.vtt}"
