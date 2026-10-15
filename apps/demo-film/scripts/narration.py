"""Cut the single ElevenLabs take into lines, place them on the film timeline, and
write src/words.json (absolute word times) and public/captions.en.vtt.

Usage: python3 scripts/narration.py   (from apps/demo-film)
"""
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
take = json.loads((ROOT / 'narration.alignment.json').read_text())
text, a = take['text'], take['alignment']
start, end = a['character_start_times_seconds'], a['character_end_times_seconds']

# (first words of the line, where its first word lands in the film, seconds)
PLACE = [
    ('Got something', 0.8),
    ('Inkcast doesn', 7.0),
    ('Then it draws', 15.6),
    ('Choose the voice', 20.8),
    ('Want a change', 23.6),
    ('Download it', 28.3),
    ('Inkcast. Type', 33.8),
]
heads = [text.index(p) for p, _ in PLACE]
lines = []
for i, (h, (_, at)) in enumerate(zip(heads, PLACE)):
    tail = (heads[i + 1] if i + 1 < len(PLACE) else len(text)) - 1
    while text[tail] == ' ':
        tail -= 1
    lines.append({'id': f'vo{i}', 'from': start[h], 'to': end[tail], 'at': at, 'text': text[h:tail + 1]})

audio = ROOT / 'public' / 'audio'
for ln in lines:
    # 40 ms of air either side; the take has natural silence between sentences.
    a0, a1 = max(0.0, ln['from'] - 0.04), ln['to'] + 0.12
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(audio / 'narration_raw.mp3'), '-ss', f'{a0:.3f}', '-to', f'{a1:.3f}',
                    '-af', 'afade=t=in:d=0.02,areverse,afade=t=in:d=0.06,areverse', '-ar', '48000', '-ac', '2',
                    str(audio / f"{ln['id']}.wav")], check=True)
    ln['clipStart'] = ln['at'] - (ln['from'] - a0)

words = []
for ln in lines:
    shift = ln['at'] - ln['from']
    seg_from = text.index(ln['text'])
    for m in re.finditer(r"[A-Za-z0-9']+", ln['text']):
        i, j = seg_from + m.start(), seg_from + m.end() - 1
        words.append({'w': m.group(0), 'line': ln['id'], 'at': round(start[i] + shift, 3), 'end': round(end[j] + shift, 3)})

(ROOT / 'src' / 'words.json').write_text(json.dumps({'lines': [{k: (round(v, 3) if isinstance(v, float) else v) for k, v in ln.items()} for ln in lines], 'words': words}, indent=1) + '\n')

def ts(t):
    return f'{int(t // 3600):02d}:{int(t % 3600 // 60):02d}:{t % 60:06.3f}'

cues = []
for ln in lines:
    shift = ln['at'] - ln['from']
    for m in re.finditer(r'[^.?!:]+[.?!:]', ln['text']):
        s = text.index(ln['text']) + m.start()
        while text[s] == ' ':
            s += 1
        e = text.index(ln['text']) + m.end() - 1
        cues.append((start[s] + shift, end[e] + shift + 0.3, text[s:e + 1]))
vtt = 'WEBVTT\n\n' + '\n'.join(f'{ts(s)} --> {ts(min(e, cues[i + 1][0] if i + 1 < len(cues) else e))}\n{t}\n' for i, (s, e, t) in enumerate(cues))
(ROOT / 'public' / 'captions.en.vtt').write_text(vtt)
for ln in lines:
    print(f"{ln['id']} at {ln['at']:5.2f} len {ln['to'] - ln['from']:4.2f}  {ln['text']}")
