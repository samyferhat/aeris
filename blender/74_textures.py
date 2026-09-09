import numpy as np, os, math
from PIL import Image
OUT = '/Users/samy/Documents/dev/code/aeris/blender/textures'
SIZE = int(globals().get('BAKE_SIZE', 2048))
d = np.load(os.path.join(OUT, 'bake_%d.npz' % SIZE))
pos = d['pos'][..., :3].astype(np.float32); nrm = d['nrm'][..., :3].astype(np.float32)
idm = np.rint(d['idm'][..., 0] * 255).astype(np.int32); ao = np.clip(d['ao'][..., 0], 0, 1).astype(np.float32)
cov = d['pos'][..., 3] > 0.5
x, y, z = pos[..., 0], pos[..., 1], pos[..., 2]
nx, ny, nz = nrm[..., 0], nrm[..., 1], nrm[..., 2]
ax = np.abs(x)

def hash3(ix, iy, iz):
    h = (ix.astype(np.int64) * 1619 + iy.astype(np.int64) * 31337 + iz.astype(np.int64) * 6971) & 0x7fffffff
    h = ((h ^ (h >> 13)) * 1274126177) & 0x7fffffff
    return (((h ^ (h >> 16)) & 0xffff) / 65535.0).astype(np.float32)
def vnoise(p):
    i = np.floor(p); f = p - i; f = f * f * (3 - 2 * f)
    ix, iy, iz = i[..., 0].astype(np.int64), i[..., 1].astype(np.int64), i[..., 2].astype(np.int64)
    fx, fy, fz = f[..., 0], f[..., 1], f[..., 2]
    def c(dx, dy, dz): return hash3(ix + dx, iy + dy, iz + dz)
    x0 = c(0,0,0)*(1-fx) + c(1,0,0)*fx; x1 = c(0,1,0)*(1-fx) + c(1,1,0)*fx
    x2 = c(0,0,1)*(1-fx) + c(1,0,1)*fx; x3 = c(0,1,1)*(1-fx) + c(1,1,1)*fx
    y0 = x0*(1-fy) + x1*fy; y1 = x2*(1-fy) + x3*fy
    return y0*(1-fz) + y1*fz
def fbm(freq, octaves=4, seed=0.0):
    out = np.zeros_like(x); amp = 0.5; f = freq; tot = 0
    for o in range(octaves):
        out += amp * vnoise(pos * f + seed + 17.3 * o); tot += amp; amp *= 0.5; f *= 2.1
    return out / tot
def smooth(v, lo, hi): return np.clip((v - lo) / (hi - lo), 0, 1)

is_fus = idm == 1; is_wing = (idm >= 2) & (idm <= 6); is_elev = idm == 7; is_rud = idm == 8; is_gear = idm >= 9
fin_reg = (is_fus & (y > 4.15) & (z > 0.50) & (ax < 0.12)) | is_rud
stab_reg = (is_fus & (y > 4.6) & (ax > 0.12) & (z < 0.5)) | is_elev
side_w = smooth(np.abs(nx), 0.3, 0.7)

# ---------------- height (rivets, panel lines)
lat = z * side_w + x * (1 - side_w)
def dots(a, b, sa, sb, r):
    da = (a / sa - np.round(a / sa)) * sa; db = (b / sb - np.round(b / sb)) * sb
    return np.exp(-(da*da + db*db) / (2*r*r))
R_RIV = 0.0045
riv = np.zeros_like(x)
riv += dots(y, lat + 0.15, 0.05, 0.30, R_RIV) * (is_fus & ~stab_reg & (y > -2.3))
riv += dots(y, x, 0.05, 0.40, R_RIV) * is_wing * (ax > 0.7)
riv += (np.exp(-((y - 0.02)**2) / (2*0.004**2)) + np.exp(-((y - 0.86)**2) / (2*0.004**2))) * dots(x, np.zeros_like(x), 0.05, 1e9, R_RIV) * is_wing
riv += dots(y, x, 0.05, 0.35, R_RIV) * stab_reg * (is_fus)
riv += dots(y, z, 0.05, 0.30, R_RIV) * fin_reg * (is_fus)
riv = np.clip(riv, 0, 1)
W = 0.0055
def gl(v, c): return np.exp(-((v - c) / W)**2)
groove = np.zeros_like(x)
for yc in (-1.06, 1.62, 2.40, 3.20, 4.00): groove += gl(y, yc) * is_fus
groove += gl(z, 0.20) * is_fus * (y > -2.35) * (y < -1.06) * side_w
groove += gl(x, 0.0) * is_fus * (y > -2.3) * (y < -1.06) * smooth(nz, 0.5, 0.9)
# doors (both sides)
inz = (z > -0.27) & (z < 0.30); iny = (y > -0.40) & (y < 0.64)
groove += (gl(y, -0.40) + gl(y, 0.64)) * inz * is_fus * side_w
groove += gl(z, -0.27) * iny * is_fus * side_w
# door handle recess
groove += np.exp(-(((y - 0.55)/0.05)**2 + ((z - 0.05)/0.012)**2)) * is_fus * side_w
# wing root / tip lines, fuel caps
groove += gl(ax, 0.60) * is_wing * (y > -0.45) * (y < 1.25)
groove += gl(ax, 5.38) * is_wing
cap = np.sqrt((ax - 1.9)**2 + (y + 0.1)**2)
groove += np.exp(-((cap - 0.07) / 0.006)**2) * is_wing * smooth(nz, 0.5, 0.9)
# inspection panels on wing underside
for xc in (2.2, 3.4, 4.6):
    rr = np.maximum(np.abs(ax - xc) - 0.06, np.abs(y - 0.7) - 0.06)
    groove += np.exp(-(rr / W)**2) * is_wing * smooth(-nz, 0.5, 0.9)
