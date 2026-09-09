"""MiG-29 Fulcrum airframe.  Run headless:
   Blender --background --factory-startup --python blender/mig/build.py
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import importlib
import mlib
importlib.reload(mlib)
from mlib import (S0, P, cr_chain, lerp, airfoil_slice, MB, new_obj, clean,
                  cut_faces, set_origin, finish, mirror_object, empty,
                  parent_to, make_mat, _centroid)

R = math.radians
TAU = math.pi * 2.0

# ---------------------------------------------------------------- scene ----
for c in (bpy.data.objects, bpy.data.meshes, bpy.data.materials,
          bpy.data.cameras, bpy.data.lights):
    for x in list(c):
        c.remove(x)

MAT = {}
def M(n): return MAT[n]

MAT['Paint_Camo']     = make_mat('Paint_Camo',    (0.40, 0.45, 0.50), 0.55, 0.0)
MAT['Radome']         = make_mat('Radome',        (0.035, 0.035, 0.040), 0.40, 0.0)
MAT['Metal_Nozzle']   = make_mat('Metal_Nozzle',  (0.52, 0.51, 0.49), 0.35, 1.0)
MAT['Metal_Bare']     = make_mat('Metal_Bare',    (0.72, 0.73, 0.75), 0.30, 1.0)
MAT['Canopy']         = make_mat('Canopy',        (0.80, 0.72, 0.46), 0.05, 0.0, 0.25)
MAT['HUD_Glass']      = make_mat('HUD_Glass',     (0.82, 0.92, 0.84), 0.04, 0.0, 0.12)
MAT['Cockpit_Dark']   = make_mat('Cockpit_Dark',  (0.055, 0.068, 0.058), 0.80, 0.0)
MAT['Gauge_Faces']    = make_mat('Gauge_Faces',   (0.020, 0.020, 0.022), 0.30, 0.0)
MAT['Seat_Fabric']    = make_mat('Seat_Fabric',   (0.10, 0.11, 0.09), 0.90, 0.0)
MAT['Rubber_Tire']    = make_mat('Rubber_Tire',   (0.030, 0.030, 0.032), 0.85, 0.0)
MAT['Light_Red']      = make_mat('Light_Red',     (0.60, 0.03, 0.03), 0.15, 0.0)
MAT['Light_Green']    = make_mat('Light_Green',   (0.03, 0.55, 0.10), 0.15, 0.0)
MAT['Light_White']    = make_mat('Light_White',   (0.85, 0.85, 0.85), 0.15, 0.0)
MAT['Warning_Stripe'] = make_mat('Warning_Stripe', (0.72, 0.55, 0.03), 0.55, 0.0)

CAMO = M('Paint_Camo')
CD = M('Cockpit_Dark')
GF = M('Gauge_Faces')
SF = M('Seat_Fabric')
MBM = M('Metal_Bare')
WS = M('Warning_Stripe')

# ================================================================ BODY =====
#         S      zt      zb      W     crr     zm     tun    ch    fl
BODY = [
    (0.00, -0.030, -0.070, 0.020, 0.97, -0.050, 0.00, 0.00, 0.00),
    (0.30,  0.100, -0.200, 0.160, 0.97, -0.050, 0.00, 0.00, 0.00),
    (0.70,  0.240, -0.310, 0.300, 0.97, -0.030, 0.00, 0.00, 0.00),
    (1.20,  0.360, -0.380, 0.420, 0.97,  0.000, 0.00, 0.05, 0.05),
    (1.80,  0.460, -0.440, 0.520, 0.96,  0.020, 0.00, 0.10, 0.12),
    (2.30,  0.530, -0.480, 0.585, 0.95,  0.040, 0.00, 0.20, 0.22),
    (2.90,  0.605, -0.530, 0.665, 0.92,  0.050, 0.00, 0.42, 0.40),
    (3.50,  0.665, -0.580, 0.805, 0.84,  0.060, 0.02, 0.75, 0.70),
    (4.30,  0.700, -0.645, 1.000, 0.70,  0.080, 0.06, 0.95, 0.95),
    (5.30,  0.720, -0.745, 1.205, 0.60,  0.090, 0.14, 1.00, 1.00),
    (6.30,  0.800, -0.860, 1.450, 0.55,  0.110, 0.24, 1.00, 0.85),
    (6.75,  0.880, -0.890, 1.520, 0.55,  0.115, 1.00 * 0.28, 1.00, 0.60),
    (7.20,  0.905, -0.920, 1.580, 0.56,  0.120, 0.32, 1.00, 0.50),
    (8.20,  0.895, -0.960, 1.720, 0.60,  0.130, 0.40, 1.00, 0.45),
    (9.20,  0.860, -0.980, 1.790, 0.66,  0.130, 0.42, 0.95, 0.42),
    (10.30, 0.810, -0.980, 1.810, 0.72,  0.130, 0.42, 0.85, 0.40),
    (11.40, 0.755, -0.970, 1.800, 0.78,  0.120, 0.75, 0.75, 0.38),
    (12.50, 0.695, -0.940, 1.780, 0.85,  0.110, 0.40, 0.60, 0.35),
    (13.45, 0.640, -0.880, 1.740, 0.91,  0.100, 0.36, 0.45, 0.30),
    (14.00, 0.580, -0.720, 1.450, 0.94,  0.090, 0.22, 0.35, 0.25),
    (14.50, 0.500, -0.460, 1.050, 0.95,  0.080, 0.10, 0.25, 0.20),
    (15.00, 0.400, -0.150, 0.600, 0.96,  0.100, 0.02, 0.15, 0.15),
    (15.30, 0.280,  0.100, 0.160, 0.96,  0.190, 0.00, 0.00, 0.10),
]
BODY = [list(b) for b in BODY]
BODY[16][6] = 0.42          # fix typo above
BODY = [tuple(b) for b in BODY]

NRING = 80
KHALF = 13
BODY_S = cr_chain(BODY, NRING)


def body_half(zt, zb, W, crr, zm, tun, ch, fl, k=KHALF):
    Hu = max(zt - zm, 1e-4)
    Hl = max(zm - zb, 1e-4)
    e = min(0.45, max(0.008, (1.0 - crr) * (0.35 + 0.45 * ch)))
    t_up = Hu * (0.35 * (1 - ch) + 0.020 * ch)
    t_lo = Hl * (0.30 * (1 - ch) + 0.050 * ch)
    up = cr_chain([(0.0, zt),
                   (W * crr * (0.30 + 0.42 * fl), zt - Hu * (0.13 * (1 - fl) + 0.010 * fl)),
                   (W * crr * (0.72 + 0.20 * fl), zm + Hu * (0.62 - 0.10 * fl)),
                   (W * (1 - e), zm + t_up),
                   (W, zm)], k)
    lo = cr_chain([(W, zm),
                   (W * (1 - e), zm - t_lo),
                   (W * (1 - e) * 0.90, zb + 0.42 * Hl),
                   (W * 0.45, zb + 0.12 * tun),
                   (0.0, zb + tun)], k)
    return up + lo[1:]


def body_ring(prm):
    s = prm[0]
    half = body_half(*prm[1:])
    ring = half + [(-x, z) for (x, z) in reversed(half[1:-1])]
    return [P(x, s, z) for (x, z) in ring]


def _prm_at(s):
    if s <= BODY_S[0][0]:
        return BODY_S[0]
    if s >= BODY_S[-1][0]:
        return BODY_S[-1]
    for i in range(len(BODY_S) - 1):
        if BODY_S[i][0] <= s <= BODY_S[i + 1][0]:
            t = (s - BODY_S[i][0]) / max(BODY_S[i + 1][0] - BODY_S[i][0], 1e-9)
            return tuple(lerp(a, b, t) for a, b in zip(BODY_S[i], BODY_S[i + 1]))
    return BODY_S[-1]


def body_top_z(s, x):
    prm = _prm_at(s)
    half = body_half(*prm[1:])
    up = half[:KHALF]
    ax = min(abs(x), up[-1][0])
    for i in range(len(up) - 1):
        a, b = up[i], up[i + 1]
        if a[0] <= ax <= b[0] + 1e-12:
            t = (ax - a[0]) / max(b[0] - a[0], 1e-9)
            return lerp(a[1], b[1], t)
    return up[-1][1]


fus = MB()
rings = [body_ring(p) for p in BODY_S]
n = len(rings[0])
for i in range(len(rings) - 1):
    s_mid = 0.5 * (BODY_S[i][0] + BODY_S[i + 1][0])
    mat = 1 if s_mid < 2.35 else 0
    fus.add(rings[i] + rings[i + 1],
            [[j, (j + 1) % n, n + (j + 1) % n, n + j] for j in range(n)], mat)
fus.add(rings[0] + [_centroid(rings[0])], [[n, (j + 1) % n, j] for j in range(n)], 1)
fus.add(rings[-1] + [_centroid(rings[-1])], [[n, j, (j + 1) % n] for j in range(n)], 0)

# ---- pitot boom -----------------------------------------------------------
fus.cyl((0.0, -1.05, -0.078), (0.0, -0.55, -0.064), 0.012, 0.020, 10, True, 2)
fus.cyl((0.0, -0.55, -0.064), (0.0, 0.06, -0.046), 0.020, 0.036, 10, True, 2)
for sgn in (1, -1):
    fus.box(min(sgn * 0.020, sgn * 0.080), max(sgn * 0.020, sgn * 0.080),
            -0.74, -0.62, -0.086, -0.070, 2)
fus.box(-0.012, 0.012, -0.74, -0.62, -0.090, -0.036, 2)

# ---- nacelles + tailpipe socks --------------------------------------------
NAC = [(8.20, 0.700, -0.290, 1.055), (9.00, 0.735, -0.315, 1.075),
       (10.00, 0.745, -0.335, 1.090), (11.00, 0.740, -0.355, 1.095),
       (12.00, 0.725, -0.375, 1.100), (13.00, 0.700, -0.392, 1.100),
       (13.80, 0.665, -0.405, 1.100), (14.30, 0.632, -0.415, 1.100),
       (14.62, 0.608, -0.420, 1.100)]
NACS = cr_chain(NAC, 22)
NSEG = 26
BORE_S0, BORE_S1 = 13.30, 14.62
NOZ_CZ = -0.420
NOZ_CX = 1.100


def circ_ring(cx, cz, r, s, sgn, seg=NSEG, flat_top=0.0):
    out = []
    for i in range(seg):
        a = -sgn * TAU * i / seg
        rad = r * (1.0 - flat_top * max(0.0, math.sin(a)) ** 2)
        out.append(P(sgn * (cx + rad * math.cos(a)), s, cz + rad * math.sin(a)))
    return out


for sgn in (1, -1):
    rr = [circ_ring(cx, cz, r, s, sgn, NSEG, 0.06) for (s, r, cz, cx) in NACS]
    fus._loft_world(rr, True, True, False, 0)
    # rim: nacelle skin -> bore mouth
    last = NACS[-1]
    rim_o = circ_ring(last[3], last[2], last[1], last[0], sgn, NSEG, 0.06)
    rim_i = circ_ring(NOZ_CX, NOZ_CZ, 0.578, BORE_S1, sgn, NSEG)
    fus._loft_world([rim_o, rim_i], True, False, False, 4)
    # bore running forward, closed by a turbine face
    bore = [circ_ring(NOZ_CX, NOZ_CZ, r, s, sgn, NSEG)
            for (s, r) in ((BORE_S1, 0.578), (14.20, 0.582), (13.80, 0.586),
                           (BORE_S0, 0.588))]
    fus._loft_world(bore, True, False, True, 4)
    # flame holder cone + radial vanes just inside the bore
    fus.cyl((sgn * NOZ_CX, BORE_S0 + 0.02, NOZ_CZ),
            (sgn * NOZ_CX, BORE_S0 + 0.34, NOZ_CZ), 0.20, 0.13, 14, True, 4)
    for i in range(8):
        a = math.pi * i / 8
        c, s_ = math.cos(a), math.sin(a)
        fus.cyl((sgn * (NOZ_CX + 0.55 * c), BORE_S0 + 0.10, NOZ_CZ + 0.55 * s_),
                (sgn * (NOZ_CX - 0.55 * c), BORE_S0 + 0.10, NOZ_CZ - 0.55 * s_),
                0.020, 0.020, 6, True, 4)
    fus.cyl((sgn * NOZ_CX, BORE_S0 + 0.30, NOZ_CZ),
            (sgn * NOZ_CX, BORE_S0 + 0.60, NOZ_CZ), 0.30, 0.30, 16, True, 4)

# ---- tail booms -----------------------------------------------------------
BOOM = [(8.40, 1.640, 0.040, 0.100, 0.08),
        (9.40, 1.720, 0.200, 0.100, 0.34),
        (10.40, 1.780, 0.280, 0.110, 0.46),
        (11.40, 1.830, 0.310, 0.110, 0.48),
        (12.40, 1.860, 0.310, 0.100, 0.46),
        (13.40, 1.870, 0.300, 0.090, 0.42),
        (14.30, 1.860, 0.270, 0.060, 0.36),
        (15.00, 1.840, 0.220, 0.030, 0.28),
        (15.60, 1.800, 0.140, 0.010, 0.17),
        (16.00, 1.760, 0.030, 0.000, 0.04)]
BOOMS = cr_chain(BOOM, 20)
BSEG = 20
for sgn in (1, -1):
    rr = []
    for (s, cx, hw, cz, hh) in BOOMS:
        ring = []
        for i in range(BSEG):
            a = -sgn * TAU * i / BSEG
            ca, sa = math.cos(a), math.sin(a)
            nn = 2.6
            x = cx + hw * math.copysign(abs(ca) ** (2.0 / nn), ca)
            z = cz + hh * math.copysign(abs(sa) ** (2.0 / nn), sa)
            ring.append(P(sgn * x, s, z))
        rr.append(ring)
    fus._loft_world(rr, True, True, True, 0)

# ---- intake ducts ---------------------------------------------------------
INT = [(6.30, 1.000, 0.400, -0.680, 0.260),
       (6.90, 1.020, 0.400, -0.720, 0.280),
       (7.60, 1.050, 0.400, -0.760, 0.300),
       (8.40, 1.070, 0.390, -0.800, 0.310),
       (9.20, 1.090, 0.380, -0.830, 0.310),
       (9.90, 1.100, 0.360, -0.850, 0.300)]
INTS = cr_chain(INT, 14)
ISEG = 24


def rect_ring(cx, hw, cz, hh, s, sgn, seg=ISEG, nn=4.0, k=1.0):
    ring = []
    for i in range(seg):
        a = -sgn * TAU * i / seg
        ca, sa = math.cos(a), math.sin(a)
        x = cx + hw * k * math.copysign(abs(ca) ** (2.0 / nn), ca)
        z = cz + hh * k * math.copysign(abs(sa) ** (2.0 / nn), sa)
        ring.append(P(sgn * x, s, z))
    return ring


for sgn in (1, -1):
    rr = [rect_ring(cx, hw, cz, hh, s, sgn) for (s, cx, hw, cz, hh) in INTS]
    fus._loft_world(rr, True, False, True, 0)
    m0 = INTS[0]
    lip_a = rect_ring(m0[1], m0[2], m0[3], m0[4], m0[0], sgn)
    lip_b = rect_ring(m0[1], m0[2], m0[3], m0[4], m0[0] + 0.10, sgn, k=0.88)
    fus._loft_world([lip_a, lip_b], True, False, False, 0)
    thr = [rect_ring(m0[1], m0[2], m0[3], m0[4], m0[0] + 0.10, sgn, k=0.88),
           rect_ring(1.04, 0.36, -0.745, 0.265, 7.20, sgn),
           rect_ring(1.06, 0.30, -0.780, 0.225, 8.10, sgn)]
    fus._loft_world(thr, True, False, True, 3)
    # variable ramp on the duct roof
    fus.box(min(sgn * 0.70, sgn * 1.30), max(sgn * 0.70, sgn * 1.30),
            6.48, 7.55, -0.640, -0.600, 3)

# ---- greebles -------------------------------------------------------------
for sgn in (1, -1):
    for i in range(5):
        s = 6.55 + i * 0.30
        z = body_top_z(s, 1.05) + 0.006
        x0 = min(sgn * 0.72, sgn * 1.30)
        x1 = max(sgn * 0.72, sgn * 1.30)
        fus.box(x0, x1, s, s + 0.20, z - 0.012, z, 3)
for (s, h) in ((7.60, 0.17), (12.10, 0.13)):
    z = body_top_z(s, 0.0)
    fus.add([P(-0.016, s, z), P(0.016, s, z), P(0.016, s + 0.30, z), P(-0.016, s + 0.30, z),
             P(-0.010, s + 0.13, z + h), P(0.010, s + 0.13, z + h),
             P(0.010, s + 0.28, z + h), P(-0.010, s + 0.28, z + h)],
            [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5],
             [2, 3, 7, 6], [3, 0, 4, 7]], 0)
BEACON_Z = body_top_z(8.40, 0.0)
fus.cyl((0.0, 8.40, BEACON_Z - 0.02), (0.0, 8.40, BEACON_Z + 0.070), 0.055, 0.038, 12, True, 0)
# gun fairing on the left LERX
fus.box(0.62, 1.05, 4.95, 5.72, body_top_z(5.3, 0.85) + 0.0,
        body_top_z(5.3, 0.85) + 0.085, 0)
# ventral fins / pylon stubs under the wing roots
for sgn in (1, -1):
    for xs in (0.95, 1.55):
        fus.box(min(sgn * (xs - 0.09), sgn * (xs + 0.09)),
                max(sgn * (xs - 0.09), sgn * (xs + 0.09)),
                9.60, 10.55, -1.02, -0.90, 0)

FUS_MATS = [CAMO, M('Radome'), MBM, CD, M('Metal_Nozzle')]
Fuselage = new_obj('Fuselage', fus, FUS_MATS)
cut_faces(Fuselage, -0.565, 0.565, 4.02, 6.30, 0.35, 1.30, nz=1)
finish(Fuselage, bevel=0.006, seg=2)

# =============================================================== WINGS =====
WR_X, WT_X = 1.68, 5.68
W_LE_R, W_LE_T = 7.90, 11.50
W_TE_R, W_TE_T = 13.45, 13.10
W_Z_R, W_Z_T = 0.130, 0.030
W_TC_R, W_TC_T = 0.058, 0.046


def wing_geom(x):
    t = (abs(x) - WR_X) / (WT_X - WR_X)
    le = lerp(W_LE_R, W_LE_T, t)
    te = lerp(W_TE_R, W_TE_T, t)
    return le, te - le, lerp(W_Z_R, W_Z_T, t), lerp(W_TC_R, W_TC_T, t)


def wing_piece(c0, c1, x0, x1, nspan, mat=0, npts=15, cap0=True, cap1=True):
    mb = MB()
    rings = []
    for i in range(nspan):
        x = lerp(x0, x1, i / (nspan - 1))
        le, ch, z, tc = wing_geom(x)
        sl = airfoil_slice(c0, c1, tc, npts)
        rings.append([P(x, le + u * ch, z + v * ch) for (u, v) in sl])
    mb._loft_world(rings, True, cap0, cap1, mat)
    return mb


mbw = wing_piece(0.165, 0.715, WR_X, 5.55, 14)
# tip fairing (full chord, tapering to a rounded tip)
rings = []
for (x, sc) in ((5.55, 1.00), (5.645, 0.62), (5.690, 0.16)):
    le, ch, z, tc = wing_geom(x)
    sl = airfoil_slice(0.0, 1.0, tc, 17)
    rings.append([P(x, le + (0.5 + (u - 0.5) * sc) * ch, z + v * ch * sc)
                  for (u, v) in sl])
mbw._loft_world(rings, True, True, True, 0)
le, ch, z, tc = wing_geom(5.58)
mbw.cyl((5.58, le + 0.12 * ch, z - 0.080), (5.58, le + 0.99 * ch, z - 0.080),
        0.045, 0.042, 12, True, 0)
mbw.cyl((5.58, le - 0.30, z - 0.080), (5.58, le + 0.12 * ch, z - 0.080),
        0.010, 0.045, 12, True, 0)
mbw.cyl((5.640, le + 0.10, z + 0.012), (5.700, le + 0.10, z + 0.012),
        0.048, 0.034, 10, True, 1)
Wing_L = new_obj('Wing_L', mbw, [CAMO, M('Light_Red')])
set_origin(Wing_L, 0.0, S0, 0.0)
finish(Wing_L, bevel=0.005)

Slat_L = new_obj('Slat_L', wing_piece(0.0, 0.152, 1.76, 5.52, 12), [CAMO])
set_origin(Slat_L, 1.76, W_LE_R + 0.13 * (W_TE_R - W_LE_R), W_Z_R)
finish(Slat_L, bevel=0.004)

Flap_L = new_obj('Flap_L', wing_piece(0.730, 1.0, 1.76, 3.56, 8), [CAMO])
le, ch, z, tc = wing_geom(1.76)
set_origin(Flap_L, 1.76, le + 0.730 * ch, z)
finish(Flap_L, bevel=0.004)

Aileron_L = new_obj('Aileron_L', wing_piece(0.730, 1.0, 3.64, 5.52, 8), [CAMO])
le, ch, z, tc = wing_geom(3.64)
set_origin(Aileron_L, 3.64, le + 0.730 * ch, z)
finish(Aileron_L, bevel=0.004)

# ================================================================ FINS =====
F_X0, F_Z0 = 1.860, 0.420
F_H, F_DX = 2.337, 0.246
F_LE_R, F_CH_R = 10.30, 4.00
F_LE_T, F_CH_T = 12.75, 1.45
F_T_R, F_T_T = 0.150, 0.062


def fin_piece(c0, c1, h0, h1, nsp, mat=0, npts=14):
    mb = MB()
    rings = []
    for i in range(nsp):
        h = lerp(h0, h1, i / (nsp - 1))
        x = F_X0 + F_DX * h
        z = F_Z0 + F_H * h
        le = lerp(F_LE_R, F_LE_T, h)
        ch = lerp(F_CH_R, F_CH_T, h)
        th = lerp(F_T_R, F_T_T, h) / ch
        sl = airfoil_slice(c0, c1, th, npts)
        rings.append([P(x + v * ch, le + u * ch, z) for (u, v) in sl])
    mb._loft_world(rings, True, True, True, mat)
    return mb


mbfin = fin_piece(0.0, 0.700, -0.05, 1.0, 12)
mbfin.box(F_X0 + F_DX - 0.048, F_X0 + F_DX + 0.048, F_LE_T + 0.28, F_LE_T + 1.42,
          F_Z0 + F_H - 0.005, F_Z0 + F_H + 0.075, 0)
mbfin.box(F_X0 + 0.10, F_X0 + 0.15, F_LE_R + 1.60, F_LE_R + 2.60,
          F_Z0 + 0.28, F_Z0 + 0.62, 0)
mbfin.cyl((F_X0 + F_DX, F_LE_T + 1.30, F_Z0 + F_H + 0.038),
          (F_X0 + F_DX, F_LE_T + 1.46, F_Z0 + F_H + 0.038), 0.035, 0.022, 8, True, 1)
Fin_L = new_obj('Fin_L', mbfin, [CAMO, M('Light_White')])
set_origin(Fin_L, F_X0, F_LE_R, F_Z0)
finish(Fin_L, bevel=0.005)

Rudder_L = new_obj('Rudder_L', fin_piece(0.722, 1.0, 0.02, 0.985, 10), [CAMO])
set_origin(Rudder_L, F_X0 + F_DX * 0.5, F_LE_R + 0.722 * F_CH_R - 0.31,
           F_Z0 + F_H * 0.5)
finish(Rudder_L, bevel=0.004)

# ========================================================= STABILATORS =====
T_X0, T_X1 = 1.700, 3.890
T_LE_R, T_CH_R = 13.30, 2.45
T_LE_T, T_CH_T = 15.56, 0.74
T_Z_R, T_Z_T = -0.060, -0.100
mbst = MB()
rings = []
for i in range(12):
    t = i / 11
    x = lerp(T_X0, T_X1, t)
    le = lerp(T_LE_R, T_LE_T, t)
    ch = lerp(T_CH_R, T_CH_T, t)
    zz = lerp(T_Z_R, T_Z_T, t)
    sl = airfoil_slice(0.0, 1.0, 0.055, 17)
    rings.append([P(x, le + u * ch, zz + v * ch) for (u, v) in sl])
mbst._loft_world(rings, True, True, True, 0)
mbst.cyl((1.560, T_LE_R + 0.30 * T_CH_R, T_Z_R), (1.720, T_LE_R + 0.30 * T_CH_R, T_Z_R),
         0.075, 0.075, 12, True, 0)
Stabilator_L = new_obj('Stabilator_L', mbst, [CAMO])
set_origin(Stabilator_L, 1.560, T_LE_R + 0.30 * T_CH_R, T_Z_R)
finish(Stabilator_L, bevel=0.005)

# ============================================================ AIRBRAKE =====
AB_S0, AB_S1, AB_HW = 8.90, 10.40, 0.470
NS, NX = 9, 9
top, bot = [], []
for i in range(NS):
    s = lerp(AB_S0, AB_S1, i / (NS - 1))
    rt, rb = [], []
    for j in range(NX):
        x = lerp(-AB_HW, AB_HW, j / (NX - 1))
        z = body_top_z(s, x)
        rt.append(P(x, s, z + 0.040))
        rb.append(P(x, s, z + 0.006))
    top.append(rt)
    bot.append(rb)
v, f = [], []
for r in top:
    v.extend(r)
o = len(v)
for r in bot:
    v.extend(r)


def T(i, j): return i * NX + j
def B(i, j): return o + i * NX + j


for i in range(NS - 1):
    for j in range(NX - 1):
        f.append([T(i, j), T(i, j + 1), T(i + 1, j + 1), T(i + 1, j)])
        f.append([B(i, j), B(i + 1, j), B(i + 1, j + 1), B(i, j + 1)])
for i in range(NS - 1):
    f.append([T(i, 0), T(i + 1, 0), B(i + 1, 0), B(i, 0)])
    f.append([T(i, NX - 1), B(i, NX - 1), B(i + 1, NX - 1), T(i + 1, NX - 1)])
for j in range(NX - 1):
    f.append([T(0, j), B(0, j), B(0, j + 1), T(0, j + 1)])
    f.append([T(NS - 1, j), T(NS - 1, j + 1), B(NS - 1, j + 1), B(NS - 1, j)])
mbab = MB()
mbab.add(v, f, 0)
Airbrake = new_obj('Airbrake', mbab, [CAMO])
set_origin(Airbrake, 0.0, AB_S0, body_top_z(AB_S0, 0.0) + 0.023)
finish(Airbrake, bevel=0.004)

# ============================================================== NOZZLE =====
NOZ_S0, NOZ_S1 = 14.62, 15.28
NP = 18


def nozzle(sgn):
    mb = MB()
    cx, cz = NOZ_CX * sgn, NOZ_CZ
    gap = R(1.7)
    for p in range(NP):
        a0 = TAU * p / NP + gap
        a1 = TAU * (p + 1) / NP - gap
        rings = []
        for (s, ro, ri) in ((NOZ_S0, 0.618, 0.578), (NOZ_S0 + 0.22, 0.592, 0.556),
                            (NOZ_S0 + 0.44, 0.562, 0.528), (NOZ_S1, 0.532, 0.502)):
            outer, inner = [], []
            for k in range(5):
                a = lerp(a0, a1, k / 4)
                outer.append(P(cx + ro * math.cos(a), s, cz + ro * math.sin(a)))
                inner.append(P(cx + ri * math.cos(a), s, cz + ri * math.sin(a)))
            rings.append(outer + list(reversed(inner)))
        mb._loft_world(rings, True, True, True, 0)
    mb.cyl((cx, NOZ_S0 - 0.05, cz), (cx, NOZ_S0 + 0.02, cz), 0.648, 0.640, 26, True, 0)
    for p in range(6):
        a = TAU * p / 6 + 0.35
        mb.cyl((cx + 0.628 * math.cos(a), NOZ_S0 + 0.01, cz + 0.628 * math.sin(a)),
               (cx + 0.560 * math.cos(a), NOZ_S1 - 0.10, cz + 0.560 * math.sin(a)),
               0.024, 0.024, 6, True, 0)
    return mb


Nozzle_L = new_obj('Nozzle_L', nozzle(1), [M('Metal_Nozzle')])
set_origin(Nozzle_L, NOZ_CX, NOZ_S0, NOZ_CZ)
finish(Nozzle_L, bevel=0.003, angle=R(50))

# ============================================================== CANOPY =====
CANH = [(3.62, 0.235, 0.735), (3.95, 0.400, 0.945), (4.30, 0.490, 1.078),
        (4.70, 0.535, 1.138), (5.10, 0.548, 1.152), (5.50, 0.532, 1.138),
        (5.90, 0.482, 1.075), (6.15, 0.382, 0.985), (6.35, 0.180, 0.872)]
CANS = cr_chain(CANH, 22)
CNX = 19


def canopy_arc(s, hw, top_z, k=1.0):
    sill = body_top_z(s, hw) + 0.004
    pts = []
    for i in range(CNX):
        a = math.pi * (1.0 - i / (CNX - 1))
        ca, sa = math.cos(a), math.sin(a)
        nn = 2.5
        x = hw * k * math.copysign(abs(ca) ** (2.0 / nn), ca)
        z = sill + (top_z - sill) * k * abs(sa) ** (2.0 / nn)
        pts.append(P(x, s, z))
    return pts


mbc = MB()
mbc._loft_world([canopy_arc(s, hw, tz) for (s, hw, tz) in CANS], closed=False, mat=0)
Canopy_Glass = new_obj('Canopy_Glass', mbc, [M('Canopy')])
set_origin(Canopy_Glass, 0.0, 6.35, 0.80)
finish(Canopy_Glass, bevel=0.0, smooth=True, angle=R(70))

mbfr = MB()
for sgn in (1, -1):
    rings = []
    for (s, hw, tz) in CANS:
        x = sgn * hw
        zz = body_top_z(s, hw)
        rings.append([P(x - 0.034, s, zz - 0.050), P(x + 0.034, s, zz - 0.050),
                      P(x + 0.034, s, zz + 0.032), P(x - 0.034, s, zz + 0.032)])
    mbfr._loft_world(rings, True, True, True, 0)
for (idx, sgn_off) in ((0, +1), (6, -1), (len(CANS) - 1, -1)):
    s, hw, tz = CANS[idx]
    th = 0.055
    a0 = canopy_arc(s, hw, tz, 1.0)
    a1 = [(p[0], p[1] + sgn_off * th, p[2]) for p in a0]
    b0 = canopy_arc(s, hw * 0.90, tz - (tz - body_top_z(s, hw)) * 0.10, 1.0)
    b1 = [(p[0], p[1] + sgn_off * th, p[2]) for p in b0]
    mbfr._loft_world([a0, a1], False, mat=0)
    mbfr._loft_world([a1, b1], False, mat=0)
    mbfr._loft_world([b1, b0], False, mat=0)
    mbfr._loft_world([b0, a0], False, mat=0)
mbfr.box(-0.022, 0.022, 3.58, 3.99, 0.68, 1.00, 0)
# mirror on the canopy hinge / rear-view mirrors
for sgn in (1, -1):
    mbfr.box(min(sgn * 0.045, sgn * 0.115), max(sgn * 0.045, sgn * 0.115),
             4.02, 4.10, 1.005, 1.075, 0)
Canopy_Frame = new_obj('Canopy_Frame', mbfr, [CAMO])
set_origin(Canopy_Frame, 0.0, 6.35, 0.80)
finish(Canopy_Frame, bevel=0.004)

# ============================================================= COCKPIT =====
TUB_S0, TUB_S1 = 4.05, 6.28
TIN, TOUT = 0.510, 0.556
mbt = MB()
rings = []
for i in range(12):
    s = lerp(TUB_S0, TUB_S1, i / 11)
    dzi = body_top_z(s, TIN)
    dzo = body_top_z(s, TOUT)
    inner = [(TIN, dzi), (0.486, 0.36), (0.452, 0.135), (0.300, 0.082), (0.0, 0.075)]
    inner = inner + [(-x, z) for (x, z) in reversed(inner[:-1])]
    outer = [(TOUT, dzo + 0.004), (0.540, 0.34), (0.505, 0.100), (0.300, 0.040), (0.0, 0.032)]
    outer = outer + [(-x, z) for (x, z) in reversed(outer[:-1])]
    loop = inner + list(reversed(outer))
    rings.append([P(x, s, z) for (x, z) in loop])
mbt._loft_world(rings, True, True, True, 0)
# coaming above the panel
mbt.add([P(-0.46, 4.28, 0.690), P(0.46, 4.28, 0.690), P(0.50, 4.60, 0.720),
         P(-0.50, 4.60, 0.720), P(-0.46, 4.28, 0.640), P(0.46, 4.28, 0.640),
         P(0.50, 4.60, 0.670), P(-0.50, 4.60, 0.670)],
        [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5],
         [2, 3, 7, 6], [3, 0, 4, 7]], 0)
Cockpit_Tub = new_obj('Cockpit_Tub', mbt, [CD])
set_origin(Cockpit_Tub, 0.0, 5.15, 0.40)
finish(Cockpit_Tub, bevel=0.004)

# ---- instrument panel ----
mbp = MB()


def panel_s(z):
    return 4.560 - 0.20 * (z - 0.235) / 0.477


PC = [(0.455, 0.235), (-0.455, 0.235), (-0.455, 0.712), (0.455, 0.712)]
front = [P(x, panel_s(z), z) for (x, z) in PC]
back = [P(x, panel_s(z) - 0.060, z) for (x, z) in PC]
mbp.add(front + back,
        [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2],
         [2, 6, 7, 3], [3, 7, 4, 0]], 0)
for (gx, gz, gr) in [(0.325, 0.612, 0.055), (0.190, 0.612, 0.055),
                     (-0.190, 0.612, 0.055), (-0.325, 0.612, 0.055),
                     (0.325, 0.468, 0.055), (0.190, 0.468, 0.055),
                     (-0.190, 0.468, 0.055), (-0.325, 0.468, 0.055),
                     (0.325, 0.324, 0.055), (0.190, 0.324, 0.055),
                     (-0.190, 0.324, 0.055), (-0.325, 0.324, 0.055),
                     (0.058, 0.612, 0.048), (-0.058, 0.612, 0.048)]:
    s = panel_s(gz)
    mbp.cyl((gx, s - 0.040, gz), (gx, s, gz), gr, gr, 20, True, 0)
    mbp.cyl((gx, s + 0.0040, gz), (gx, s + 0.0058, gz), gr * 0.84, gr * 0.84, 20, True, 1)
mbp.box(-0.118, 0.118, panel_s(0.42) - 0.025, panel_s(0.42) + 0.002, 0.296, 0.522, 0)
mbp.box(-0.100, 0.100, panel_s(0.42) + 0.002, panel_s(0.42) + 0.007, 0.312, 0.506, 1)
for sgn in (1, -1):
    mbp.box(min(sgn * 0.392, sgn * 0.452), max(sgn * 0.392, sgn * 0.452),
            panel_s(0.26) + 0.001, panel_s(0.26) + 0.009, 0.246, 0.292, 2)
# HUD housing
mbp.box(-0.168, 0.168, 4.245, 4.445, 0.700, 0.790, 0)
mbp.box(-0.148, 0.148, 4.285, 4.405, 0.790, 0.818, 0)
Panel = new_obj('Panel', mbp, [CD, GF, WS])
set_origin(Panel, 0.0, 4.50, 0.40)
finish(Panel, bevel=0.003, angle=R(45))

mbh = MB()
mbh.add([P(-0.148, 4.238, 0.740), P(0.148, 4.238, 0.740),
         P(0.148, 4.182, 0.952), P(-0.148, 4.182, 0.952)],
        [[0, 1, 2, 3], [3, 2, 1, 0]], 0)
HUD_Glass = new_obj('HUD_Glass', mbh, [M('HUD_Glass')])
set_origin(HUD_Glass, 0.0, 4.24, 0.74)
finish(HUD_Glass, bevel=0.0, smooth=False)

for sgn, nm in ((1, 'Console_L'), (-1, 'Console_R')):
    mb = MB()
    x0 = min(sgn * 0.300, sgn * 0.500)
    x1 = max(sgn * 0.300, sgn * 0.500)
    mb.box(x0, x1, 4.62, 6.05, 0.080, 0.415, 0)
    mb.add([P(sgn * 0.300, 4.62, 0.415), P(sgn * 0.500, 4.62, 0.415),
            P(sgn * 0.500, 6.05, 0.415), P(sgn * 0.300, 6.05, 0.415),
            P(sgn * 0.300, 4.62, 0.452), P(sgn * 0.500, 4.62, 0.492),
            P(sgn * 0.500, 6.05, 0.492), P(sgn * 0.300, 6.05, 0.452)],
           [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5],
            [2, 3, 7, 6], [3, 0, 4, 7]], 0)
    for i in range(6):
        s = 4.80 + i * 0.20
        for j in range(3):
            x = sgn * (0.335 + j * 0.058)
            mb.box(min(x - 0.020, x + 0.020), max(x - 0.020, x + 0.020),
                   s, s + 0.052, 0.470, 0.512, 1 if (i + j) % 4 == 0 else 0)
    ob = new_obj(nm, mb, [CD, WS])
    set_origin(ob, sgn * 0.40, 5.34, 0.25)
    finish(ob, bevel=0.003)

# ---- K-36 seat ----
mbse = MB()
SS = 5.36
mbse.box(-0.225, 0.225, SS - 0.18, SS + 0.34, 0.078, 0.215, 0)
mbse.box(-0.210, 0.210, SS - 0.24, SS + 0.05, 0.215, 0.278, 1)
lean = R(17)
bh, bx, bz = 0.62, 0.210, 0.278
top_s = SS + 0.05 + bh * math.sin(lean)
top_z = bz + bh * math.cos(lean)
mbse.add([P(-bx, SS + 0.05, bz), P(bx, SS + 0.05, bz), P(bx, top_s, top_z),
          P(-bx, top_s, top_z), P(-bx, SS + 0.15, bz), P(bx, SS + 0.15, bz),
          P(bx, top_s + 0.10, top_z), P(-bx, top_s + 0.10, top_z)],
         [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5],
          [2, 3, 7, 6], [3, 0, 4, 7]], 1)
mbse.box(-0.180, 0.180, top_s - 0.02, top_s + 0.20, top_z, top_z + 0.30, 0)
mbse.box(-0.200, 0.200, top_s + 0.07, top_s + 0.22, top_z + 0.02, top_z + 0.26, 0)
mbse.box(-0.130, 0.130, top_s - 0.055, top_s - 0.012, top_z + 0.04, top_z + 0.24, 1)
for sgn in (1, -1):
    mbse.box(min(sgn * 0.225, sgn * 0.268), max(sgn * 0.225, sgn * 0.268),
             SS - 0.14, top_s + 0.14, 0.190, top_z + 0.10, 0)
    mbse.add([P(sgn * 0.020, SS + 0.03, 0.292), P(sgn * 0.105, SS + 0.03, 0.292),
              P(sgn * 0.190, top_s - 0.03, top_z + 0.02),
              P(sgn * 0.105, top_s - 0.03, top_z + 0.02)],
             [[0, 1, 2, 3], [3, 2, 1, 0]], 2)
    mbse.box(min(sgn * 0.09, sgn * 0.185), max(sgn * 0.09, sgn * 0.185),
             SS - 0.205, SS - 0.155, 0.272, 0.302, 2)
    mbse.cyl((sgn * 0.06, SS - 0.265, 0.302), (sgn * 0.195, SS - 0.265, 0.302),
             0.022, 0.022, 8, True, 3)
    mbse.cyl((sgn * 0.195, SS - 0.265, 0.302), (sgn * 0.195, SS - 0.135, 0.302),
             0.022, 0.022, 8, True, 3)
mbse.box(-0.10, 0.10, top_s + 0.03, top_s + 0.10, top_z + 0.30, top_z + 0.345, 3)
Seat = new_obj('Seat', mbse, [CD, SF, MBM, WS])
set_origin(Seat, 0.0, SS, 0.078)
finish(Seat, bevel=0.004)

mbk = MB()
mbk.cyl((0.0, 5.03, 0.095), (0.0, 5.03, 0.155), 0.055, 0.040, 12, True, 0)
mbk.cyl((0.0, 5.03, 0.155), (0.0, 4.995, 0.400), 0.030, 0.026, 12, True, 0)
mbk.cyl((0.0, 4.995, 0.400), (0.0, 4.985, 0.468), 0.038, 0.042, 12, True, 0)
mbk.box(-0.040, 0.040, 4.938, 5.030, 0.468, 0.560, 0)
mbk.cyl((0.0, 4.938, 0.520), (0.0, 4.912, 0.520), 0.024, 0.020, 8, True, 1)
Stick = new_obj('Stick', mbk, [CD, WS])
set_origin(Stick, 0.0, 5.03, 0.095)
finish(Stick, bevel=0.003)

mbth = MB()
mbth.box(0.300, 0.450, 4.92, 5.34, 0.415, 0.472, 0)
for i in (0, 1):
    x = 0.338 + i * 0.066
    mbth.cyl((x, 5.29, 0.458), (x, 5.03, 0.560), 0.024, 0.024, 10, True, 0)
    mbth.cyl((x, 5.03, 0.560), (x, 4.97, 0.578), 0.036, 0.030, 10, True, 0)
Throttles = new_obj('Throttles', mbth, [CD])
set_origin(Throttles, 0.375, 5.31, 0.445)
finish(Throttles, bevel=0.003)

mbrp = MB()
for sgn in (1, -1):
    x = sgn * 0.135
    mbrp.box(min(x - 0.055, x + 0.055), max(x - 0.055, x + 0.055),
             4.24, 4.30, 0.090, 0.245, 0)
    mbrp.box(min(x - 0.030, x + 0.030), max(x - 0.030, x + 0.030),
             4.30, 4.58, 0.085, 0.115, 0)
Rudder_Pedals = new_obj('Rudder_Pedals', mbrp, [CD])
set_origin(Rudder_Pedals, 0.0, 4.30, 0.11)
finish(Rudder_Pedals, bevel=0.003)

# =============================================================== GEAR ======
HS, HZ = 6.95, -0.720
AS_, AZ = 6.600, -1.630
mbng = MB()
mbng.cyl((0.0, HS, HZ), (0.0, AS_ + 0.02, AZ + 0.30), 0.070, 0.058, 14, True, 0)
mbng.cyl((0.0, AS_ + 0.02, AZ + 0.32), (0.0, AS_, AZ), 0.050, 0.046, 14, True, 0)
mbng.cyl((-0.135, AS_, AZ), (0.135, AS_, AZ), 0.032, 0.032, 12, True, 0)
mbng.cyl((0.0, HS - 0.05, HZ - 0.03), (0.0, 7.32, -1.15), 0.036, 0.030, 10, True, 0)
for sgn in (1, -1):
    mbng.cyl((sgn * 0.055, HS - 0.19, HZ - 0.36), (sgn * 0.055, AS_ + 0.06, AZ + 0.30),
             0.020, 0.020, 8, True, 0)
mbng.box(-0.075, 0.075, AS_ - 0.115, AS_ - 0.055, AZ + 0.36, AZ + 0.50, 1)
Gear_Nose = new_obj('Gear_Nose', mbng, [MBM, M('Light_White')])
set_origin(Gear_Nose, 0.0, HS, HZ)
finish(Gear_Nose, bevel=0.004)


def wheel(name, cx, cs, cz, rad, wid):
    mb = MB()
    NW = 24
    prof = [(-wid * 0.5, rad * 0.70), (-wid * 0.5, rad * 0.92),
            (-wid * 0.40, rad), (wid * 0.40, rad),
            (wid * 0.5, rad * 0.92), (wid * 0.5, rad * 0.70)]
    rings = [[P(cx + dx, cs + r * math.cos(TAU * i / NW), cz + r * math.sin(TAU * i / NW))
              for i in range(NW)] for (dx, r) in prof]
    mb._loft_world(rings, True, False, False, 0)
    for dx in (-wid * 0.5, wid * 0.5):
        r2 = [[P(cx + dx, cs + rad * 0.70 * math.cos(TAU * i / NW),
                 cz + rad * 0.70 * math.sin(TAU * i / NW)) for i in range(NW)],
              [P(cx + dx * 0.50, cs + rad * 0.40 * math.cos(TAU * i / NW),
                 cz + rad * 0.40 * math.sin(TAU * i / NW)) for i in range(NW)]]
        mb._loft_world(r2, True, False, True, 1)
    ob = new_obj(name, mb, [M('Rubber_Tire'), MBM])
    set_origin(ob, cx, cs, cz)
    finish(ob, bevel=0.004, angle=R(45))
    return ob


Wheel_Nose = wheel('Wheel_Nose', 0.0, AS_, AZ, 0.270, 0.180)

MHX, MHS, MHZ = 1.300, 10.250, -0.550
MAX_, MAS, MAZ = 1.545, 10.250, -1.550
mbmg = MB()
mbmg.cyl((MHX, MHS, MHZ), (MAX_ - 0.01, MAS, MAZ + 0.34), 0.080, 0.062, 14, True, 0)
mbmg.cyl((MAX_ - 0.01, MAS, MAZ + 0.36), (MAX_, MAS, MAZ), 0.055, 0.050, 14, True, 0)
mbmg.cyl((MAX_ - 0.05, MAS, MAZ), (MAX_ + 0.26, MAS, MAZ), 0.038, 0.038, 12, True, 0)
mbmg.cyl((MHX - 0.06, MHS + 0.02, MHZ - 0.03), (MAX_ - 0.07, MAS + 0.66, MAZ + 0.44),
         0.036, 0.030, 10, True, 0)
mbmg.cyl((MHX + 0.10, MHS - 0.09, MHZ - 0.40), (MAX_ - 0.02, MAS - 0.09, MAZ + 0.34),
         0.022, 0.022, 8, True, 0)
Gear_L = new_obj('Gear_L', mbmg, [MBM])
set_origin(Gear_L, MHX, MHS, MHZ)
finish(Gear_L, bevel=0.004)
Wheel_L = wheel('Wheel_L', MAX_ + 0.16, MAS, MAZ, 0.350, 0.230)

mbd = MB()
mbd.box(0.278, 0.318, 5.95, 7.00, -0.96, -0.62, 0)
GearDoor_Nose = new_obj('GearDoor_Nose', mbd, [CAMO])
set_origin(GearDoor_Nose, 0.298, 6.475, -0.62)
finish(GearDoor_Nose, bevel=0.004)
GearDoor_Nose.rotation_euler = (0, R(-28), 0)

mbd2 = MB()
mbd2.box(1.400, 1.440, 9.60, 11.00, -1.02, -0.62, 0)
GearDoor_L = new_obj('GearDoor_L', mbd2, [CAMO])
set_origin(GearDoor_L, 1.420, 10.30, -0.62)
finish(GearDoor_L, bevel=0.004)
GearDoor_L.rotation_euler = (0, R(-24), 0)

GS = 6.36
GX0, GX1, GZ0, GZ1 = 0.640, 1.360, -0.905, -0.470
mbg = MB()
mbg.box(GX0, GX1, GS, GS + 0.030, GZ0, GZ0 + 0.035, 0)
mbg.box(GX0, GX1, GS, GS + 0.030, GZ1 - 0.035, GZ1, 0)
mbg.box(GX0, GX0 + 0.035, GS, GS + 0.030, GZ0, GZ1, 0)
mbg.box(GX1 - 0.035, GX1, GS, GS + 0.030, GZ0, GZ1, 0)
for i in range(9):
    x = lerp(GX0 + 0.055, GX1 - 0.055, i / 8)
    mbg.box(x - 0.008, x + 0.008, GS + 0.006, GS + 0.021, GZ0 + 0.030, GZ1 - 0.030, 0)
for i in range(5):
    zz = lerp(GZ0 + 0.055, GZ1 - 0.055, i / 4)
    mbg.box(GX0 + 0.030, GX1 - 0.030, GS + 0.008, GS + 0.019, zz - 0.008, zz + 0.008, 0)
IntakeGrille_L = new_obj('IntakeGrille_L', mbg, [MBM])
set_origin(IntakeGrille_L, 1.000, GS, GZ1)
finish(IntakeGrille_L, bevel=0.002, angle=R(45))

# ========================================================== MIRRORING =====
PAIRS = [(Wing_L, 'Wing_R'), (Slat_L, 'Slat_R'), (Flap_L, 'Flap_R'),
         (Aileron_L, 'Aileron_R'), (Fin_L, 'Fin_R'), (Rudder_L, 'Rudder_R'),
         (Stabilator_L, 'Stabilator_R'), (Nozzle_L, 'Nozzle_R'),
         (Gear_L, 'Gear_R'), (Wheel_L, 'Wheel_R'), (GearDoor_L, 'GearDoor_R'),
         (IntakeGrille_L, 'IntakeGrille_R')]
MIR = {}
for src, nm in PAIRS:
    nb = mirror_object(src, nm)
    nb.rotation_euler = (src.rotation_euler.x, -src.rotation_euler.y,
                         -src.rotation_euler.z)
    MIR[nm] = nb
wr = MIR['Wing_R']
for i, sl in enumerate(wr.data.materials):
    if sl and sl.name.startswith('Light_Red'):
        wr.data.materials[i] = M('Light_Green')

# ============================================================ EMPTIES =====
Mig29 = empty('Mig29', 0, S0, 0, 1.0)
Cockpit = empty('Cockpit', 0, S0, 0, 0.4)
E = {}
E['Camera_Pilot'] = empty('Camera_Pilot', 0.0, 4.960, 0.980, 0.10)
E['Nozzle_Exit_L'] = empty('Nozzle_Exit_L', NOZ_CX, NOZ_S1, NOZ_CZ, 0.20)
E['Nozzle_Exit_R'] = empty('Nozzle_Exit_R', -NOZ_CX, NOZ_S1, NOZ_CZ, 0.20)
E['Wingtip_L'] = empty('Wingtip_L', 5.690, 11.95, 0.030, 0.10)
E['Wingtip_R'] = empty('Wingtip_R', -5.690, 11.95, 0.030, 0.10)
E['LERX_L'] = empty('LERX_L', 1.150, 6.900, body_top_z(6.90, 1.15) + 0.01, 0.10)
E['LERX_R'] = empty('LERX_R', -1.150, 6.900, body_top_z(6.90, 1.15) + 0.01, 0.10)
E['Contact_Nose'] = empty('Contact_Nose', 0.0, AS_, -1.900, 0.10)
E['Contact_L'] = empty('Contact_L', MAX_ + 0.16, MAS, -1.900, 0.10)
E['Contact_R'] = empty('Contact_R', -(MAX_ + 0.16), MAS, -1.900, 0.10)
le_, ch_, z_, tc_ = wing_geom(5.60)
E['Nav_L'] = empty('Nav_L', 5.700, le_ + 0.10, z_ + 0.012, 0.08)
E['Nav_R'] = empty('Nav_R', -5.700, le_ + 0.10, z_ + 0.012, 0.08)
E['Beacon'] = empty('Beacon', 0.0, 8.400, BEACON_Z + 0.070, 0.08)
E['Strobe_Tail'] = empty('Strobe_Tail', 0.0, 15.28, 0.190, 0.08)

# ============================================================ HIERARCHY ===
for nm in ['Panel', 'HUD_Glass', 'Console_L', 'Console_R', 'Stick',
           'Throttles', 'Seat', 'Rudder_Pedals', 'Cockpit_Tub']:
    parent_to(bpy.data.objects[nm], Cockpit)
parent_to(Cockpit, Mig29)
parent_to(E['Camera_Pilot'], Cockpit)
for nm, gp in (('Wheel_Nose', 'Gear_Nose'), ('Wheel_L', 'Gear_L'), ('Wheel_R', 'Gear_R')):
    parent_to(bpy.data.objects[nm], bpy.data.objects[gp])
TOP = ['Fuselage', 'Wing_L', 'Wing_R', 'Aileron_L', 'Aileron_R', 'Flap_L',
       'Flap_R', 'Slat_L', 'Slat_R', 'Stabilator_L', 'Stabilator_R',
       'Rudder_L', 'Rudder_R', 'Airbrake', 'Fin_L', 'Fin_R', 'Nozzle_L',
       'Nozzle_R', 'Canopy_Glass', 'Canopy_Frame', 'Gear_Nose', 'Gear_L',
       'Gear_R', 'GearDoor_Nose', 'GearDoor_L', 'GearDoor_R',
       'IntakeGrille_L', 'IntakeGrille_R', 'Nozzle_Exit_L', 'Nozzle_Exit_R',
       'Wingtip_L', 'Wingtip_R', 'LERX_L', 'LERX_R', 'Contact_Nose',
       'Contact_L', 'Contact_R', 'Nav_L', 'Nav_R', 'Beacon', 'Strobe_Tail']
for nm in TOP:
    parent_to(bpy.data.objects[nm], Mig29)

# ================================================================= UV =====
bpy.ops.object.select_all(action='DESELECT')
fails = []
for ob in list(bpy.data.objects):
    if ob.type != 'MESH':
        continue
    try:
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
        bpy.ops.object.mode_set(mode='OBJECT')
    except Exception as ex:
        fails.append((ob.name, str(ex)[:60]))
        try:
            bpy.ops.object.mode_set(mode='OBJECT')
        except Exception:
            pass
    ob.select_set(False)
print('UV FAILS:', fails)

# ============================================================== SAVE ======
dg = bpy.context.evaluated_depsgraph_get()
tri = 0
per = []
for ob in bpy.data.objects:
    if ob.type != 'MESH':
        continue
    eo = ob.evaluated_get(dg)
    d = eo.to_mesh()
    t = sum(len(p.vertices) - 2 for p in d.polygons)
    per.append((t, ob.name))
    tri += t
    eo.to_mesh_clear()
per.sort(reverse=True)
print('TRI TOTAL %d' % tri)
print('TOP OBJECTS:', per[:12])
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'mig29.blend'))
print('SAVED')
