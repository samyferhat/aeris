"""Run with system python3 (has PIL): gauge atlas + registration decal."""
from PIL import Image, ImageDraw, ImageFont
import math, os
OUT = '/Users/samy/Documents/dev/code/aeris/blender/textures'
os.makedirs(OUT, exist_ok=True)
FONT = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
FONT2 = '/System/Library/Fonts/Supplemental/Arial.ttf'
if not os.path.exists(FONT): FONT = '/System/Library/Fonts/Helvetica.ttc'
if not os.path.exists(FONT2): FONT2 = FONT

# ---------- gauge atlas 2048x2048, 3x2 grid of 682px tiles (top row: ASI, AI, ALT ; bottom: TC, HDG, VSI)
S = 2048; T = S // 3
img = Image.new('RGBA', (S, S), (10, 10, 10, 255))
d = ImageDraw.Draw(img)
def font(sz, bold=True): return ImageFont.truetype(FONT if bold else FONT2, sz)
def tick(cx, cy, r, ang_deg, length, width, fill=(240,240,240)):
    a = math.radians(ang_deg)
    x0 = cx + (r - length) * math.sin(a); y0 = cy - (r - length) * math.cos(a)
    x1 = cx + r * math.sin(a); y1 = cy - r * math.cos(a)
    d.line((x0, y0, x1, y1), fill=fill, width=width)
def label(cx, cy, r, ang_deg, text, sz, fill=(240,240,240), bold=True):
    a = math.radians(ang_deg); f = font(sz, bold)
    x = cx + r * math.sin(a); y = cy - r * math.cos(a)
    bb = d.textbbox((0,0), text, font=f)
    d.text((x - (bb[2]-bb[0])/2, y - (bb[3]-bb[1])/2 - bb[1]), text, font=f, fill=fill)
def face(col, row, draw_fn):
    cx = col * T + T/2; cy = row * T + T/2; R = T * 0.47
    d.ellipse((cx-R, cy-R, cx+R, cy+R), fill=(12,12,12), outline=(60,60,60), width=4)
    draw_fn(cx, cy, R)
def needle(cx, cy, r, ang, w=10, fill=(245,245,245), tail=0.18):
    a = math.radians(ang)
    x1 = cx + r*math.sin(a); y1 = cy - r*math.cos(a)
    x0 = cx - r*tail*math.sin(a); y0 = cy + r*tail*math.cos(a)
    d.line((x0,y0,x1,y1), fill=fill, width=w)
    d.ellipse((cx-w*1.3, cy-w*1.3, cx+w*1.3, cy+w*1.3), fill=(30,30,30), outline=fill, width=3)

def asi(cx, cy, R):  # airspeed 0..200 kt over 320 deg
    def ang(v): return -160 + v/200*320 if v > 0 else -160
    # arcs
    def arc(v0, v1, col, w):
        d.arc((cx-R*0.86, cy-R*0.86, cx+R*0.86, cy+R*0.86), start=ang(v0)-90, end=ang(v1)-90, fill=col, width=w)
    arc(40, 85, (240,240,240), 14); arc(48, 129, (40,200,60), 14); arc(129, 163, (250,210,30), 14); arc(163, 166, (230,40,40), 20)
    for v in range(0, 201, 10):
        tick(cx, cy, R*0.9, ang(v), R*0.12 if v % 20 == 0 else R*0.07, 6 if v % 20 == 0 else 4)
        if v % 20 == 0 and v > 0: label(cx, cy, R*0.66, ang(v), str(v), int(R*0.16))
    label(cx, cy, R*0.35, 0, 'AIRSPEED', int(R*0.11)); label(cx, cy, R*0.22, 0, 'KNOTS', int(R*0.09), bold=False)
    needle(cx, cy, R*0.85, ang(0))