groove = np.clip(groove, 0, 1)
h = 0.45 * riv - 1.0 * groove + 0.10 * (fbm(6.0, 3, 5.0) - 0.5)
gy_, gx_ = np.gradient(h)
K = 0.9
nvec = np.stack([-gx_ * K, -gy_ * K, np.ones_like(h)], axis=-1)
nvec /= np.linalg.norm(nvec, axis=-1, keepdims=True)
normal_rgb = nvec * 0.5 + 0.5
normal_rgb[~cov] = (0.5, 0.5, 1.0)

# ---------------- albedo (sRGB values)
WHITE = np.array([0.93, 0.93, 0.92], np.float32); BLUE = np.array([0.106, 0.227, 0.42], np.float32); RED = np.array([0.78, 0.09, 0.10], np.float32)
alb = np.ones((SIZE, SIZE, 3), np.float32) * WHITE
zu = np.where(y < 1.5, 0.22 + 0.015 * (y + 2.4), 0.2785 + 0.06 * (y - 1.5))
hb = 0.20 + 0.03 * smooth(y, 1.5, 4.5)
zl = zu - hb
band = is_fus & (z < zu) & (z > zl) & ~fin_reg & ~stab_reg & (y < 4.6) & (y > -2.42)
red = is_fus & (z < zl - 0.02) & (z > zl - 0.05) & ~fin_reg & ~stab_reg & (y < 4.6) & (y > -2.42)
yle = 4.20 + 0.657 * (z - 0.40); sfin = y - yle
band |= fin_reg & (sfin > 0.30) & (sfin < 0.62)
red |= fin_reg & (sfin > 0.66) & (sfin < 0.70)
band |= is_wing & (ax > 5.02) & (ax < 5.32)
red |= is_wing & (ax > 4.92) & (ax < 4.98)
alb[band] = BLUE; alb[red] = RED
# registration text
_ri = Image.open(os.path.join(OUT, 'reg_mask.png')).convert('L')
RW, RH = _ri.size
ra = np.asarray(_ri).astype(np.float32)[::-1] / 255.0
def sample_mask(u, v, valid):
    uu = np.clip(u, 0, 1) * (RW - 1); vv = np.clip(v, 0, 1) * (RH - 1)
    i0 = np.floor(uu).astype(int); j0 = np.floor(vv).astype(int); fu = uu - i0; fv = vv - j0
    i1 = np.minimum(i0 + 1, RW - 1); j1 = np.minimum(j0 + 1, RH - 1)
    m = (ra[j0, i0]*(1-fu)*(1-fv) + ra[j0, i1]*fu*(1-fv) + ra[j1, i0]*(1-fu)*fv + ra[j1, i1]*fu*fv)
    return m * valid
