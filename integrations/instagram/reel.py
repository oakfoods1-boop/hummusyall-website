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
  "transition": 0.35,                         #   his voice stays; otherwise royalty-free music)
  "style": "brand" | "pop" | "bold" | "script" | "editorial"   # text look; shots may override with their own "style"
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
    """All fonts/*.woff2 as TTF paths, keyed by file stem (e.g. 'anton-latin-400-normal')."""
    from fontTools.ttLib import TTFont
    out = {}
    for n in os.listdir(os.path.join(HERE, 'fonts')):
        if not n.endswith('.woff2'): continue
        stem = n[:-6]; dst = os.path.join(tmp, stem + '.ttf')
        f = TTFont(os.path.join(HERE, 'fonts', n)); f.flavor = None; f.save(dst); out[stem] = dst
    alias = {'display': 'bricolage-grotesque-latin-800-normal', 'body': 'poppins-latin-600-normal', 'light': 'poppins-latin-500-normal',
             'anton': 'anton-latin-400-normal', 'archivo': 'archivo-black-latin-400-normal', 'caveat': 'caveat-latin-700-normal',
             'playfair': 'playfair-display-latin-800-italic', 'pacifico': 'pacifico-latin-400-normal'}
    for k, v in alias.items(): out[k] = out[v]
    return out

# Text looks. A reel picks one with "style" (default "brand"); any shot can override it with its own "style".
#  brand     – cream pill, olive Bricolage (website look)
#  pop       – chunky Archivo Black on bright boxes that change color every shot, slightly tilted, handwritten sub-line
#  bold      – huge white Anton capitals with a black outline, no box (good for the hook)
#  script    – white Pacifico script with a soft shadow
#  editorial – Playfair italic on a dark see-through band across the screen
POP = [('#FF5A36', '#FFFFFF'), ('#FFD23F', '#1B1B1B'), ('#2EC4B6', '#FFFFFF'), ('#FF8FAB', '#1B1B1B'), ('#3A86FF', '#FFFFFF'), ('#8AC926', '#1B1B1B')]
ENDS = {  # end-card look per style: background, title font, title color, button bg/fg, body color
    'brand': (OLIVE, 'display', CREAM, PAPRIKA, '#FFFFFF', '#F3EAD6'),
    'pop': ('#FFD23F', 'archivo', '#1B1B1B', '#FF5A36', '#FFFFFF', '#1B1B1B'),
    'bold': ('#111111', 'anton', '#FFFFFF', '#FFD23F', '#111111', '#DDDDDD'),
    'script': ('#C8502A', 'pacifico', '#FFFFFF', '#FBF6EC', '#C8502A', '#FFF3E6'),
    'editorial': ('#F4EDE4', 'playfair', '#1B1B1B', '#1B1B1B', '#FFFFFF', '#3A3A3A'),
}

def wrap(draw, text, font, maxw):
    words, lines, cur = text.split(), [], ''
    for w in words:
        t = (cur + ' ' + w).strip()
        if draw.textlength(t, font=font) <= maxw: cur = t
        else: lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines

