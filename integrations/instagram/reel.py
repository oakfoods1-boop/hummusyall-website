#!/usr/bin/env python3
"""Build a 1080x1920 Instagram reel from photos/videos with brand text overlays and an end card.

  python3 reel.py edit.json out.mp4

edit.json:
{
  "shots": [
    {"src": "path/photo.jpg", "dur": 2.4, "text": "It's not a dip.", "sub": "optional smaller line",
     "focus": [0.5, 0.45], "zoom": "in" | "out", "textPos": "low" | "high"},
    {"src": "path/clip.mp4", "start": 3.0, "dur": 3.0, "text": "...", "keepAudio": true}
  ],
  "end": {"title": "Order for Sunday delivery", "url": "hummusyall.com", "dur": 3.0},
  "music": "path/track.mp3" | null,          # used when no shot keeps its own audio (Alon's rule:
  "transition": 0.35                          #   his voice stays; otherwise royalty-free music)
}
Fonts/logo come from this repo (fonts/*.woff2 converted on the fly, public/img/logo.webp).
"""
import json, os, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
W, H, FPS = 1080, 1920, 30
OLIVE, CREAM, LIME, PAPRIKA, INK = '#2F4A2A', '#FBF6EC', '#DFE777', '#C8502A', '#24301F'

def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        sys.stderr.write(r.stderr[-3000:]); raise SystemExit(f'ffmpeg failed: {" ".join(cmd[:6])}...')

def fonts(tmp):
    from fontTools.ttLib import TTFont
    out = {}
    for key, name in [('display', 'bricolage-grotesque-latin-800-normal'), ('body', 'poppins-latin-600-normal'), ('light', 'poppins-latin-500-normal')]:
        dst = os.path.join(tmp, name + '.ttf')
        f = TTFont(os.path.join(HERE, 'fonts', name + '.woff2')); f.flavor = None; f.save(dst)
        out[key] = dst
    return out

def wrap(draw, text, font, maxw):
    words, lines, cur = text.split(), [], ''
    for w in words:
        t = (cur + ' ' + w).strip()
        if draw.textlength(t, font=font) <= maxw: cur = t
        else: lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines

def text_png(path, F, text, sub=None, pos='low'):
    """Transparent 1080x1920 layer: cream pill with olive headline (+ optional lime sub-pill)."""
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    big = ImageFont.truetype(F['display'], 78); small = ImageFont.truetype(F['body'], 40)
    lines = wrap(d, text, big, W - 220) if text else []
    lh = 88; pad_x, pad_y = 44, 30
    blocks = []
    if lines:
        bw = max(d.textlength(l, font=big) for l in lines) + 2 * pad_x; bh = len(lines) * lh + 2 * pad_y - 10
        blocks.append(('big', lines, bw, bh))
    if sub:
        sw = d.textlength(sub, font=small) + 2 * 30; blocks.append(('sub', [sub], sw, 76))
    total = sum(b[3] for b in blocks) + 18 * (len(blocks) - 1)
    y = (1180 if pos == 'low' else 330) if pos in ('low', 'high') else 1180
    y = min(y, 1500 - total)                     # keep clear of Instagram's caption/buttons area
    for kind, ls, bw, bh in blocks:
        x = (W - bw) / 2
        if kind == 'big':
            d.rounded_rectangle([x, y, x + bw, y + bh], radius=34, fill=CREAM)
            for i, l in enumerate(ls):
                d.text((W / 2, y + pad_y + i * lh + 38), l, font=big, fill=OLIVE, anchor='mm')
        else:
            d.rounded_rectangle([x, y, x + bw, y + bh], radius=38, fill=LIME)
            d.text((W / 2, y + bh / 2 + 2), ls[0], font=small, fill=INK, anchor='mm')
        y += bh + 18
    img.save(path)