Y0, Y1, Z0, Z1 = 1.95, 3.15, 0.40, 0.657
inreg = is_fus & (y > Y0) & (y < Y1) & (z > Z0) & (z < Z1)
mport = sample_mask((y - Y0) / (Y1 - Y0), (z - Z0) / (Z1 - Z0), inreg & (nx > 0.25))
mstar = sample_mask((Y1 - y) / (Y1 - Y0), (z - Z0) / (Z1 - Z0), inreg & (nx < -0.25))
mt = np.clip(mport + mstar, 0, 1)[..., None]
alb = alb * (1 - mt) + np.array([0.06, 0.06, 0.07], np.float32) * mt
# grime
n_lo = fbm(1.5, 3, 1.0); n_mid = fbm(5.0, 4, 2.0); n_hi = fbm(30.0, 3, 3.0)
belly = smooth(-nz, 0.1, 0.6) * (is_fus | is_gear)
dirt = 0.10 * belly * (0.5 + 0.5 * n_mid) + 0.05 * (n_lo ** 2)
dxs = x - (-0.20 - 0.03 * (y + 1.45)); sig = 0.07 + 0.06 * np.clip(y + 1.45, 0, 4)
exh = np.exp(-dxs**2 / (2 * sig**2)) * np.exp(-np.clip(y + 1.45, 0, 10) / 1.8) * (y > -1.45) * smooth(-nz, -0.2, 0.3) * is_fus
exh = exh * (0.6 + 0.4 * fbm(8.0, 3, 4.0))
speck = smooth(n_hi, 0.58, 0.68) * smooth(-ny, 0.45, 0.8) * (is_wing | stab_reg | fin_reg)
alb *= (1 - dirt - 0.5 * exh)[..., None]
alb = alb * (1 - 0.6 * speck)[..., None] + np.array([0.55, 0.56, 0.58], np.float32) * (0.6 * speck)[..., None]
alb *= (1 - 0.25 * groove)[..., None]
alb *= (0.82 + 0.18 * ao)[..., None]
alb = np.clip(alb, 0, 1); alb[~cov] = WHITE * 0.95
# roughness
rough = 0.36 + 0.10 * (n_mid - 0.5) + 0.12 * belly + 0.3 * exh + 0.3 * groove + 0.35 * speck
rough = np.where(band, rough - 0.04, rough)
rough = np.clip(rough, 0.05, 0.95)
orm = np.stack([ao, rough, np.zeros_like(rough)], axis=-1); orm[~cov] = (1.0, 0.36, 0.0)

def to_srgb(lin):
    a = np.clip(lin, 0, 1)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(a, 1/2.4) - 0.055)
def save_img(name, arr, noncolor, encode_srgb=False):
    a = np.clip(arr, 0, 1)
    if encode_srgb: a = to_srgb(a)
    # Blender image space is bottom-up; PNG is top-down
    im = Image.fromarray((a[::-1] * 255 + 0.5).astype(np.uint8), 'RGB')
    im.save(os.path.join(OUT, name + '.png'))
    return im
save_img('body_albedo', alb, False)
save_img('body_normal', normal_rgb, True)
save_img('body_orm', orm, True)

# ---------------- tire tread normal (tileable 512)
T = 512
u = (np.arange(T) + 0.5) / T; v = (np.arange(T) + 0.5) / T
U, V = np.meshgrid(u, v)
ht = np.zeros((T, T), np.float32)
for vc in (0.32, 0.5, 0.68): ht -= np.exp(-((V - vc) / 0.02)**2)
blocks = ((np.sin(U * 2*np.pi*4 + np.where(V > 0.5, 0.8, 0.0)) > 0.85) & (np.abs(V - 0.5) > 0.05) & (np.abs(V - 0.5) < 0.33)).astype(np.float32)
ht -= 0.8 * blocks
ht -= 2.0 * smooth(np.abs(V - 0.5), 0.36, 0.5)
gy_, gx_ = np.gradient(ht)
nt_ = np.stack([-gx_ * 0.6, -gy_ * 0.6, np.ones_like(ht)], axis=-1); nt_ /= np.linalg.norm(nt_, axis=-1, keepdims=True)
save_img('tire_normal', nt_ * 0.5 + 0.5, True)

# ---------------- cockpit worn metal albedo (1024)
C = 1024
rng = np.random.default_rng(7)
cm = np.ones((C, C, 3), np.float32) * np.array([0.10, 0.105, 0.11], np.float32)
noise2 = rng.random((C // 16, C // 16)).astype(np.float32)
noise2 = np.kron(noise2, np.ones((16, 16), np.float32))
cm *= (0.85 + 0.3 * noise2)[..., None]
for _ in range(450):
    x0, y0 = rng.random(2) * C; ang = rng.random() * np.pi; L = rng.random() * 120 + 10
    t = np.linspace(0, 1, int(L) * 2)
    xs = np.clip((x0 + np.cos(ang) * L * t).astype(int), 0, C - 1); ys = np.clip((y0 + np.sin(ang) * L * t).astype(int), 0, C - 1)
    cm[ys, xs] = np.array([0.55, 0.55, 0.56]) * (0.6 + 0.4 * rng.random())
for _ in range(60):
    x0, y0 = (rng.random(2) * C).astype(int); r = int(rng.random() * 25 + 5)
    yy, xx = np.ogrid[-r:r, -r:r]; m = (xx*xx + yy*yy) <= r*r
    sl = cm[max(0, y0-r):y0+r, max(0, x0-r):x0+r]
    mm = m[:sl.shape[0], :sl.shape[1]]
    sl[mm] = sl[mm] * 0.6 + np.array([0.5, 0.5, 0.52]) * 0.4
save_img('cockpit_metal', np.clip(cm, 0, 1), False)
print('textures written; band px', int(band.sum()), 'reg px', int((mt > 0.5).sum()), 'exh max', float(exh.max()))
