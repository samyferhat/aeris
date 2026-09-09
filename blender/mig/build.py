"""MiG-29 Fulcrum airframe.  Run headless:
   Blender --background --factory-startup --python blender/mig/build.py
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import mlib
import importlib
importlib.reload(mlib)
from mlib import (S0, P, cr_chain, lerp, sample_table, airfoil_slice, MB,
                  new_obj, clean, cut_faces, set_origin, finish, mirror_object,
                  empty, parent_to, make_mat)

R = math.radians

# ---------------------------------------------------------------- scene ----
for c in (bpy.data.objects, bpy.data.meshes, bpy.data.materials,
          bpy.data.cameras, bpy.data.lights):
    for x in list(c):
        c.remove(x)

MAT = {}
def M(n): return MAT[n]

MAT['Paint_Camo']    = make_mat('Paint_Camo',    (0.42, 0.47, 0.52), 0.55, 0.0)
MAT['Radome']        = make_mat('Radome',        (0.035, 0.035, 0.04), 0.40, 0.0)
MAT['Metal_Nozzle']  = make_mat('Metal_Nozzle',  (0.55, 0.54, 0.52), 0.35, 1.0)
MAT['Metal_Bare']    = make_mat('Metal_Bare',    (0.72, 0.73, 0.75), 0.30, 1.0)
MAT['Canopy']        = make_mat('Canopy',        (0.78, 0.70, 0.45), 0.05, 0.0, 0.25, 1.45)
MAT['HUD_Glass']     = make_mat('HUD_Glass',     (0.80, 0.90, 0.82), 0.04, 0.0, 0.12, 1.45)
MAT['Cockpit_Dark']  = make_mat('Cockpit_Dark',  (0.055, 0.065, 0.055), 0.80, 0.0)
MAT['Gauge_Faces']   = make_mat('Gauge_Faces',   (0.020, 0.020, 0.022), 0.30, 0.0)
MAT['Seat_Fabric']   = make_mat('Seat_Fabric',   (0.10, 0.11, 0.09), 0.90, 0.0)
MAT['Rubber_Tire']   = make_mat('Rubber_Tire',   (0.030, 0.030, 0.032), 0.85, 0.0)
MAT['Light_Red']     = make_mat('Light_Red',     (0.60, 0.03, 0.03), 0.15, 0.0)
MAT['Light_Green']   = make_mat('Light_Green',   (0.03, 0.55, 0.10), 0.15, 0.0)
MAT['Light_White']   = make_mat('Light_White',   (0.85, 0.85, 0.85), 0.15, 0.0)
MAT['Warning_Stripe']= make_mat('Warning_Stripe',(0.72, 0.55, 0.03), 0.55, 0.0)

# ================================================================ BODY =====
# master station table, all params sampled together so they interpolate as one
#        S      zt      zb      W     crr     zm     tun    ch
BODY = [
    (0.00, -0.030, -0.070, 0.020, 0.97, -0.050, 0.00, 0.00),
    (0.30,  0.100, -0.200, 0.160, 0.97, -0.050, 0.00, 0.00),
    (0.70,  0.240, -0.310, 0.300, 0.97, -0.030, 0.00, 0.00),
    (1.20,  0.360, -0.380, 0.420, 0.97,  0.000, 0.00, 0.05),
    (1.80,  0.460, -0.440, 0.520, 0.96,  0.020, 0.00, 0.10),
    (2.30,  0.530, -0.480, 0.580, 0.95,  0.040, 0.00, 0.20),
    (2.90,  0.600, -0.530, 0.660, 0.93,  0.050, 0.00, 0.40),
    (3.50,  0.665, -0.580, 0.800, 0.86,  0.060, 0.02, 0.75),
    (4.30,  0.700, -0.645, 1.000, 0.72,  0.080, 0.06, 0.95),
    (5.30,  0.720, -0.745, 1.200, 0.60,  0.090, 0.14, 1.00),
    (6.30,  0.775, -0.860, 1.450, 0.55,  0.110, 0.24, 1.00),
    (6.75,  0.865, -0.890, 1.520, 0.55,  0.115, 0.28, 1.00),
    (7.20,  0.905, -0.920, 1.580, 0.56,  0.120, 0.32, 1.00),
    (8.20,  0.895, -0.960, 1.720, 0.60,  0.130, 0.40, 1.00),
    (9.20,  0.860, -0.980, 1.790, 0.66,  0.130, 0.42, 0.95),
    (10.30, 0.810, -0.980, 1.810, 0.72,  0.130, 0.42, 0.90),
    (11.40, 0.755, -0.970, 1.800, 0.78,  0.120, 0.42, 0.85),
    (12.50, 0.695, -0.940, 1.780, 0.85,  0.110, 0.40, 0.80),
    (13.45, 0.640, -0.880, 1.740, 0.92,  0.100, 0.36, 0.75),
    (14.00, 0.580, -0.720, 1.450, 0.95,  0.090, 0.22, 0.60),
    (14.50, 0.500, -0.460, 1.050, 0.96,  0.080, 0.10, 0.40),
    (15.00, 0.400, -0.150, 0.600, 0.96,  0.100, 0.02, 0.20),
    (15.30, 0.280,  0.100, 0.160, 0.96,  0.190, 0.00, 0.00),
]

NRING = 78
KHALF = 13
BODY_S = cr_chain(BODY, NRING)


def body_half(zt, zb, W, crr, zm, tun, ch, k=KHALF):
    Hu = max(zt - zm, 1e-4)
    Hl = max(zm - zb, 1e-4)
    e = 0.10 + 0.25 * ch
    t_up = Hu * (0.35 * (1 - ch) + 0.02 * ch)
    t_lo = Hl * (0.30 * (1 - ch) + 0.05 * ch)
    up = cr_chain([(0.0, zt),
                   (W * crr * 0.55, zt - 0.14 * Hu),
                   (W * crr * 0.92, zm + 0.62 * Hu),
                   (W * (1 - e), zm + t_up),
                   (W, zm)], k)
    lo = cr_chain([(W, zm),
                   (W * (1 - e), zm - t_lo),
                   (W * (1 - e) * 0.90, zb + 0.42 * Hl),
                   (W * 0.45, zb + 0.12 * tun),
                   (0.0, zb + tun)], k)
    return up + lo[1:]


def body_ring(prm):
    s, zt, zb, W, crr, zm, tun, ch = prm
    half = body_half(zt, zb, W, crr, zm, tun, ch)
    ring = half + [(-x, z) for (x, z) in reversed(half[1:-1])]
    return [P(x, s, z) for (x, z) in ring]


def body_top_z(s, x):
    """upper-surface z of the body at station s, |x| <= W"""
    prm = None
    for i in range(len(BODY_S) - 1):
        if BODY_S[i][0] <= s <= BODY_S[i + 1][0]:
            t = (s - BODY_S[i][0]) / max(BODY_S[i + 1][0] - BODY_S[i][0], 1e-6)
            prm = tuple(lerp(a, b, t) for a, b in zip(BODY_S[i], BODY_S[i + 1]))
            break
    if prm is None:
        prm = BODY_S[-1] if s > BODY_S[-1][0] else BODY_S[0]
    half = body_half(*prm[1:])
    ax = abs(x)
    best = half[0][1]
    for i in range(len(half) - 1):
        a, b = half[i], half[i + 1]
        if min(a[0], b[0]) <= ax <= max(a[0], b[0]) and b[1] >= prm[5] - 1e-6:
            t = (ax - a[0]) / max(b[0] - a[0], 1e-9)
            return lerp(a[1], b[1], t)
    return best


fus = MB()
rings = [body_ring(p) for p in BODY_S]
# material 0 paint, 1 radome, 2 metal bare, 3 cockpit dark, 4 nozzle metal
# build the loft ring by ring so we can pick the radome material by station
n = len(rings[0])
for i in range(len(rings) - 1):
    s_mid = 0.5 * (BODY_S[i][0] + BODY_S[i + 1][0])
    mat = 1 if s_mid < 2.35 else 0
    a, b = rings[i], rings[i + 1]
    fus.add(a + b, [[j, (j + 1) % n, n + (j + 1) % n, n + j] for j in range(n)], mat)
# nose cap + tail cap
fus.add(rings[0] + [mlib._centroid(rings[0])],
        [[n, (j + 1) % n, j] for j in range(n)], 1)
fus.add(rings[-1] + [mlib._centroid(rings[-1])],
        [[n, j, (j + 1) % n] for j in range(n)], 0)

# ---- pitot boom -----------------------------------------------------------
fus.cyl((0.0, -1.05, -0.075), (0.0, -0.55, -0.062), 0.012, 0.020, 10, True, 2)
fus.cyl((0.0, -0.55, -0.062), (0.0, 0.05, -0.045), 0.020, 0.034, 10, True, 2)
# yaw vanes
for sgn in (1, -1):
    fus.box(sgn * 0.020, sgn * 0.075, -0.72, -0.60, -0.070, -0.055, 2)
fus.box(-0.012, 0.012, -0.72, -0.60, -0.075, -0.020, 2)

# ---- nacelles -------------------------------------------------------------
NAC = [(8.20, 0.700, -0.290, 1.055), (9.00, 0.735, -0.315, 1.075),
       (10.00, 0.745, -0.335, 1.090), (11.00, 0.740, -0.355, 1.095),
       (12.00, 0.725, -0.375, 1.100), (13.00, 0.700, -0.392, 1.100),
       (13.80, 0.665, -0.405, 1.100), (14.30, 0.632, -0.415, 1.100),
       (14.65, 0.608, -0.420, 1.100)]
NACS = cr_chain(NAC, 24)
NSEG = 26
for sgn in (1, -1):
    rr = []
    for (s, r, cz, cx) in NACS:
        ring = []
        for i in range(NSEG):
            a = TAU_i = math.pi * 2 * i / NSEG
            # slightly flattened top where it merges with the body
            rad = r * (1.0 - 0.06 * max(0.0, math.sin(a)) ** 2)
            ring.append(P(sgn * (cx + rad * math.cos(a)), s, cz + rad * math.sin(a)))
        rr.append(ring)
    fus._loft_world(rr, True, True, False, 0)
    # rim from nacelle skin inward to the tailpipe at the petal-ring station
    last = NACS[-1]
    inner = []
    outer = []
    for i in range(NSEG):
        a = math.pi * 2 * i / NSEG
        rad = last[1] * (1.0 - 0.06 * max(0.0, math.sin(a)) ** 2)
        outer.append(P(sgn * (last[3] + rad * math.cos(a)), last[0],
                       last[2] + rad * math.sin(a)))
        inner.append(P(sgn * (last[3] + 0.560 * math.cos(a)), last[0] + 0.02,
                       last[2] + 0.560 * math.sin(a)))
    fus._loft_world([outer, inner], True, False, False, 4)
    # tailpipe interior (normals inward)
    tp = []
    for (s, r) in ((13.20, 0.575), (14.10, 0.570), (14.65, 0.560),
                   (15.05, 0.545), (15.28, 0.535)):
        tp.append([P(sgn * (1.100 + r * math.cos(math.pi * 2 * i / NSEG)), s,
                     -0.410 + r * math.sin(math.pi * 2 * i / NSEG))
                   for i in range(NSEG)])
    fus._loft_world(tp, True, False, False, 4, flip=True)
    # flame holder / turbine face
    fus.cyl((sgn * 1.100, 13.05, -0.410), (sgn * 1.100, 13.35, -0.410),
            0.20, 0.15, 14, True, 4)
    for i in range(12):
        a = math.pi * 2 * i / 12
        fus.box(sgn * (1.100 - 0.02), sgn * (1.100 + 0.02), 13.15, 13.30,
                -0.41 - 0.55, -0.41 + 0.55, 4)
    # radial vanes as thin plates
    for i in range(10):
        a = math.pi * i / 10
        c, s_ = math.cos(a), math.sin(a)
        vv = []
        for (rr0, rr1) in ((0.19, 0.56),):
            for zz in (-0.012, 0.012):
                pass
        p0 = (sgn * (1.100 + 0.19 * c), 13.18, -0.410 + 0.19 * s_)
        p1 = (sgn * (1.100 + 0.56 * c), 13.18, -0.410 + 0.56 * s_)
        p2 = (sgn * (1.100 - 0.19 * c), 13.18, -0.410 - 0.19 * s_)
        p3 = (sgn * (1.100 - 0.56 * c), 13.18, -0.410 - 0.56 * s_)
        fus.cyl(p0, p1, 0.018, 0.018, 6, True, 4)
        fus.cyl(p2, p3, 0.018, 0.018, 6, True, 4)

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
            a = math.pi * 2 * i / BSEG
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


def rect_ring(cx, hw, cz, hh, s, sgn, seg=ISEG, nn=4.0, shrink=1.0):
    ring = []
    for i in range(seg):
        a = math.pi * 2 * i / seg
        ca, sa = math.cos(a), math.sin(a)
        x = cx + hw * shrink * math.copysign(abs(ca) ** (2.0 / nn), ca)
        z = cz + hh * shrink * math.copysign(abs(sa) ** (2.0 / nn), sa)
        return_ = None
        ring.append(P(sgn * x, s, z))
    return ring


for sgn in (1, -1):
    rr = [rect_ring(cx, hw, cz, hh, s, sgn) for (s, cx, hw, cz, hh) in INTS]
    fus._loft_world(rr, True, False, True, 0)
    # lip: roll the mouth inward
    m0 = INTS[0]
    lip_a = rect_ring(m0[1], m0[2], m0[3], m0[4], m0[0], sgn)
    lip_b = rect_ring(m0[1], m0[2], m0[3], m0[4], m0[0] + 0.09, sgn, shrink=0.88)
    fus._loft_world([lip_a, lip_b], True, False, False, 0)
    # dark throat behind the lip
    thr = [rect_ring(m0[1], m0[2], m0[3], m0[4], m0[0] + 0.09, sgn, shrink=0.88),
           rect_ring(1.04, 0.36, -0.74, 0.27, 7.10, sgn, shrink=1.0),
           rect_ring(1.06, 0.31, -0.78, 0.24, 8.00, sgn, shrink=1.0)]
    fus._loft_world(thr, True, False, True, 3, flip=True)
    # variable intake ramp on the upper duct wall
    fus.add([P(sgn * (1.00 - 0.33), 6.45, -0.455), P(sgn * (1.00 + 0.33), 6.45, -0.455),
             P(sgn * (1.00 + 0.30), 7.60, -0.610), P(sgn * (1.00 - 0.30), 7.60, -0.610),
             P(sgn * (1.00 - 0.33), 6.45, -0.485), P(sgn * (1.00 + 0.33), 6.45, -0.485),
             P(sgn * (1.00 + 0.30), 7.60, -0.640), P(sgn * (1.00 - 0.30), 7.60, -0.640)],
            [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5],
             [2, 3, 7, 6], [3, 0, 4, 7]], 3)

# ---- dorsal / lateral greebles -------------------------------------------
# LERX louvre panels (auxiliary intake doors on top of the LERX)
for sgn in (1, -1):
    for i in range(5):
        s = 6.55 + i * 0.30
        x0 = sgn * 0.62
        x1 = sgn * 1.18
        z = body_top_z(s, 0.90) + 0.004
        fus.add([P(x0, s, z), P(x1, s, z), P(x1, s + 0.20, z), P(x0, s + 0.20, z)],
                [[0, 1, 2, 3]], 3)
# antenna blades on the spine
for (s, h) in ((7.55, 0.17), (11.90, 0.13)):
    z = body_top_z(s, 0.0)
    fus.add([P(-0.016, s, z), P(0.016, s, z), P(0.016, s + 0.30, z), P(-0.016, s + 0.30, z),
             P(-0.010, s + 0.12, z + h), P(0.010, s + 0.12, z + h),
             P(0.010, s + 0.28, z + h), P(-0.010, s + 0.28, z + h)],
            [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5],
             [2, 3, 7, 6], [3, 0, 4, 7]], 0)
# beacon lens on the spine
fus.cyl((0.0, 8.35, body_top_z(8.35, 0.0) - 0.02),
        (0.0, 8.35, body_top_z(8.35, 0.0) + 0.075), 0.055, 0.038, 12, True, 0)
# gun fairing on the left LERX
fus.add([P(0.60, 4.95, 0.135), P(1.05, 4.95, 0.130), P(1.05, 5.70, 0.128), P(0.60, 5.70, 0.133),
         P(0.60, 4.95, 0.215), P(1.05, 4.95, 0.210), P(1.05, 5.70, 0.205), P(0.60, 5.70, 0.212)],
        [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5],
         [2, 3, 7, 6], [3, 0, 4, 7]], 0)

# ---- bays -----------------------------------------------------------------
fus.box_open_bottom(-0.30, 0.30, 5.90, 7.05, -0.62, -0.24, 3)
for sgn in (1, -1):
    fus.box_open_bottom(min(sgn * 0.72, sgn * 1.42), max(sgn * 0.72, sgn * 1.42),
                        9.55, 11.05, -1.00, -0.52, 3)

FUS_MATS = [M('Paint_Camo'), M('Radome'), M('Metal_Bare'), M('Cockpit_Dark'),
            M('Metal_Nozzle')]
Fuselage = new_obj('Fuselage', fus, FUS_MATS)
# cockpit opening + gear bay openings
cut_faces(Fuselage, -0.62, 0.62, 3.95, 6.32, 0.30, 1.20, nz=1)
cut_faces(Fuselage, -0.32, 0.32, 5.92, 7.03, -1.10, -0.40, nz=-1)
for sgn in (1, -1):
    cut_faces(Fuselage, min(sgn * 0.70, sgn * 1.44), max(sgn * 0.70, sgn * 1.44),
              9.57, 11.03, -1.20, -0.80, nz=-1)
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


def wing_piece(name, c0, c1, x0, x1, nspan, mat, npts=15, cap0=True, cap1=True):
    mb = MB()
    xs = [lerp(x0, x1, i / (nspan - 1)) for i in range(nspan)]
    rings = []
    for x in xs:
        le, ch, z, tc = wing_geom(x)
        sl = airfoil_slice(c0, c1, tc, npts)
        rings.append([P(x, le + u * ch, z + v * ch) for (u, v) in sl])
    mb._loft_world(rings, True, cap0, cap1, mat)
    return mb


# main wing box 16.5% -> 71.5% chord, plus tip fairing and wingtip rail
mbw = wing_piece('w', 0.165, 0.715, WR_X, 5.58, 14, 0)
# tip fairing: full chord, rounded
xs = [5.58, 5.645, 5.680]
rings = []
for i, x in enumerate(xs):
    le, ch, z, tc = wing_geom(x)
    sc = (1.0, 0.72, 0.22)[i]
    sl = airfoil_slice(0.0, 1.0, tc, 17)
    cu = 0.5
    rings.append([P(x, le + (cu + (u - cu) * (1.0 if i == 0 else sc)) * ch,
                    z + v * ch * (1.0 if i == 0 else sc)) for (u, v) in sl])
mbw._loft_world(rings, True, False, True, 0)
# wingtip missile rail
le, ch, z, tc = wing_geom(5.60)
mbw.cyl((5.60, le + 0.10 * ch, z - 0.075), (5.60, le + 0.98 * ch, z - 0.075),
        0.045, 0.045, 12, True, 0)
mbw.cyl((5.60, le - 0.28, z - 0.075), (5.60, le + 0.10 * ch, z - 0.075),
        0.010, 0.045, 12, True, 0)
# nav light lens on the tip
mbw.cyl((5.66, le + 0.06, z + 0.005), (5.72, le + 0.06, z + 0.005),
        0.05, 0.035, 10, True, 1)
Wing_L = new_obj('Wing_L', mbw, [M('Paint_Camo'), M('Light_Red')])
set_origin(Wing_L, 0, S0, 0)
finish(Wing_L, bevel=0.005)

mbs = wing_piece('s', 0.0, 0.152, 1.74, 5.55, 12, 0)
Slat_L = new_obj('Slat_L', mbs, [M('Paint_Camo')])
set_origin(Slat_L, 1.74, W_LE_R + 0.13 * (W_TE_R - W_LE_R), W_Z_R)
finish(Slat_L, bevel=0.004)

mbf = wing_piece('f', 0.728, 1.0, 1.74, 3.58, 8, 0)
Flap_L = new_obj('Flap_L', mbf, [M('Paint_Camo')])
le, ch, z, tc = wing_geom(1.74)
set_origin(Flap_L, 1.74, le + 0.728 * ch, z)
finish(Flap_L, bevel=0.004)

mba = wing_piece('a', 0.728, 1.0, 3.66, 5.55, 8, 0)
Aileron_L = new_obj('Aileron_L', mba, [M('Paint_Camo')])
le, ch, z, tc = wing_geom(3.66)
set_origin(Aileron_L, 3.66, le + 0.728 * ch, z)
finish(Aileron_L, bevel=0.004)

# ================================================================ FINS =====
F_X0, F_Z0 = 1.860, 0.420
F_H = 2.337
F_DX = 0.246
F_LE_R, F_CH_R = 10.30, 4.00
F_LE_T, F_CH_T = 12.75, 1.45
F_T_R, F_T_T = 0.150, 0.062


def fin_piece(c0, c1, h0, h1, nsp, mat, npts=14, cap0=True, cap1=True, sgn=1):
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
        rings.append([P(sgn * (x + v * ch), le + u * ch, z) for (u, v) in sl])
    if sgn < 0:
        rings = [list(reversed(r)) for r in rings]
    mb._loft_world(rings, True, cap0, cap1, mat)
    return mb


mbfin = fin_piece(0.0, 0.700, -0.04, 1.0, 12, 0)
# fin-tip RWR fairing + formation light
mbfin.box(F_X0 + F_DX - 0.05, F_X0 + F_DX + 0.05, F_LE_T + 0.30, F_LE_T + 1.42,
          F_Z0 + F_H, F_Z0 + F_H + 0.075, 0)
# flare/chaff box on the outer face
mbfin.box(F_X0 + 0.09 + 0.10 * 0.6, F_X0 + 0.09 + 0.10 * 0.6 + 0.05,
          F_LE_R + 1.55, F_LE_R + 2.60, F_Z0 + 0.30, F_Z0 + 0.62, 0)
mbfin.cyl((F_X0 + F_DX, F_LE_T + 1.30, F_Z0 + F_H + 0.038),
          (F_X0 + F_DX, F_LE_T + 1.44, F_Z0 + F_H + 0.038), 0.035, 0.022, 8, True, 1)
Fin_L = new_obj('Fin_L', mbfin, [M('Paint_Camo'), M('Light_White')])
set_origin(Fin_L, F_X0, F_LE_R, F_Z0)
finish(Fin_L, bevel=0.005)

mbrud = fin_piece(0.722, 1.0, 0.02, 0.985, 10, 0)
Rudder_L = new_obj('Rudder_L', mbrud, [M('Paint_Camo')])
set_origin(Rudder_L, F_X0 + F_DX * 0.5, F_LE_R + 0.722 * F_CH_R - 0.30, F_Z0 + F_H * 0.5)
finish(Rudder_L, bevel=0.004)

# ========================================================= STABILATORS =====
T_X0, T_X1 = 1.700, 3.890
T_LE_R, T_CH_R = 13.30, 2.45
T_LE_T, T_CH_T = 15.56, 0.74
T_Z_R, T_Z_T = -0.060, -0.100
T_TC = 0.055
mbst = MB()
rings = []
for i in range(12):
    t = i / 11
    x = lerp(T_X0, T_X1, t)
    le = lerp(T_LE_R, T_LE_T, t)
    ch = lerp(T_CH_R, T_CH_T, t)
    z = lerp(T_Z_R, T_Z_T, t)
    sl = airfoil_slice(0.0, 1.0, T_TC, 17)
    rings.append([P(x, le + u * ch, z + v * ch) for (u, v) in sl])
mbst._loft_world(rings, True, True, True, 0)
Stabilator_L = new_obj('Stabilator_L', mbst, [M('Paint_Camo')])
set_origin(Stabilator_L, 1.560, T_LE_R + 0.35 * T_CH_R, T_Z_R)
finish(Stabilator_L, bevel=0.005)

# ============================================================ AIRBRAKE =====
AB_S0, AB_S1, AB_HW = 8.90, 10.35, 0.500
mbab = MB()
top = []
bot = []
NS, NX = 8, 9
for i in range(NS):
    s = lerp(AB_S0, AB_S1, i / (NS - 1))
    rt, rb = [], []
    for j in range(NX):
        x = lerp(-AB_HW, AB_HW, j / (NX - 1))
        z = body_top_z(s, x)
        rt.append(P(x, s, z + 0.038))
        rb.append(P(x, s, z + 0.004))
    top.append(rt)
    bot.append(rb)
v = []
f = []
for r in top:
    v.extend(r)
off = len(v)
for r in bot:
    v.extend(r)
for i in range(NS - 1):
    for j in range(NX - 1):
        a = i * NX + j
        f.append([a, a + 1, a + NX + 1, a + NX])
        b = off + i * NX + j
        f.append([b, b + NX, b + NX + 1, b + 1])
for i in range(NS - 1):
    f.append([i * NX, i * NX + NX, off + i * NX + NX, off + i * NX])
    a = i * NX + NX - 1
    f.append([a, off + a, off + a + NX, a + NX])
for j in range(NX - 1):
    f.append([j, off + j, off + j + 1, j + 1])
    a = (NS - 1) * NX + j
    f.append([a, a + 1, off + a + 1, off + a])
mbab.add(v, f, 0)
Airbrake = new_obj('Airbrake', mbab, [M('Paint_Camo')])
set_origin(Airbrake, 0.0, AB_S0, body_top_z(AB_S0, 0.0) + 0.02)
finish(Airbrake, bevel=0.004)

# ============================================================== NOZZLE =====
NOZ_S0, NOZ_S1 = 14.62, 15.28
NP = 18


def nozzle(sgn):
    mb = MB()
    cx, cz = 1.100 * sgn, -0.410
    gap = math.radians(1.6)
    for p in range(NP):
        a0 = TAU * p / NP + gap
        a1 = TAU * (p + 1) / NP - gap
        rings = []
        for (s, ro, ri) in ((NOZ_S0, 0.615, 0.578), (NOZ_S0 + 0.22, 0.590, 0.556),
                            (NOZ_S0 + 0.44, 0.560, 0.528), (NOZ_S1, 0.530, 0.502)):
            outer, inner = [], []
            for k in range(5):
                a = lerp(a0, a1, k / 4)
                outer.append(P(cx + ro * math.cos(a), s, cz + ro * math.sin(a)))
                inner.append(P(cx + ri * math.cos(a), s, cz + ri * math.sin(a)))
            rings.append(outer + list(reversed(inner)))
        mb._loft_world(rings, True, True, True, 0)
    # actuator ring at the throat
    mb.cyl((cx, NOZ_S0 - 0.03, cz), (cx, NOZ_S0 + 0.03, cz), 0.645, 0.645, 24, True, 0)
    for p in range(6):
        a = TAU * p / 6 + 0.3
        mb.cyl((cx + 0.62 * math.cos(a), NOZ_S0 + 0.02, cz + 0.62 * math.sin(a)),
               (cx + 0.55 * math.cos(a), NOZ_S1 - 0.05, cz + 0.55 * math.sin(a)),
               0.022, 0.022, 6, True, 0)
    return mb


Nozzle_L = new_obj('Nozzle_L', nozzle(1), [M('Metal_Nozzle')])
set_origin(Nozzle_L, 1.100, NOZ_S0, -0.410)
finish(Nozzle_L, bevel=0.003, angle=R(50))

# ============================================================== CANOPY =====
CAN = [(3.66, 0.680, 0.300, 0.720),
       (3.95, 0.660, 0.455, 0.925),
       (4.30, 0.658, 0.552, 1.062),
       (4.70, 0.668, 0.600, 1.128),
       (5.10, 0.680, 0.605, 1.150),
       (5.50, 0.700, 0.582, 1.132),
       (5.90, 0.730, 0.520, 1.062),
       (6.15, 0.762, 0.400, 0.960),
       (6.35, 0.792, 0.190, 0.845)]
CANS = cr_chain(CAN, 20)
CNX = 17


def canopy_arc(s, sill, hw, top, scale=1.0):
    pts = []
    for i in range(CNX):
        a = math.pi * (1.0 - i / (CNX - 1))   # pi -> 0 : -x side to +x side
        ca, sa = math.cos(a), math.sin(a)
        nn = 2.5
        x = hw * scale * math.copysign(abs(ca) ** (2.0 / nn), ca)
        z = sill + (top - sill) * scale * abs(sa) ** (2.0 / nn)
        pts.append(P(x, s, z))
    return pts


mbc = MB()
rings = [canopy_arc(s, sill, hw, top) for (s, sill, hw, top) in CANS]
mbc._loft_world(rings, closed=False, mat=0)
Canopy_Glass = new_obj('Canopy_Glass', mbc, [M('Canopy')])
set_origin(Canopy_Glass, 0.0, 6.35, 0.79)
finish(Canopy_Glass, bevel=0.0, angle=R(60))

# ---- frame ----
mbfr = MB()
# sill rails
for sgn in (1, -1):
    path = []
    for (s, sill, hw, top) in CANS:
        path.append((sgn * hw, s, sill))
    rings = []
    for (x, s, z) in path:
        rings.append([P(x - 0.030 * (1 if sgn > 0 else -1), s, z - 0.045),
                      P(x + 0.030 * (1 if sgn > 0 else -1), s, z - 0.045),
                      P(x + 0.030 * (1 if sgn > 0 else -1), s, z + 0.030),
                      P(x - 0.030 * (1 if sgn > 0 else -1), s, z + 0.030)])
    mbfr._loft_world(rings, True, True, True, 0)
# bows: front (windscreen), mid (canopy hinge), rear
for (idx, thick) in ((0, 0.055), (5, 0.045), (len(CANS) - 1, 0.060)):
    s, sill, hw, top = CANS[idx]
    a_out = canopy_arc(s, sill, hw, top, 1.0)
    a_in = canopy_arc(s, sill, hw * 0.90, sill + (top - sill) * 0.90, 1.0)
    a_in = [(p[0], p[1] + (thick if idx == 0 else -thick), p[2]) for p in a_in]
    a_out2 = [(p[0], p[1] + (thick if idx == 0 else -thick), p[2]) for p in a_out]
    mbfr._loft_world([a_out, a_out2], False, mat=0)
    mbfr._loft_world([a_out2, a_in], False, mat=0)
    mbfr._loft_world([a_in, [(p[0], p[1] - (thick if idx == 0 else -thick), p[2]) for p in a_in]],
                     False, mat=0)
# centre windscreen post
mbfr.box(-0.022, 0.022, 3.62, 3.98, 0.66, 1.00, 0)
Canopy_Frame = new_obj('Canopy_Frame', mbfr, [M('Paint_Camo')])
set_origin(Canopy_Frame, 0.0, 6.35, 0.79)
finish(Canopy_Frame, bevel=0.004)

# ============================================================ COCKPIT ======
CD, GF, SF, MB_, WS, HG = (M('Cockpit_Dark'), M('Gauge_Faces'), M('Seat_Fabric'),
                           M('Metal_Bare'), M('Warning_Stripe'), M('HUD_Glass'))

# ---- tub ----
mbt = MB()
FL = 0.055
TW = 0.585
mbt.box(-TW, TW, 4.05, 6.28, FL - 0.03, FL, 0)          # floor
for sgn in (1, -1):
    x0 = min(sgn * TW, sgn * (TW - 0.035))
    x1 = max(sgn * TW, sgn * (TW - 0.035))
    mbt.box(x0, x1, 4.05, 6.28, FL, 0.760, 0)           # side walls
mbt.box(-TW, TW, 4.05, 4.085, FL, 0.760, 0)             # front bulkhead
mbt.box(-TW, TW, 6.245, 6.28, FL, 0.800, 0)             # rear bulkhead
# coaming over the panel
mbt.add([P(-0.50, 4.30, 0.700), P(0.50, 4.30, 0.700),
         P(0.56, 4.62, 0.735), P(-0.56, 4.62, 0.735),
         P(-0.50, 4.30, 0.660), P(0.50, 4.30, 0.660),
         P(0.56, 4.62, 0.690), P(-0.56, 4.62, 0.690)],
        [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5],
         [2, 3, 7, 6], [3, 0, 4, 7]], 0)
Cockpit_Tub = new_obj('Cockpit_Tub', mbt, [CD])
set_origin(Cockpit_Tub, 0.0, 5.15, 0.40)
finish(Cockpit_Tub, bevel=0.004)

# ---- panel ----
mbp = MB()


def panel_s(z):
    return 4.560 - 0.20 * (z - 0.240) / 0.470


# backing plate
NPZ, NPX = 6, 9
v, f = [], []
for i in range(NPZ):
    z = lerp(0.235, 0.712, i / (NPZ - 1))
    for j in range(NPX):
        x = lerp(-0.455, 0.455, j / (NPX - 1))
        v.append(P(x, panel_s(z), z))
for i in range(NPZ):
    z = lerp(0.235, 0.712, i / (NPZ - 1))
    for j in range(NPX):
        x = lerp(-0.455, 0.455, j / (NPX - 1))
        v.append(P(x, panel_s(z) - 0.055, z))
o = NPZ * NPX
for i in range(NPZ - 1):
    for j in range(NPX - 1):
        a = i * NPX + j
        f.append([a, a + NPX, a + NPX + 1, a + 1])
        b = o + a
        f.append([b, b + 1, b + NPX + 1, b + NPX])
for i in range(NPZ - 1):
    f.append([i * NPX, i * NPX + 1 - 1, o + i * NPX, o + i * NPX + NPX])
for j in range(NPX - 1):
    f.append([j, j + 1, o + j + 1, o + j])
    a = (NPZ - 1) * NPX + j
    f.append([a + 1, a, o + a, o + a + 1])
for i in range(NPZ - 1):
    f.append([i * NPX, o + i * NPX + NPX, o + i * NPX, i * NPX])
mbp.add(v, f, 0)

GAUGES = []
for (gx, gz, gr) in [(0.325, 0.615, 0.055), (0.190, 0.615, 0.055),
                     (-0.190, 0.615, 0.055), (-0.325, 0.615, 0.055),
                     (0.325, 0.470, 0.055), (0.190, 0.470, 0.055),
                     (-0.190, 0.470, 0.055), (-0.325, 0.470, 0.055),
                     (0.325, 0.325, 0.055), (0.190, 0.325, 0.055),
                     (-0.190, 0.325, 0.055), (-0.325, 0.325, 0.055),
                     (0.058, 0.615, 0.048), (-0.058, 0.615, 0.048)]:
    GAUGES.append((gx, gz, gr))
for (gx, gz, gr) in GAUGES:
    s = panel_s(gz)
    mbp.cyl((gx, s - 0.035, gz), (gx, s, gz), gr, gr, 20, True, 0)      # bezel
    mbp.cyl((gx, s + 0.0035, gz), (gx, s + 0.0055, gz), gr * 0.84, gr * 0.84,
            20, True, 1)                                               # dial face proud
# central CRT
mbp.box(-0.115, 0.115, panel_s(0.42) - 0.02, panel_s(0.42), 0.300, 0.520, 0)
mbp.box(-0.098, 0.098, panel_s(0.42) + 0.004, panel_s(0.42) + 0.006, 0.315, 0.505, 1)
# warning caption blocks
for sgn in (1, -1):
    mbp.box(min(sgn * 0.395, sgn * 0.455), max(sgn * 0.395, sgn * 0.455),
            panel_s(0.25) + 0.002, panel_s(0.25) + 0.010, 0.245, 0.290, 2)
Panel = new_obj('Panel', mbp, [CD, GF, WS])
set_origin(Panel, 0.0, 4.50, 0.40)
finish(Panel, bevel=0.003, angle=R(45))

# ---- HUD ----
mbh = MB()
mbh.add([P(-0.150, 4.235, 0.735), P(0.150, 4.235, 0.735),
         P(0.150, 4.180, 0.955), P(-0.150, 4.180, 0.955)], [[0, 1, 2, 3], [3, 2, 1, 0]], 0)
HUD_Glass = new_obj('HUD_Glass', mbh, [HG])
set_origin(HUD_Glass, 0.0, 4.23, 0.74)
finish(HUD_Glass, bevel=0.0)
# HUD housing belongs to the panel visually -> separate small mesh on Panel
mbp2 = MB()
mbp2.box(-0.170, 0.170, 4.24, 4.44, 0.700, 0.790, 0)
mbp2.box(-0.150, 0.150, 4.28, 4.40, 0.790, 0.815, 0)
tmp = new_obj('_hudbox', mbp2, [CD])
bpy.ops.object.select_all(action='DESELECT')
tmp.select_set(True)
Panel.select_set(True)
bpy.context.view_layer.objects.active = Panel
bpy.ops.object.join()

# ---- consoles ----
for sgn, nm in ((1, 'Console_L'), (-1, 'Console_R')):
    mb = MB()
    x0 = min(sgn * 0.300, sgn * 0.552)
    x1 = max(sgn * 0.300, sgn * 0.552)
    mb.box(x0, x1, 4.62, 6.10, 0.075, 0.415, 0)
    mb.add([P(sgn * 0.300, 4.62, 0.415), P(sgn * 0.552, 4.62, 0.415),
            P(sgn * 0.552, 6.10, 0.415), P(sgn * 0.300, 6.10, 0.415),
            P(sgn * 0.300, 4.62, 0.455), P(sgn * 0.552, 4.62, 0.500),
            P(sgn * 0.552, 6.10, 0.500), P(sgn * 0.300, 6.10, 0.455)],
           [[4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]], 0)
    for i in range(7):
        s = 4.75 + i * 0.19
        for j in range(3):
            x = sgn * (0.335 + j * 0.070)
            zz = 0.462 + (x if False else 0) + 0.030 * (0.552 - abs(x)) / 0.25
            mb.box(min(x - 0.022, x + 0.022), max(x - 0.022, x + 0.022),
                   s, s + 0.055, 0.470, 0.470 + 0.045,
                   1 if (i + j) % 4 == 0 else 0)
    ob = new_obj(nm, mb, [CD, WS])
    set_origin(ob, sgn * 0.42, 5.36, 0.24)
    finish(ob, bevel=0.003)

# ---- seat (K-36) ----
mbse = MB()
SS = 5.35           # seat reference station (back of pan)
mbse.box(-0.230, 0.230, SS - 0.18, SS + 0.34, 0.060, 0.215, 0)     # base/box
mbse.box(-0.215, 0.215, SS - 0.24, SS + 0.05, 0.215, 0.275, 1)     # pan cushion
# backrest, leaning aft 17 deg
lean = R(17)
bh = 0.62
bx, bz = 0.215, 0.275
top_s = SS + 0.05 + bh * math.sin(lean)
top_z = bz + bh * math.cos(lean)
mbse.add([P(-bx, SS + 0.05, bz), P(bx, SS + 0.05, bz),
          P(bx, top_s, top_z), P(-bx, top_s, top_z),
          P(-bx, SS + 0.14, bz), P(bx, SS + 0.14, bz),
          P(bx, top_s + 0.09, top_z), P(-bx, top_s + 0.09, top_z)],
         [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5],
          [2, 3, 7, 6], [3, 0, 4, 7]], 1)
# head box
mbse.box(-0.185, 0.185, top_s - 0.02, top_s + 0.20, top_z, top_z + 0.30, 0)
mbse.box(-0.205, 0.205, top_s + 0.06, top_s + 0.22, top_z + 0.02, top_z + 0.26, 0)
# head rest cushion
mbse.box(-0.135, 0.135, top_s - 0.05, top_s - 0.01, top_z + 0.04, top_z + 0.24, 1)
# side rails
for sgn in (1, -1):
    x0 = min(sgn * 0.230, sgn * 0.275)
    x1 = max(sgn * 0.230, sgn * 0.275)
    mbse.box(x0, x1, SS - 0.14, top_s + 0.12, 0.180, top_z + 0.10, 0)
# harness straps
for sgn in (1, -1):
    a = 0.055 * sgn
    mbse.add([P(a - 0.045, SS + 0.03, 0.290), P(a + 0.045, SS + 0.03, 0.290),
              P(sgn * 0.150 + 0.045, top_s - 0.03, top_z + 0.02),
              P(sgn * 0.150 - 0.045, top_s - 0.03, top_z + 0.02)],
             [[0, 1, 2, 3], [3, 2, 1, 0]], 2)
    mbse.box(min(sgn * 0.10, sgn * 0.19), max(sgn * 0.10, sgn * 0.19),
             SS - 0.20, SS - 0.16, 0.270, 0.300, 2)
# ejection handles (yellow/black) on the seat pan front and the headbox
for sgn in (1, -1):
    mbse.cyl((sgn * 0.06, SS - 0.26, 0.300), (sgn * 0.20, SS - 0.26, 0.300),
             0.022, 0.022, 8, True, 3)
    mbse.cyl((sgn * 0.20, SS - 0.26, 0.300), (sgn * 0.20, SS - 0.13, 0.300),
             0.022, 0.022, 8, True, 3)
mbse.box(-0.10, 0.10, top_s + 0.02, top_s + 0.09, top_z + 0.30, top_z + 0.34, 3)
Seat = new_obj('Seat', mbse, [CD, SF, MB_, WS])
set_origin(Seat, 0.0, SS, 0.06)
finish(Seat, bevel=0.004)

# ---- stick ----
mbk = MB()
mbk.cyl((0.0, 5.02, 0.090), (0.0, 5.02, 0.150), 0.055, 0.040, 12, True, 0)
mbk.cyl((0.0, 5.02, 0.150), (0.0, 4.985, 0.400), 0.030, 0.026, 12, True, 0)
mbk.cyl((0.0, 4.985, 0.400), (0.0, 4.975, 0.470), 0.038, 0.042, 12, True, 0)
mbk.box(-0.040, 0.040, 4.930, 5.020, 0.470, 0.560, 0)
mbk.cyl((0.0, 4.930, 0.520), (0.0, 4.905, 0.520), 0.024, 0.020, 8, True, 1)
Stick = new_obj('Stick', mbk, [CD, WS])
set_origin(Stick, 0.0, 5.02, 0.090)
finish(Stick, bevel=0.003)

# ---- throttles (left quadrant; +X is left) ----
mbth = MB()
mbth.box(0.300, 0.470, 4.90, 5.35, 0.415, 0.470, 0)
for i in (0, 1):
    x = 0.340 + i * 0.070
    mbth.cyl((x, 5.30, 0.455), (x, 5.02, 0.560), 0.024, 0.024, 10, True, 0)
    mbth.cyl((x, 5.02, 0.560), (x, 4.96, 0.575), 0.036, 0.030, 10, True, 0)
Throttles = new_obj('Throttles', mbth, [CD])
set_origin(Throttles, 0.385, 5.32, 0.445)
finish(Throttles, bevel=0.003)

# ---- rudder pedals ----
mbrp = MB()
for sgn in (1, -1):
    x = sgn * 0.135
    mbrp.box(min(x - 0.055, x + 0.055), max(x - 0.055, x + 0.055),
             4.24, 4.30, 0.075, 0.235, 0)
    mbrp.box(min(x - 0.030, x + 0.030), max(x - 0.030, x + 0.030),
             4.30, 4.56, 0.070, 0.100, 0)
Rudder_Pedals = new_obj('Rudder_Pedals', mbrp, [CD])
set_origin(Rudder_Pedals, 0.0, 4.30, 0.10)
finish(Rudder_Pedals, bevel=0.003)

# =============================================================== GEAR ======
# --- nose gear: hinge S=6.95 z=-0.72, axle S=6.60 z=-1.63 (contact -1.90)
mbng = MB()
HS, HZ = 6.95, -0.720
AS_, AZ = 6.600, -1.630
mbng.cyl((0.0, HS, HZ), (0.0, AS_ + 0.02, AZ + 0.30), 0.070, 0.058, 14, True, 0)
mbng.cyl((0.0, AS_ + 0.02, AZ + 0.32), (0.0, AS_, AZ), 0.050, 0.046, 14, True, 0)
mbng.cyl((-0.135, AS_, AZ), (0.135, AS_, AZ), 0.032, 0.032, 12, True, 0)   # axle
# drag brace
mbng.cyl((0.0, HS - 0.04, HZ - 0.02), (0.0, 7.30, -1.12), 0.036, 0.030, 10, True, 0)
# torque link
mbng.cyl((0.055, HS - 0.20, HZ - 0.38), (0.055, AS_ + 0.06, AZ + 0.30), 0.020, 0.020, 8, True, 0)
mbng.cyl((-0.055, HS - 0.20, HZ - 0.38), (-0.055, AS_ + 0.06, AZ + 0.30), 0.020, 0.020, 8, True, 0)
# landing light
mbng.box(-0.075, 0.075, AS_ - 0.10, AS_ - 0.05, AZ + 0.36, AZ + 0.50, 1)
Gear_Nose = new_obj('Gear_Nose', mbng, [MB_, M('Light_White')])
set_origin(Gear_Nose, 0.0, HS, HZ)
finish(Gear_Nose, bevel=0.004)


def wheel(name, cx, cs, cz, rad, wid, mat_t, mat_h):
    mb = MB()
    NW = 24
    prof = [(-wid * 0.5, rad * 0.72), (-wid * 0.5, rad * 0.93),
            (-wid * 0.40, rad), (wid * 0.40, rad),
            (wid * 0.5, rad * 0.93), (wid * 0.5, rad * 0.72)]
    rings = []
    for (dx, r) in prof:
        rings.append([P(cx + dx, cs + r * math.cos(TAU * i / NW),
                        cz + r * math.sin(TAU * i / NW)) for i in range(NW)])
    mb._loft_world(rings, True, False, False, 0)
    # hub discs
    for (dx, hr) in ((-wid * 0.5, rad * 0.72), (wid * 0.5, rad * 0.72)):
        rings2 = [[P(cx + dx, cs + hr * math.cos(TAU * i / NW),
                     cz + hr * math.sin(TAU * i / NW)) for i in range(NW)],
                  [P(cx + dx * 0.55, cs + rad * 0.42 * math.cos(TAU * i / NW),
                     cz + rad * 0.42 * math.sin(TAU * i / NW)) for i in range(NW)]]
        mb._loft_world(rings2, True, False, True, 1)
    ob = new_obj(name, mb, [mat_t, mat_h])
    set_origin(ob, cx, cs, cz)
    finish(ob, bevel=0.004, angle=R(45))
    return ob


TAU = 2 * math.pi
Wheel_Nose = wheel('Wheel_Nose', 0.0, AS_, AZ, 0.270, 0.180, M('Rubber_Tire'), MB_)

# --- main gear: hinge |x|=1.30 z=-0.55, axle |x|=1.545 z=-1.55
mbmg = MB()
MHX, MHS, MHZ = 1.300, 10.250, -0.550
MAX_, MAS, MAZ = 1.545, 10.250, -1.550
mbmg.cyl((MHX, MHS, MHZ), (MAX_ - 0.01, MAS, MAZ + 0.34), 0.080, 0.062, 14, True, 0)
mbmg.cyl((MAX_ - 0.01, MAS, MAZ + 0.36), (MAX_, MAS, MAZ), 0.055, 0.050, 14, True, 0)
mbmg.cyl((MAX_ - 0.16, MAS, MAZ), (MAX_ + 0.02, MAS, MAZ), 0.038, 0.038, 12, True, 0)
# side brace to the fuselage
mbmg.cyl((MHX - 0.05, MHS + 0.02, MHZ - 0.03), (MAX_ - 0.06, MAS + 0.62, MAZ + 0.42),
         0.036, 0.030, 10, True, 0)
# torque link
mbmg.cyl((MHX + 0.10, MHS - 0.08, MHZ - 0.42), (MAX_ - 0.02, MAS - 0.08, MAZ + 0.34),
         0.022, 0.022, 8, True, 0)
Gear_L = new_obj('Gear_L', mbmg, [MB_])
set_origin(Gear_L, MHX, MHS, MHZ)
finish(Gear_L, bevel=0.004)
Wheel_L = wheel('Wheel_L', MAX_ + 0.13, MAS, MAZ, 0.350, 0.230, M('Rubber_Tire'), MB_)

# --- doors ---
mbd = MB()
mbd.box(-0.020, 0.020, 5.95, 7.00, -0.98, -0.60, 0)
GearDoor_Nose = new_obj('GearDoor_Nose', mbd, [M('Paint_Camo')])
set_origin(GearDoor_Nose, 0.0, 6.45, -0.60)
finish(GearDoor_Nose, bevel=0.004)
# rotate it out to the open position (hangs alongside the strut)
GearDoor_Nose.rotation_euler = (0, R(-8), 0)

mbd2 = MB()
mbd2.box(1.395, 1.435, 9.60, 11.00, -1.02, -0.60, 0)
GearDoor_L = new_obj('GearDoor_L', mbd2, [M('Paint_Camo')])
set_origin(GearDoor_L, 1.415, 10.30, -0.60)
finish(GearDoor_L, bevel=0.004)
GearDoor_L.rotation_euler = (0, R(-14), 0)

# ---- intake grilles ----
GS = 6.36
GX0, GX1 = 0.640, 1.360
GZ0, GZ1 = -0.900, -0.470
mbg = MB()
mbg.box(GX0, GX1, GS, GS + 0.030, GZ0, GZ0 + 0.035, 0)
mbg.box(GX0, GX1, GS, GS + 0.030, GZ1 - 0.035, GZ1, 0)
mbg.box(GX0, GX0 + 0.035, GS, GS + 0.030, GZ0, GZ1, 0)
mbg.box(GX1 - 0.035, GX1, GS, GS + 0.030, GZ0, GZ1, 0)
for i in range(9):
    x = lerp(GX0 + 0.05, GX1 - 0.05, i / 8)
    mbg.box(x - 0.008, x + 0.008, GS + 0.006, GS + 0.020, GZ0 + 0.03, GZ1 - 0.03, 0)
for i in range(5):
    z = lerp(GZ0 + 0.05, GZ1 - 0.05, i / 4)
    mbg.box(GX0 + 0.03, GX1 - 0.03, GS + 0.008, GS + 0.018, z - 0.008, z + 0.008, 0)
IntakeGrille_L = new_obj('IntakeGrille_L', mbg, [MB_])
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
    for m in src.modifiers:
        nm2 = nb.modifiers.new(m.name, m.type)
        if m.type == 'BEVEL':
            nm2.width = m.width
            nm2.segments = m.segments
            nm2.limit_method = 'ANGLE'
            nm2.angle_limit = m.angle_limit
            nm2.miter_outer = 'MITER_ARC'
            nm2.clamp_overlap = True
        elif m.type == 'EDGE_SPLIT':
            nm2.split_angle = m.split_angle
            nm2.use_edge_sharp = False
    nb.rotation_euler = (src.rotation_euler.x, -src.rotation_euler.y,
                         -src.rotation_euler.z)
    MIR[nm] = nb
# right wing nav light must be green
wr = MIR['Wing_R']
for i, s in enumerate(wr.data.materials):
    if s and s.name.startswith('Light_Red'):
        wr.data.materials[i] = M('Light_Green')

# ============================================================ EMPTIES =====
Mig29 = empty('Mig29', 0, S0, 0, 1.0)
Cockpit = empty('Cockpit', 0, S0, 0, 0.4)
E = {}
E['Camera_Pilot'] = empty('Camera_Pilot', 0.0, 4.960, 0.970, 0.10)
E['Nozzle_Exit_L'] = empty('Nozzle_Exit_L', 1.100, 15.280, -0.410, 0.20)
E['Nozzle_Exit_R'] = empty('Nozzle_Exit_R', -1.100, 15.280, -0.410, 0.20)
E['Wingtip_L'] = empty('Wingtip_L', 5.700, 11.90, 0.030, 0.10)
E['Wingtip_R'] = empty('Wingtip_R', -5.700, 11.90, 0.030, 0.10)
E['LERX_L'] = empty('LERX_L', 1.150, 6.900, body_top_z(6.90, 1.15) + 0.01, 0.10)
E['LERX_R'] = empty('LERX_R', -1.150, 6.900, body_top_z(6.90, 1.15) + 0.01, 0.10)
E['Contact_Nose'] = empty('Contact_Nose', 0.0, AS_, -1.900, 0.10)
E['Contact_L'] = empty('Contact_L', MAX_ + 0.13, MAS, -1.900, 0.10)
E['Contact_R'] = empty('Contact_R', -(MAX_ + 0.13), MAS, -1.900, 0.10)
le_, ch_, z_, tc_ = wing_geom(5.60)
E['Nav_L'] = empty('Nav_L', 5.690, le_ + 0.06, z_ + 0.005, 0.08)
E['Nav_R'] = empty('Nav_R', -5.690, le_ + 0.06, z_ + 0.005, 0.08)
E['Beacon'] = empty('Beacon', 0.0, 8.350, body_top_z(8.35, 0.0) + 0.075, 0.08)
E['Strobe_Tail'] = empty('Strobe_Tail', 0.0, 15.28, 0.190, 0.08)

# ============================================================ HIERARCHY ===
COCKPIT_KIDS = ['Panel', 'HUD_Glass', 'Console_L', 'Console_R', 'Stick',
                'Throttles', 'Seat', 'Rudder_Pedals', 'Cockpit_Tub']
for nm in COCKPIT_KIDS:
    parent_to(bpy.data.objects[nm], Cockpit)
parent_to(Cockpit, Mig29)
parent_to(E['Camera_Pilot'], Cockpit)

for nm, gp in (('Wheel_Nose', 'Gear_Nose'), ('Wheel_L', 'Gear_L'),
               ('Wheel_R', 'Gear_R')):
    parent_to(bpy.data.objects[nm], bpy.data.objects[gp])

TOP = ['Fuselage', 'Wing_L', 'Wing_R', 'Aileron_L', 'Aileron_R', 'Flap_L',
       'Flap_R', 'Slat_L', 'Slat_R', 'Stabilator_L', 'Stabilator_R',
       'Rudder_L', 'Rudder_R', 'Airbrake', 'Fin_L', 'Fin_R', 'Nozzle_L',
       'Nozzle_R', 'Canopy_Glass', 'Canopy_Frame', 'Gear_Nose', 'Gear_L',
       'Gear_R', 'GearDoor_Nose', 'GearDoor_L', 'GearDoor_R',
       'IntakeGrille_L', 'IntakeGrille_R'] + \
      ['Nozzle_Exit_L', 'Nozzle_Exit_R', 'Wingtip_L', 'Wingtip_R', 'LERX_L',
       'LERX_R', 'Contact_Nose', 'Contact_L', 'Contact_R', 'Nav_L', 'Nav_R',
       'Beacon', 'Strobe_Tail']
for nm in TOP:
    parent_to(bpy.data.objects[nm], Mig29)

# ================================================================= UV =====
bpy.ops.object.select_all(action='DESELECT')
for ob in bpy.data.objects:
    if ob.type != 'MESH':
        continue
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')
    ob.select_set(False)

# ============================================================== SAVE ======
tri = 0
for ob in bpy.data.objects:
    if ob.type != 'MESH':
        continue
    d = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
    t = sum(len(p.vertices) - 2 for p in d.polygons)
    tri += t
    ob.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh_clear()
print('TRI TOTAL %d' % tri)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'mig29.blend'))
print('SAVED')