def end_png(path, F, title, url):
    img = Image.new('RGB', (W, H), OLIVE); d = ImageDraw.Draw(img)
    logo = Image.open(os.path.join(ROOT, 'public/img/logo.webp')).convert('RGBA').resize((300, 300))
    mask = Image.new('L', (300, 300), 0); ImageDraw.Draw(mask).ellipse([0, 0, 299, 299], fill=255)
    img.paste(logo, ((W - 300) // 2, 520), mask)
    d.text((W / 2, 930), "Hummus Y'all", font=ImageFont.truetype(F['display'], 96), fill=CREAM, anchor='mm')
    body = ImageFont.truetype(F['light'], 44)
    for i, l in enumerate(wrap(d, title, body, W - 200)):
        d.text((W / 2, 1050 + i * 60), l, font=body, fill='#F3EAD6', anchor='mm')
    bf = ImageFont.truetype(F['body'], 52); bw = d.textlength(url, font=bf) + 100
    d.rounded_rectangle([(W - bw) / 2, 1190, (W + bw) / 2, 1300], radius=55, fill=PAPRIKA)
    d.text((W / 2, 1246), url, font=bf, fill='white', anchor='mm')
    img.save(path)

def shot_clip(i, s, tmp, F):
    out = os.path.join(tmp, f'shot{i:02d}.mp4'); dur = float(s.get('dur', 2.4)); n = int(round(dur * FPS))
    layer = os.path.join(tmp, f'text{i:02d}.png'); text_png(layer, F, s.get('text'), s.get('sub'), s.get('textPos', 'low'))
    fx, fy = s.get('focus', [0.5, 0.5]); zin = s.get('zoom', 'in') == 'in'
    is_video = os.path.splitext(s['src'])[1].lower() in ('.mp4', '.mov', '.m4v')
    fade = f"[1]format=rgba,fade=in:st=0.25:d=0.35:alpha=1[t]"
    if is_video:
        inp = ['-ss', str(s.get('start', 0)), '-t', str(dur), '-i', s['src']]
        base = f"[0]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}:(iw-{W})*{fx}:(ih-{H})*{fy},fps={FPS},setsar=1[b]"
    else:
        inp = ['-loop', '1', '-framerate', str(FPS), '-t', str(dur), '-i', s['src']]
        z = f"1+0.12*on/{n}" if zin else f"1.12-0.12*on/{n}"
        base = (f"[0]scale={2*W}:{2*H}:force_original_aspect_ratio=increase,crop={2*W}:{2*H}:(iw-{2*W})*{fx}:(ih-{2*H})*{fy},"
                f"zoompan=z='{z}':x='(iw-iw/zoom)*{fx}':y='(ih-ih/zoom)*{fy}':d=1:s={W}x{H}:fps={FPS},setsar=1[b]")
    fc = f"{base};{fade};[b][t]overlay=0:0:shortest=1,format=yuv420p[v]"
    cmd = ['ffmpeg', '-y', '-nostdin', *inp, '-loop', '1', '-t', str(dur), '-i', layer, '-filter_complex', fc, '-map', '[v]']
    if is_video and s.get('keepAudio'): cmd += ['-map', '0:a?', '-c:a', 'aac', '-ar', '48000', '-ac', '2']
    cmd += ['-t', str(dur), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-r', str(FPS), out]
    run(cmd); return out, dur

def build(edit, out):
    tmp = tempfile.mkdtemp(prefix='reel'); F = fonts(tmp); T = float(edit.get('transition', 0.35))
    clips = [shot_clip(i, s, tmp, F) for i, s in enumerate(edit['shots'])]
    e = edit.get('end')
    if e:
        p = os.path.join(tmp, 'end.png'); end_png(p, F, e.get('title', ''), e.get('url', 'hummusyall.com')); d = float(e.get('dur', 3.0))
        ep = os.path.join(tmp, 'end.mp4')
        run(['ffmpeg', '-y', '-nostdin', '-loop', '1', '-framerate', str(FPS), '-t', str(d), '-i', p, '-vf', 'format=yuv420p,setsar=1', '-c:v', 'libx264', '-crf', '20', '-r', str(FPS), ep])
        clips.append((ep, d))
    # video: crossfade chain
    inputs, fc, prev, offset = [], [], '0:v', 0.0
    for k, (path, d) in enumerate(clips): inputs += ['-i', path]
    for k in range(1, len(clips)):
        offset += clips[k - 1][1] - T
        lab = f'x{k}'; fc.append(f"[{prev}][{k}:v]xfade=transition=fade:duration={T}:offset={offset:.3f}[{lab}]"); prev = lab
    total = sum(d for _, d in clips) - T * (len(clips) - 1)
    # audio: original sound of keepAudio shots at their timeline position, else music, else silence
    starts, t = [], 0.0
    for k, (_, d) in enumerate(clips): starts.append(t); t += d - T
    keep = [k for k, s in enumerate(edit['shots']) if s.get('keepAudio')]
    music = edit.get('music')
    if keep:
        parts = [f"[{k}:a]adelay={int(starts[k]*1000)}|{int(starts[k]*1000)}[a{k}]" for k in keep]
        fc += parts + [f"{''.join(f'[a{k}]' for k in keep)}amix=inputs={len(keep)}:normalize=0,apad,atrim=0:{total:.3f}[aout]"]
    elif music:
        inputs += ['-i', music]
        fc.append(f"[{len(clips)}:a]atrim=0:{total:.3f},afade=t=in:d=0.5,afade=t=out:st={max(total-1.5,0):.3f}:d=1.5,volume=0.8[aout]")
    else:
        inputs += ['-f', 'lavfi', '-t', f'{total:.3f}', '-i', 'anullsrc=r=48000:cl=stereo']
        fc.append(f"[{len(clips)}:a]anull[aout]")
    run(['ffmpeg', '-y', '-nostdin', *inputs, '-filter_complex', ';'.join(fc), '-map', f'[{prev}]', '-map', '[aout]',
         '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-maxrate', '8M', '-bufsize', '16M', '-pix_fmt', 'yuv420p', '-r', str(FPS),
         '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart', '-t', f'{total:.3f}', out])
    print(json.dumps({'out': out, 'seconds': round(total, 2), 'mb': round(os.path.getsize(out) / 1e6, 1)}))

if __name__ == '__main__':
    build(json.load(open(sys.argv[1])), sys.argv[2])
