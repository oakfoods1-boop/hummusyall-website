#!/usr/bin/env python3
"""Talking reel with burned-in subtitles: Alon talking to camera, his own sound, tightened jump cuts with
punch-in zooms, optional B-roll cutaways (picture only, his voice keeps going), word-by-word captions with the
spoken word highlighted, a hook line at the top, and an end card.

  python3 reel_talk.py edit.json out.mp4

edit.json:
{
  "audio": "inbox/b/IMG_1.mp4",                 # clip whose sound is used (the talking clip)
  "words": "inbox/b/IMG_1.words.json",          # from transcribe.py (instagram-transcribe.yml)
  "fix": {"balls": "bowls"},                    # transcript corrections (case-insensitive, punctuation kept)
  "pieces": [                                   # kept stretches of the talking clip, in order
    {"a": [2.45, 6.25], "zoom": 1.0},           # a = start/end in the audio clip; picture from same clip
    {"a": [21.3, 23.7], "v": "inbox/b/IMG_2.mp4", "vs": 10.0, "zoom": 1.05}   # cutaway: picture from v at vs
  ],
  "hook": {"text": "MIDTOWN MARKET MORNING", "hl": "MIDTOWN", "dur": 3.0},
  "accent": "#FFE14D",
  "end": {"title": "Order online for Sunday delivery or pickup", "url": "hummusyall.com", "style": "pop", "dur": 2.6}
}
"""
import json, os, re, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from reel import fonts, run, end_png, wrap, W, H, FPS

GRADE = "eq=contrast=1.06:saturation=1.22:brightness=0.01,colorbalance=rs=0.03:bs=-0.03,vignette=angle=PI/5"

def ease_back(x):
    x = min(max(x, 0), 1); c1 = 1.7; c3 = c1 + 1
    return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2

def fix_word(w, fix):
    m = re.match(r"^(\W*)(.*?)(\W*)$", w); pre, core, post = m.groups()
    rep = fix.get(core.lower())
    if rep is None: return w
    if core[:1].isupper(): rep = rep[:1].upper() + rep[1:]
    return pre + rep + post

def timeline_words(edit):
    """Words that fall inside kept pieces, re-timed onto the output timeline."""
    data = json.load(open(edit['words'])); fix = edit.get('fix', {})
    words = [w for s in data['segments'] for w in s['words']]
    out, t = [], 0.0
    for p in edit['pieces']:
        a0, a1 = p['a']
        for w in words:
            mid = (w['s'] + w['e']) / 2
            if a0 <= mid < a1:
                out.append({'w': fix_word(w['w'], fix), 's': t + max(w['s'], a0) - a0, 'e': t + min(w['e'], a1) - a0})
        t += a1 - a0
    return out, t

def chunks(words, font, maxw=3, maxpx=W - 200):
    """Group words into short caption lines that fit the width; break after punctuation."""
    d0 = ImageDraw.Draw(Image.new('RGBA', (4, 4)))
    out, cur = [], []
    for w in words:
        if cur and d0.textlength(' '.join(x['w'] for x in cur + [w]), font=font) > maxpx:
            out.append(cur); cur = []
        cur.append(w)
        if len(cur) >= maxw or re.search(r"[.,!?]$", w['w']):
            out.append(cur); cur = []
    if cur: out.append(cur)
    for i, c in enumerate(out):  # a line stays up until the next one starts (or 0.5 s after its last word)
        c_end = out[i + 1][0]['s'] if i + 1 < len(out) else c[-1]['e'] + 0.5
        for x in c: x['line_end'] = min(c_end, c[-1]['e'] + 0.6)
    return out

