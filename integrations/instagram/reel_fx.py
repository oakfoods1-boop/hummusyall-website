#!/usr/bin/env python3
"""Effects-heavy "fx" reel: beat-synced hard cuts, zoom punches, flashes, whip blurs, RGB glitch,
speed ramps, split screen, kinetic word-by-word text, a spinning sticker, colour grade and grain.

  python3 reel_fx.py edit.json out.mp4

edit.json:
{
  "bpm": 152, "music": "integrations/instagram/music/mixkit-okay.mp3", "musicStart": 26.56,
  "accent": ["#FF3D7F", "#00C2FF", "#FFB800"],          # text shadow colours, rotate per shot
  "shots": [
    {"src": "clip.mp4", "start": 3.0, "beats": 4,       # length in beats (cuts land on the beat)
     "speed": 1.0,                                       # <1 slow motion (frame-interpolated), >1 fast
     "in": "punch" | "flash" | "whip" | "glitch" | "none",
     "text": "IT'S MARKET DAY", "hl": "MARKET",          # words pop in one by one; hl word gets a yellow box
     "sub": "optional handwritten tag", "textPos": "low" | "high" | "mid",
     "focus": [0.5, 0.5],
     "split": [{"src": "a.mp4", "start": 1}, ...],       # optional: 3 vertical strips popping in on the beat
     "sticker": "label.jpg", "blur": true}               # optional: round sticker spins in over a blurred shot
  ],
  "end": {"title": "Order online for Sunday delivery or pickup", "url": "hummusyall.com", "beats": 8}
}
Uses fonts / logo from this repo like reel.py.
"""
import json, math, os, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont, ImageFilter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from reel import fonts, wrap, run, ROOT, W, H, FPS

GRADE = "eq=contrast=1.10:saturation=1.32:brightness=0.015,colorbalance=rs=0.05:gs=0.01:bs=-0.05:rm=0.03:bm=-0.03,vignette=angle=PI/4.6,noise=alls=7:allf=t"
YELLOW, INK = '#FFE14D', '#141414'

def ease_back(x):  # overshoot ease-out, 0..1
    x = min(max(x, 0), 1); c1 = 1.9; c3 = c1 + 1
    return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2