def ai(cx, cy, R):  # attitude indicator
    d.pieslice((cx-R*0.92, cy-R*0.92, cx+R*0.92, cy+R*0.92), 180, 360, fill=(40,110,200))
    d.pieslice((cx-R*0.92, cy-R*0.92, cx+R*0.92, cy+R*0.92), 0, 180, fill=(110,70,30))
    d.line((cx-R*0.92, cy, cx+R*0.92, cy), fill=(250,250,250), width=5)
    for p, w in ((10, 0.18), (20, 0.30), (-10, 0.18), (-20, 0.30)):
        yy = cy - p/20*R*0.42
        d.line((cx-R*w, yy, cx+R*w, yy), fill=(250,250,250), width=4)
        label(cx - R*w - R*0.09, yy, 0, 0, str(abs(p)), int(R*0.09))
    for a in (-60,-30,-20,-10,0,10,20,30,60):
        tick(cx, cy, R*0.92, a, R*0.1 if a % 30 == 0 else R*0.06, 6)
    # miniature airplane
    d.line((cx-R*0.45, cy, cx-R*0.15, cy), fill=(255,180,0), width=10); d.line((cx+R*0.15, cy, cx+R*0.45, cy), fill=(255,180,0), width=10)
    d.ellipse((cx-R*0.05, cy-R*0.05, cx+R*0.05, cy+R*0.05), outline=(255,180,0), width=8)
    d.polygon((cx, cy-R*0.86, cx-R*0.06, cy-R*0.74, cx+R*0.06, cy-R*0.74), fill=(255,180,0))