def render_overlay(edit, F, words, total, pipe):
    accent = edit.get('accent', '#FFE14D')
    big = ImageFont.truetype(F['archivo'], 84)
    lines = chunks(words, big)
    hook = edit.get('hook'); hf = ImageFont.truetype(F['anton'], 118)
    n = int(round(total * FPS))
    d0 = ImageDraw.Draw(Image.new('RGBA', (4, 4)))
    for f in range(n):
        t = f / FPS
        img = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
        # hook line at the top for the first seconds
        if hook and t < hook.get('dur', 3.0):
            p = ease_back(t / 0.35); fade = min(1, (hook.get('dur', 3.0) - t) / 0.25)
            hl = set(hook.get('hl', '').upper().split())
            rows = wrap(d0, hook['text'].upper(), hf, W - 140); sp = d0.textlength(' ', font=hf); lh = 150
            layer = Image.new('RGBA', (W, lh * len(rows) + 40), (0, 0, 0, 0)); ld = ImageDraw.Draw(layer)
            for r, row in enumerate(rows):
                ws = row.split(); tw = sum(d0.textlength(w, font=hf) for w in ws) + sp * (len(ws) - 1)
                x, y = (W - tw) / 2, 20 + lh * r + lh / 2
                for w in ws:
                    ww = d0.textlength(w, font=hf)
                    if w in hl: ld.rectangle([x - 16, y - 70, x + ww + 16, y + 74], fill=accent); col = '#141414'; stroke = 0
                    else: col = '#FFFFFF'; stroke = 7
                    ld.text((x, y), w, font=hf, fill=col, anchor='lm', stroke_width=stroke, stroke_fill='#141414')
                    x += ww + sp
            sc = 0.4 + 0.6 * p; lw0, lh0 = layer.size
            layer = layer.resize((max(2, int(lw0 * sc)), max(2, int(lh0 * sc))), Image.LANCZOS)
            if fade < 1: layer.putalpha(layer.getchannel('A').point(lambda a: int(a * max(fade, 0))))
            img.alpha_composite(layer, ((W - layer.width) // 2, 230 + (lh0 - layer.height) // 2))
        # subtitles
        for c in lines:
            if not (c[0]['s'] - 0.05 <= t < c[0]['line_end']): continue
            pop = ease_back((t - c[0]['s'] + 0.05) / 0.18)
            ws = [x['w'] for x in c]; sp = d0.textlength(' ', font=big)
            tw = sum(d0.textlength(w, font=big) for w in ws) + sp * (len(ws) - 1)
            x, y = (W - tw) / 2, 1230
            bw, bh = (tw + 70) * (0.55 + 0.45 * pop), 130 * (0.55 + 0.45 * pop)
            d.rounded_rectangle([W / 2 - bw / 2, y - bh / 2, W / 2 + bw / 2, y + bh / 2], radius=30, fill='#00000078')
            for wobj, w in zip(c, ws):
                ww = d0.textlength(w, font=big); active = wobj['s'] - 0.04 <= t
                cur = active and (t < wobj['e'] + 0.08 or wobj is c[-1])
                col = accent if cur else ('#FFFFFF' if active else '#FFFFFFB0')
                sz = int(big.size * (0.55 + 0.45 * pop) * (1.07 if cur else 1.0))
                fnt = ImageFont.truetype(F['archivo'], max(8, sz))
                d.text((x + ww / 2, y + 6), w, font=fnt, fill='#00000090', anchor='mm', stroke_width=12, stroke_fill='#00000090')
                d.text((x + ww / 2, y), w, font=fnt, fill=col, anchor='mm', stroke_width=9, stroke_fill='#111111')
                x += ww + sp
        pipe.write(img.tobytes())

def build(edit, out):
    tmp = tempfile.mkdtemp(); F = fonts(tmp)
    words, talk = timeline_words(edit)
    # 1. picture pieces
    parts = []
    for i, p in enumerate(edit['pieces']):
        a0, a1 = p['a']; dur = a1 - a0
        src = p.get('v', edit['audio']); vs = p.get('vs', a0); z = float(p.get('zoom', 1.0))
        fx, fy = p.get('focus', [0.5, 0.42])
        zw, zh = int(W * z) // 2 * 2, int(H * z) // 2 * 2
        vf = (f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},scale={zw}:{zh},"
              f"crop={W}:{H}:{int((zw - W) * fx)}:{int((zh - H) * fy)},fps={FPS},{GRADE},setsar=1,format=yuv420p")
        o = os.path.join(tmp, f'p{i:02d}.mp4'); parts.append(o)
        run(['ffmpeg', '-nostdin', '-y', '-ss', f'{vs:.3f}', '-i', src, '-t', f'{dur:.3f}', '-vf', vf, '-an',
             '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', o])
    e = edit.get('end'); ed = 0.0
    if e:
        ed = float(e.get('dur', 2.6)); png = os.path.join(tmp, 'end.png')
        end_png(png, F, e.get('title', ''), e.get('url', 'hummusyall.com'), e.get('style', 'pop'))
        o = os.path.join(tmp, 'end.mp4'); parts.append(o)
        run(['ffmpeg', '-nostdin', '-y', '-loop', '1', '-i', png, '-t', f'{ed:.3f}', '-vf',
             f"fps={FPS},zoompan=z='1.0+0.0006*on':d=1:s={W}x{H}:fps={FPS},fade=in:0:6,setsar=1,format=yuv420p",
             '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', o])
    lst = os.path.join(tmp, 'list.txt'); open(lst, 'w').write(''.join(f"file '{p}'\n" for p in parts))
    base = os.path.join(tmp, 'base.mp4')
    run(['ffmpeg', '-nostdin', '-y', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', base])
    # 2. voice: the kept stretches, tiny fades at each cut, cleaned and loudness-normalised
    fl, labels = [], []
    for i, p in enumerate(edit['pieces']):
        a0, a1 = p['a']; d = a1 - a0
        fl.append(f"[0:a]atrim={a0:.3f}:{a1:.3f},asetpts=PTS-STARTPTS,afade=t=in:d=0.015,afade=t=out:st={d - 0.03:.3f}:d=0.03[a{i}]")
        labels.append(f"[a{i}]")
    fl.append(f"{''.join(labels)}concat=n={len(labels)}:v=0:a=1,highpass=f=90,afftdn=nf=-28,"
              f"loudnorm=I=-14:TP=-1.5:LRA=9,apad=whole_dur={talk + ed:.3f},aresample=48000[aout]")
    voice = os.path.join(tmp, 'voice.m4a')
    run(['ffmpeg', '-nostdin', '-y', '-i', edit['audio'], '-filter_complex', ';'.join(fl), '-map', '[aout]',
         '-c:a', 'aac', '-b:a', '192k', voice])
    # 3. captions + hook overlay, mux
    total = talk  # overlay only over the talking part
    cmd = ['ffmpeg', '-nostdin', '-y', '-loglevel', 'error', '-i', base, '-i', voice,
           '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
           '-filter_complex', '[0:v][2:v]overlay=0:0:eof_action=pass,format=yuv420p[v]',
           '-map', '[v]', '-map', '1:a', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
           '-profile:v', 'high', '-c:a', 'copy', '-movflags', '+faststart', '-t', f'{talk + ed:.3f}', out]
    pr = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    render_overlay(edit, F, words, total, pr.stdin); pr.stdin.close()
    if pr.wait(): raise SystemExit('final encode failed')
    print(out, f'{talk + ed:.1f}s')

if __name__ == '__main__':
    build(json.load(open(sys.argv[1])), sys.argv[2])