def _block(F, style, text, sub, idx):
    """Render the text block (RGBA, tight) for one shot in the given style."""
    tmp = Image.new('RGBA', (W, 900), (0, 0, 0, 0)); d = ImageDraw.Draw(tmp); y = 20
    if style == 'pop':
        bg, fg = POP[idx % len(POP)]
        big = ImageFont.truetype(F['archivo'], 74); lines = wrap(d, text, big, W - 240) if text else []
        for l in lines:
            w = d.textlength(l, font=big) + 64
            d.rectangle([(W - w) / 2, y, (W + w) / 2, y + 104], fill=bg); d.text((W / 2, y + 54), l, font=big, fill=fg, anchor='mm'); y += 104
        if sub:
            sf = ImageFont.truetype(F['caveat'], 64); w = d.textlength(sub, font=sf) + 50
            d.rounded_rectangle([(W - w) / 2, y + 14, (W + w) / 2, y + 104], radius=16, fill='#FFFFFF'); d.text((W / 2, y + 58), sub, font=sf, fill='#1B1B1B', anchor='mm'); y += 110
        return tmp.crop((0, 0, W, y + 20)), (-3 if idx % 2 else 2.5)
    if style == 'bold':
        big = ImageFont.truetype(F['anton'], 132); lines = wrap(d, (text or '').upper(), big, W - 160)
        for l in lines:
            d.text((W / 2, y + 70), l, font=big, fill='#FFFFFF', anchor='mm', stroke_width=7, stroke_fill='#111111'); y += 140
        if sub:
            sf = ImageFont.truetype(F['body'], 44); w = d.textlength(sub, font=sf) + 50
            d.rectangle([(W - w) / 2, y + 6, (W + w) / 2, y + 80], fill='#FFD23F'); d.text((W / 2, y + 44), sub, font=sf, fill='#111111', anchor='mm'); y += 90
        return tmp.crop((0, 0, W, y + 20)), 0
    if style == 'script':
        big = ImageFont.truetype(F['pacifico'], 84); lines = wrap(d, text or '', big, W - 200)
        sh = Image.new('RGBA', tmp.size, (0, 0, 0, 0)); sd = ImageDraw.Draw(sh); yy = y
        for l in lines: sd.text((W / 2 + 4, yy + 64), l, font=big, fill=(0, 0, 0, 170), anchor='mm'); yy += 120
        from PIL import ImageFilter
        tmp.alpha_composite(sh.filter(ImageFilter.GaussianBlur(6))); d = ImageDraw.Draw(tmp)
        for l in lines: d.text((W / 2, y + 60), l, font=big, fill='#FFFFFF', anchor='mm'); y += 120
        if sub:
            sf = ImageFont.truetype(F['body'], 42); d.text((W / 2, y + 30), sub, font=sf, fill='#FFFFFF', anchor='mm', stroke_width=3, stroke_fill='#00000088'); y += 70
        return tmp.crop((0, 0, W, y + 20)), 0
    if style == 'editorial':
        big = ImageFont.truetype(F['playfair'], 80); lines = wrap(d, text or '', big, W - 180)
        h = len(lines) * 96 + (64 if sub else 0) + 50
        d.rectangle([0, y, W, y + h], fill=(15, 15, 15, 165)); yy = y + 30
        for l in lines: d.text((W / 2, yy + 44), l, font=big, fill='#FFFFFF', anchor='mm'); yy += 96
        if sub: d.text((W / 2, yy + 26), sub, font=ImageFont.truetype(F['light'], 38), fill='#FFD9A8', anchor='mm')
        return tmp.crop((0, 0, W, y + h + 20)), 0
    # brand
    big = ImageFont.truetype(F['display'], 78); small = ImageFont.truetype(F['body'], 40)
    lines = wrap(d, text, big, W - 220) if text else []
    if lines:
        bw = max(d.textlength(l, font=big) for l in lines) + 88; bh = len(lines) * 88 + 50
        d.rounded_rectangle([(W - bw) / 2, y, (W + bw) / 2, y + bh], radius=34, fill=CREAM)
        for i, l in enumerate(lines): d.text((W / 2, y + 30 + i * 88 + 38), l, font=big, fill=OLIVE, anchor='mm')
        y += bh + 18
    if sub:
        sw = d.textlength(sub, font=small) + 60
        d.rounded_rectangle([(W - sw) / 2, y, (W + sw) / 2, y + 76], radius=38, fill=LIME); d.text((W / 2, y + 40), sub, font=small, fill=INK, anchor='mm'); y += 76
    return tmp.crop((0, 0, W, y + 20)), 0

def text_png(path, F, text, sub=None, pos='low', style='brand', idx=0):
    """Transparent 1080x1920 layer with the shot's text in the chosen style."""
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    if text or sub:
        block, angle = _block(F, style, text, sub, idx)
        if angle: block = block.rotate(angle, resample=Image.BICUBIC, expand=True)
        y = 1180 if pos != 'high' else 330
        y = min(y, 1520 - block.height)            # keep clear of Instagram's caption/buttons area
        img.alpha_composite(block, ((W - block.width) // 2, max(y, 200)))
    img.save(path)

def end_png(path, F, title, url, style='brand'):
    bg, tfont, tcol, bbg, bfg, bodyc = ENDS.get(style, ENDS['brand'])
    img = Image.new('RGB', (W, H), bg); d = ImageDraw.Draw(img)
    logo = Image.open(os.path.join(ROOT, 'public/img/logo.webp')).convert('RGBA').resize((300, 300))
    mask = Image.new('L', (300, 300), 0); ImageDraw.Draw(mask).ellipse([0, 0, 299, 299], fill=255)
    img.paste(logo, ((W - 300) // 2, 500), mask)
    name = "HUMMUS Y'ALL" if style == 'bold' else "Hummus Y'all"
    d.text((W / 2, 920), name, font=ImageFont.truetype(F[tfont], 104 if style in ('bold', 'script') else 96), fill=tcol, anchor='mm')
    body = ImageFont.truetype(F['light'], 44)
    for i, l in enumerate(wrap(d, title, body, W - 200)):
        d.text((W / 2, 1050 + i * 60), l, font=body, fill=bodyc, anchor='mm')
    bf = ImageFont.truetype(F['body'], 52); bw = d.textlength(url, font=bf) + 100
    d.rounded_rectangle([(W - bw) / 2, 1190, (W + bw) / 2, 1300], radius=55 if style != 'pop' else 8, fill=bbg)
    d.text((W / 2, 1246), url, font=bf, fill=bfg, anchor='mm')
    img.save(path)

def shot_clip(i, s, tmp, F, style='brand'):
    out = os.path.join(tmp, f'shot{i:02d}.mp4'); dur = float(s.get('dur', 2.4)); n = int(round(dur * FPS))
    layer = os.path.join(tmp, f'text{i:02d}.png'); text_png(layer, F, s.get('text'), s.get('sub'), s.get('textPos', 'low'), s.get('style', style), i)
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
    style = edit.get('style', 'brand')
    clips = [shot_clip(i, s, tmp, F, style) for i, s in enumerate(edit['shots'])]
    e = edit.get('end')
    if e:
        p = os.path.join(tmp, 'end.png'); end_png(p, F, e.get('title', ''), e.get('url', 'hummusyall.com'), e.get('style', style)); d = float(e.get('dur', 3.0))
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