def alt(cx, cy, R):
    for i in range(50):
        a = i * 7.2
        tick(cx, cy, R*0.9, a, R*0.12 if i % 5 == 0 else R*0.06, 6 if i % 5 == 0 else 3)
        if i % 5 == 0: label(cx, cy, R*0.68, a, str(i//5), int(R*0.18))
    label(cx, cy, R*0.4, 0, 'ALT', int(R*0.12)); label(cx, cy, R*0.28, 0, 'FEET', int(R*0.09), bold=False)
    d.rectangle((cx+R*0.25, cy-R*0.08, cx+R*0.62, cy+R*0.08), fill=(20,20,20), outline=(200,200,200), width=3)
    label(cx+R*0.435, cy, 0, 0, '29.92', int(R*0.11))
    needle(cx, cy, R*0.55, 0, 14); needle(cx, cy, R*0.85, 0, 8)
def tc(cx, cy, R):
    for a in (-90, -70, 70, 90):
        tick(cx, cy, R*0.62, a, R*0.12, 8)
    label(cx, cy, R*0.75, -70, 'L', int(R*0.12)); label(cx, cy, R*0.75, 70, 'R', int(R*0.12))
    # airplane symbol
    d.line((cx-R*0.62, cy, cx+R*0.62, cy), fill=(245,245,245), width=12)
    d.ellipse((cx-R*0.1, cy-R*0.1, cx+R*0.1, cy+R*0.1), fill=(245,245,245))
    d.polygon((cx, cy-R*0.3, cx-R*0.05, cy, cx+R*0.05, cy), fill=(245,245,245))
    d.line((cx, cy, cx, cy+R*0.18), fill=(245,245,245), width=10); d.line((cx-R*0.12, cy+R*0.18, cx+R*0.12, cy+R*0.18), fill=(245,245,245), width=8)
    label(cx, cy, R*0.45, 0, 'TURN COORDINATOR', int(R*0.075), bold=False)
    # inclinometer
    d.rounded_rectangle((cx-R*0.55, cy+R*0.45, cx+R*0.55, cy+R*0.65), radius=int(R*0.1), fill=(200,200,200))
    d.ellipse((cx-R*0.09, cy+R*0.46, cx+R*0.09, cy+R*0.64), fill=(20,20,20))
    d.line((cx-R*0.1, cy+R*0.45, cx-R*0.1, cy+R*0.65), fill=(20,20,20), width=4); d.line((cx+R*0.1, cy+R*0.45, cx+R*0.1, cy+R*0.65), fill=(20,20,20), width=4)
    label(cx, cy, -R*0.8, 0, '2 MIN', int(R*0.08), bold=False)
def hdg(cx, cy, R):
    for i in range(72):
        a = i * 5
        tick(cx, cy, R*0.92, a, R*0.12 if i % 2 == 0 else R*0.06, 6 if i % 2 == 0 else 3)
        if i % 6 == 0:
            t = {0:'N', 9:'E', 18:'S', 27:'W'}.get(i//1 and i//3 * 0 + i//3 if False else i//3, None)
            txt = {0:'N', 3:'E', 6:'S', 9:'W'}.get(i//6 % 12 if False else (i//6), None)
            txt = {0:'N', 3:'E', 6:'S', 9:'W'}.get(i//6, str(i*5//10))
            label(cx, cy, R*0.7, a, txt, int(R*0.16) if txt in 'NESW' else int(R*0.13))
    # fixed airplane
    d.polygon((cx, cy-R*0.5, cx-R*0.04, cy-R*0.1, cx-R*0.35, cy+R*0.05, cx-R*0.35, cy+R*0.12, cx-R*0.04, cy+R*0.05, cx-R*0.04, cy+R*0.3, cx-R*0.15, cy+R*0.4, cx-R*0.15, cy+R*0.45, cx+R*0.15, cy+R*0.45, cx+R*0.15, cy+R*0.4, cx+R*0.04, cy+R*0.3, cx+R*0.04, cy+R*0.05, cx+R*0.35, cy+R*0.12, cx+R*0.35, cy+R*0.05, cx+R*0.04, cy-R*0.1), fill=(255,150,0))
    d.polygon((cx, cy-R*0.97, cx-R*0.06, cy-R*0.85, cx+R*0.06, cy-R*0.85), fill=(255,255,255))
def vsi(cx, cy, R):
    def ang(v): return -90 + v/2000*170  # -2000..+2000 fpm, 0 at left (-90)
    for v in range(-2000, 2001, 100):
        a = ang(v)
        tick(cx, cy, R*0.9, a, R*0.12 if v % 500 == 0 else R*0.06, 6 if v % 500 == 0 else 3)
        if v % 500 == 0: label(cx, cy, R*0.68, a, str(abs(v)//100), int(R*0.17))
    label(cx, cy, R*0.35, 0, 'VERTICAL SPEED', int(R*0.08), bold=False)
    label(cx, cy, R*0.4, 60, 'UP', int(R*0.1)); label(cx, cy, R*0.4, -240, 'DOWN', int(R*0.1))
    label(cx, cy, R*0.2, 0, '100 FEET PER MINUTE', int(R*0.06), bold=False)
    needle(cx, cy, R*0.85, ang(0))
face(0, 0, asi); face(1, 0, ai); face(2, 0, alt); face(0, 1, tc); face(1, 1, hdg); face(2, 1, vsi)
# bottom third: radio displays strip (row 2)
d.rectangle((0, 2*T, S, S), fill=(14,14,14))
f = font(int(T*0.28))
for i, (txt, col) in enumerate((('118.30', (255,150,20)), ('121.50', (255,150,20)), ('4521', (255,150,20)))):
    x0 = i*T + T*0.08; y0 = 2*T + T*0.2
    d.rectangle((x0, y0, x0 + T*0.84, y0 + T*0.55), fill=(4,4,4), outline=(70,70,70), width=4)
    bb = d.textbbox((0,0), txt, font=f)
    d.text((x0 + T*0.42 - (bb[2]-bb[0])/2, y0 + T*0.27 - (bb[3]-bb[1])/2 - bb[1]), txt, font=f, fill=col)
img.convert('RGB').save(os.path.join(OUT, 'gauges.png'))

# ---------- registration decal: black text on transparent (alpha = coverage)
reg = Image.new('L', (1400, 300), 0)
dr = ImageDraw.Draw(reg)
f = font(250)
bb = dr.textbbox((0,0), 'F-AERI', font=f)
dr.text(((1400 - (bb[2]-bb[0]))/2 - bb[0], (300 - (bb[3]-bb[1]))/2 - bb[1]), 'F-AERI', font=f, fill=255)
reg.save(os.path.join(OUT, 'reg_mask.png'))
print('ok', bb)