# ---------- per-frame overlay (kinetic text + sticker) ----------
def text_frames(F, s, n, B, accent, outdir):
    words = (s.get('text') or '').split()
    big = ImageFont.truetype(F['anton'], 150 if len(words) <= 3 else 128)
    d0 = ImageDraw.Draw(Image.new('RGBA', (10, 10)))
    lines = wrap(d0, ' '.join(words).upper(), big, W - 150) if words else []
    lh = int(big.size * 1.12)
    pos = s.get('textPos', 'low')
    total_h = len(lines) * lh + (110 if s.get('sub') else 0)
    y0 = {'high': 300, 'mid': (H - total_h) // 2}.get(pos, min(1180, 1500 - total_h))
    # word boxes in final layout
    boxes, k = [], 0
    for li, l in enumerate(lines):
        ws = l.split(); sp = d0.textlength(' ', font=big)
        lw = sum(d0.textlength(w, font=big) for w in ws) + sp * (len(ws) - 1); x = (W - lw) / 2
        for w in ws:
            tw = d0.textlength(w, font=big); boxes.append((w, x + tw / 2, y0 + li * lh + lh / 2, tw)); x += tw + sp; k += 1
    hl = (s.get('hl') or '').upper().split()
    step = max(3, min(int(round(B * FPS / 2)), int(0.5 * n / max(1, len(boxes)))))  # a new word every half beat (faster for long lines)
    sticker = None
    if s.get('sticker'):
        im = Image.open(s['sticker']).convert('RGBA'); D = 640
        im = im.resize((D, D), Image.LANCZOS); m = Image.new('L', (D, D), 0); ImageDraw.Draw(m).ellipse([4, 4, D - 5, D - 5], fill=255)
        im.putalpha(m); ring = Image.new('RGBA', (D + 36, D + 36), (0, 0, 0, 0)); ImageDraw.Draw(ring).ellipse([0, 0, D + 35, D + 35], fill='#FFFFFF')
        ring.alpha_composite(im, (18, 18)); sticker = ring
    sub = s.get('sub'); sf = ImageFont.truetype(F['caveat'], 74)
    for f in range(n):
        img = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
        if sticker is not None:
            p = ease_back(f / 14); ang = -200 * (1 - min(f / 14, 1)) - 7 + 2.5 * math.sin(f / 7)
            sz = max(2, int(sticker.width * (0.15 + 0.85 * p))); st = sticker.resize((sz, sz), Image.LANCZOS).rotate(ang, Image.BICUBIC, expand=True)
            sh = Image.new('RGBA', st.size, (0, 0, 0, 0)); sh.putalpha(st.getchannel('A').point(lambda a: a * 0.55)); sh = sh.filter(ImageFilter.GaussianBlur(18))
            cy = 760 + int(10 * math.sin(f / 9))
            img.alpha_composite(sh, (W // 2 - st.width // 2 + 18, cy - st.height // 2 + 26)); img.alpha_composite(st, (W // 2 - st.width // 2, cy - st.height // 2))
        delay = 10 if sticker is not None else 2
        for i, (w, cx, cy, tw) in enumerate(boxes):
            t0 = delay + i * step
            if f < t0: continue
            p = ease_back((f - t0) / 6); sc = 0.35 + 0.65 * p
            fnt = ImageFont.truetype(F['anton'], max(8, int(big.size * sc)))
            is_hl = w.strip('.,!?') in hl
            if is_hl:
                ww = d.textlength(w, font=fnt) + 36; hh = fnt.size * 1.02
                d.rectangle([cx - ww / 2, cy - hh / 2, cx + ww / 2, cy + hh / 2], fill=YELLOW)
                d.text((cx, cy), w, font=fnt, fill=INK, anchor='mm')
            else:
                o = max(3, int(11 * sc))
                d.text((cx + o, cy + o), w, font=fnt, fill=accent, anchor='mm')
                d.text((cx, cy), w, font=fnt, fill='#FFFFFF', anchor='mm', stroke_width=2, stroke_fill=INK)
        if sub:
            t0 = delay + len(boxes) * step + 3
            if f >= t0:
                p = ease_back((f - t0) / 7); tw = d.textlength(sub, font=sf) + 60
                tag = Image.new('RGBA', (int(tw), 104), (0, 0, 0, 0)); td = ImageDraw.Draw(tag)
                td.rounded_rectangle([0, 0, tw - 1, 103], radius=14, fill='#FFFFFF'); td.text((tw / 2, 50), sub, font=sf, fill=INK, anchor='mm')
                tag = tag.rotate(-3, Image.BICUBIC, expand=True)
                ty = (y0 + len(lines) * lh + 10) + int(60 * (1 - p)) if boxes else (1300 if sticker is not None else 1200)
                a = tag.getchannel('A').point(lambda v: int(v * min(1, p))); tag.putalpha(a)
                img.alpha_composite(tag, ((W - tag.width) // 2, int(ty)))
        img.save(os.path.join(outdir, f'{f:04d}.png'), compress_level=1)

# ---------- one shot ----------
def base_chain(src_label, fx, fy, n, speed, punch):
    z = f"1.0+0.05*on/{n}" + ("+0.22*max(0\\,1-on/7)" if punch else "")
    ch = f"[{src_label}]"
    if speed and speed < 1:
        ch += f"scale=540:960:force_original_aspect_ratio=increase,crop=540:960,setpts=PTS/{speed},minterpolate=fps={FPS}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir,"
    elif speed and speed > 1:
        ch += f"setpts=PTS/{speed},fps={FPS},"
    ch += (f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}:(iw-{W})*{fx}:(ih-{H})*{fy},fps={FPS},setsar=1,"
           f"zoompan=z='{z}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=1:s={W}x{H}:fps={FPS}")
    return ch

def shot_clip(i, s, tmp, F, B, accent):
    dur = s['beats'] * B; n = int(round(dur * FPS)); out = os.path.join(tmp, f'shot{i:02d}.mp4')
    fdir = os.path.join(tmp, f'txt{i:02d}'); os.makedirs(fdir, exist_ok=True)
    text_frames(F, s, n, B, accent, fdir)
    fx, fy = s.get('focus', [0.5, 0.5]); speed = s.get('speed', 1.0); fxin = s.get('in', 'punch')
    inp, fc = [], []
    if s.get('split'):
        parts = s['split']
        for j, p in enumerate(parts):
            inp += ['-ss', str(p.get('start', 0)), '-t', str(dur + 0.2), '-i', p['src']]
        sw = W // len(parts)
        fc.append(f"color=c=#111111:s={W}x{H}:r={FPS}:d={dur:.3f}[bg0]")
        for j, p in enumerate(parts):
            pf = p.get('focus', [0.5, 0.5])
            fc.append(f"[{j}:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},crop={sw}:{H}:(iw-{sw})*{pf[0]}:0,fps={FPS},setsar=1,{GRADE}[p{j}]")
            st = j * B * 2 / 2  # one strip per beat
            fc.append(f"[bg{j}][p{j}]overlay=x='{j*sw}+({sw})*max(0\\,1-(t-{st:.3f})/0.12)*0':y='-{H}*max(0\\,1-(t-{st:.3f})/0.14)':enable='gte(t,{st:.3f})':shortest=0[bg{j+1}]")
        last = f"bg{len(parts)}"
        lines = ''.join(f",drawbox=x={k*sw-4}:y=0:w=8:h={H}:color=white:t=fill" for k in range(1, len(parts)))
        fc.append(f"[{last}]trim=duration={dur:.3f}{lines}[b]")
        ti = len(parts)
    else:
        take = dur * (speed or 1) + 0.1
        is_video = os.path.splitext(s['src'])[1].lower() in ('.mp4', '.mov', '.m4v')
        inp += (['-ss', str(s.get('start', 0)), '-t', f'{take:.3f}', '-i', s['src']] if is_video
                else ['-loop', '1', '-framerate', str(FPS), '-t', f'{dur:.3f}', '-i', s['src']])
        ch = base_chain('0:v', fx, fy, n, speed if is_video else 1, fxin == 'punch') + ',' + GRADE
        if s.get('blur'): ch += ",gblur=sigma=22,eq=brightness=-0.12"
        fc.append(ch + f",trim=end_frame={n}[b]"); ti = 1
    inp += ['-framerate', str(FPS), '-i', os.path.join(fdir, '%04d.png')]
    post = "[b]"
    effects = []
    if fxin == 'flash': effects.append("fade=t=in:st=0:d=0.16:color=white")
    if fxin == 'punch': effects.append("fade=t=in:st=0:d=0.07:color=white")
    if fxin == 'whip': effects.append("avgblur=sizeX=70:sizeY=1:enable='lt(t,0.14)'")
    if fxin == 'glitch': effects.append("rgbashift=rh=-28:bh=28:gv=8:enable='lt(t,0.30)+between(t,0.55,0.62)'")
    if effects: fc.append(f"[b]{','.join(effects)}[b2]"); post = "[b2]"
    fc.append(f"{post}[{ti}:v]overlay=0:0:shortest=1,format=yuv420p[v]")
    run(['ffmpeg', '-y', '-nostdin', *inp, '-filter_complex', ';'.join(fc), '-map', '[v]', '-frames:v', str(n),
         '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-r', str(FPS), out])
    return out, n / FPS

def end_clip(e, tmp, F, B):
    dur = e.get('beats', 8) * B; n = int(round(dur * FPS)); fdir = os.path.join(tmp, 'end'); os.makedirs(fdir, exist_ok=True)
    logo = Image.open(os.path.join(ROOT, 'public/img/logo.webp')).convert('RGBA').resize((320, 320))
    m = Image.new('L', (320, 320), 0); ImageDraw.Draw(m).ellipse([0, 0, 319, 319], fill=255); logo.putalpha(m)
    ring = Image.new('RGBA', (344, 344), (0, 0, 0, 0)); ImageDraw.Draw(ring).ellipse([0, 0, 343, 343], fill='#FFFFFF'); ring.alpha_composite(logo, (12, 12))
    # gradient background magenta -> orange
    g = Image.new('RGB', (1, H)); top, bot = (255, 61, 127), (255, 168, 38)
    for y in range(H):
        t = y / (H - 1); g.putpixel((0, y), tuple(int(top[c] + (bot[c] - top[c]) * t) for c in range(3)))
    g = g.resize((W, H))
    name = ImageFont.truetype(F['anton'], 160); body = ImageFont.truetype(F['body'], 46); urlf = ImageFont.truetype(F['archivo'], 60)
    words = ["HUMMUS", "Y'ALL"]
    for f in range(n):
        img = g.copy().convert('RGBA')
        # moving diagonal stripes (subtle)
        st = Image.new('RGBA', (W, H), (0, 0, 0, 0)); sd = ImageDraw.Draw(st)
        for k in range(-6, 14):
            x = k * 180 + (f * 6) % 180
            sd.polygon([(x, 0), (x + 60, 0), (x + 60 - 700, H), (x - 700, H)], fill=(255, 255, 255, 30))
        img.alpha_composite(st); d = ImageDraw.Draw(img)
        p = ease_back(f / 10); sz = max(2, int(344 * p)); lg = ring.resize((sz, sz), Image.LANCZOS).rotate(-20 * (1 - min(f / 10, 1)), Image.BICUBIC)
        img.alpha_composite(lg, (W // 2 - sz // 2, 520 - sz // 2))
        for i, w in enumerate(words):
            t0 = 6 + i * 5
            if f < t0: continue
            q = ease_back((f - t0) / 6); fnt = ImageFont.truetype(F['anton'], max(8, int(160 * (0.4 + 0.6 * q))))
            cy = 860 + i * 175
            d.text((W / 2 + 12, cy + 12), w, font=fnt, fill='#7A1238', anchor='mm'); d.text((W / 2, cy), w, font=fnt, fill='#FFFFFF', anchor='mm')
        if f >= 18:
            a = min(1, (f - 18) / 6)
            for i, l in enumerate(wrap(d, e.get('title', ''), body, W - 200)):
                yy = 1150 + i * 62 + int(30 * (1 - a))
                d.text((W / 2 + 3, yy + 3), l, font=body, fill=(122, 18, 56, int(255 * a)), anchor='mm')
                d.text((W / 2, yy), l, font=body, fill=(255, 255, 255, int(255 * a)), anchor='mm')
        if f >= 24:
            q = ease_back((f - 24) / 7); url = e.get('url', 'hummusyall.com'); bw = d.textlength(url, font=urlf) + 110
            yy = 1330 + int(120 * (1 - q)); pulse = 1 + 0.03 * math.sin(f / 3) if f > 34 else 1
            bw2 = bw * pulse
            d.rectangle([W / 2 - bw2 / 2 + 10, yy + 10, W / 2 + bw2 / 2 + 10, yy + 130], fill=INK)
            d.rectangle([W / 2 - bw2 / 2, yy, W / 2 + bw2 / 2, yy + 120], fill=YELLOW)
            d.text((W / 2, yy + 60), url, font=urlf, fill=INK, anchor='mm')
        img.convert('RGB').save(os.path.join(fdir, f'{f:04d}.png'), compress_level=1)
    out = os.path.join(tmp, 'end.mp4')
    run(['ffmpeg', '-y', '-nostdin', '-framerate', str(FPS), '-i', os.path.join(fdir, '%04d.png'), '-vf', "fade=t=in:st=0:d=0.12:color=white,format=yuv420p",
         '-c:v', 'libx264', '-crf', '18', '-r', str(FPS), out])
    return out, n / FPS

def build(edit, out):
    tmp = tempfile.mkdtemp(prefix='reelfx'); F = fonts(tmp); B = 60.0 / float(edit.get('bpm', 120))
    acc = edit.get('accent', ['#FF3D7F', '#00C2FF', '#FFB800'])
    clips = [shot_clip(i, s, tmp, F, B, acc[i % len(acc)]) for i, s in enumerate(edit['shots'])]
    if edit.get('end'): clips.append(end_clip(edit['end'], tmp, F, B))
    total = sum(d for _, d in clips)
    lst = os.path.join(tmp, 'list.txt'); open(lst, 'w').write(''.join(f"file '{p}'\n" for p, _ in clips))
    cat = os.path.join(tmp, 'cat.mp4'); run(['ffmpeg', '-y', '-nostdin', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', cat])
    ms = float(edit.get('musicStart', 0)); music = edit['music'] if os.path.exists(edit['music']) else os.path.join(ROOT, edit['music'])
    run(['ffmpeg', '-y', '-nostdin', '-i', cat, '-ss', f'{ms:.3f}', '-t', f'{total:.3f}', '-i', music,
         '-filter_complex', f"[1:a]afade=t=in:d=0.08,afade=t=out:st={max(total-1.2,0):.3f}:d=1.2,volume=0.85[a]",
         '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-maxrate', '6.5M', '-bufsize', '13M',
         '-pix_fmt', 'yuv420p', '-r', str(FPS), '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart', '-t', f'{total:.3f}', out])
    print(json.dumps({'out': out, 'seconds': round(total, 2), 'mb': round(os.path.getsize(out) / 1e6, 1)}))

if __name__ == '__main__':
    build(json.load(open(sys.argv[1])), sys.argv[2])
