#!/usr/bin/env python3
"""Rebuild the Tolca pitch video from the voice booth.

Run from anywhere:  python3 ~/rap-marketing/tolca-pitch/build.py
For each scene it uses your approved booth take ("Use mine"), otherwise the Kokoro draft.
If a line runs longer than its clip, the clip's last frame is held until the line ends.
Output: ~/rap-marketing/tolca-pitch/rap-tolca-pitch-for-yasser-booth.mp4
Needs ffmpeg and ffprobe on PATH.
"""
import json, subprocess, sys, tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent                      # ~/rap-marketing (the booth's media folder)
BOOTH = ROOT / 'voice-booth'
OUT = HERE / 'rap-tolca-pitch-for-yasser-booth.mp4'
TAIL = 0.3                              # silence after each line before the next scene


def dur(p):
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(p)],
                       capture_output=True, text=True, check=True)
    return float(r.stdout.strip())


def main():
    entry = json.loads((HERE / 'booth-entry.json').read_text())
    try:
        state = json.loads((BOOTH / 'state.json').read_text()).get(entry['id'], {})
    except (OSError, ValueError):
        state = {}
    tmp = Path(tempfile.mkdtemp(prefix='tolca-booth-'))
    parts, used = [], []
    for s in entry['scenes']:
        d = state.get(s['id']) or {}
        if d.get('voice') == 'mine' and d.get('take'):
            audio, who = BOOTH / 'takes' / entry['id'] / s['id'] / d['take'], 'yours (' + d['take'] + ')'
        else:
            audio, who = ROOT / s['kokoro'], 'Kokoro'
        if not audio.is_file():
            sys.exit(f'Missing audio for {s["id"]}: {audio}')
        clip = ROOT / s['video']
        lead = s.get('lead', 0.3)
        a, v = dur(audio), dur(clip)
        length = max(v, lead + a + TAIL)
        hold = length - v
        ms = int(lead * 1000)
        out = tmp / f'{s["id"]}.mp4'
        subprocess.run([
            'ffmpeg', '-y', '-loglevel', 'error', '-i', str(clip), '-i', str(audio),
            '-filter_complex',
            f'[0:v]tpad=stop_mode=clone:stop_duration={hold:.3f},fps=30,format=yuv420p[v];'
            f'[1:a]aformat=sample_rates=48000:channel_layouts=stereo,loudnorm=I=-16:TP=-1.5:LRA=11,'
            f'adelay={ms}|{ms},apad[a]',
            '-map', '[v]', '-map', '[a]', '-t', f'{length:.3f}',
            '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
            str(out)], check=True)
        parts.append(out)
        used.append(f'{s["id"]}: {who}, {a:.1f} s line, {length:.1f} s scene' + (f' (held {hold:.1f} s)' if hold > 0.05 else ''))
    lst = tmp / 'list.txt'
    lst.write_text(''.join(f"file '{p}'\n" for p in parts))
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', str(lst),
                    '-c', 'copy', '-movflags', '+faststart', str(OUT)], check=True)
    print('\n'.join(used))
    print(f'Built {OUT} ({dur(OUT):.1f} s)')


if __name__ == '__main__':
    main()
