"""Ground targets: a convoy, a radar site, a fuel farm, a small port, an airfield.

Same design frame as everything else (X left, S aft, Z up), each object centred on
its own footprint so the engine can drop it on the terrain by its origin. These are
seen from a strafing pass at two hundred metres and upwards, so they are built for
silhouette and proportion rather than for rivets.
"""
import bpy, math, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'weapons'))
sys.path.insert(0, os.path.join(HERE, '..', 'mig'))
from mlib import MB, P, S0, TAU, new_obj, finish, make_mat, empty, parent_to  # noqa: E402
from wlib import ring, ogive, tube, fin, fin_set, clear_scene  # noqa: E402

clear_scene()

MAT = {
    'olive':  make_mat('T_Olive',  (0.085, 0.098, 0.062), 0.72, 0.0),
    'olive2': make_mat('T_Olive2', (0.055, 0.066, 0.044), 0.78, 0.0),
    'canvas': make_mat('T_Canvas', (0.135, 0.130, 0.098), 0.88, 0.0),
    'rubber': make_mat('T_Rubber', (0.020, 0.020, 0.021), 0.92, 0.0),
    'steel':  make_mat('T_Steel',  (0.34, 0.35, 0.36), 0.42, 1.0),
    'rust':   make_mat('T_Rust',   (0.20, 0.105, 0.055), 0.86, 0.0),
    'glass':  make_mat('T_Glass',  (0.045, 0.060, 0.070), 0.10, 0.0, alpha=0.55),
    'conc':   make_mat('T_Conc',   (0.30, 0.295, 0.278), 0.88, 0.0),
    'white':  make_mat('T_White',  (0.44, 0.45, 0.45), 0.60, 0.0),
    'navy':   make_mat('T_Navy',   (0.075, 0.088, 0.100), 0.68, 0.0),
    'red':    make_mat('T_Red',    (0.24, 0.045, 0.035), 0.70, 0.0),
}
ORDER = ['olive', 'olive2', 'canvas', 'rubber', 'steel', 'rust', 'glass', 'conc', 'white', 'navy', 'red']
IDX = {k: i for i, k in enumerate(ORDER)}
MATS = [MAT[k] for k in ORDER]
OL, OL2, CV, RB, ST, RU, GL, CO, WH, NV, RD = (IDX[k] for k in ORDER)


def hring(cx, cs, z, r, seg=24):
    """A circle lying flat on the ground. wlib's ring() is a body cross-section, which
    is the wrong plane entirely for a tank roof."""
    return [P(cx + r * math.cos(TAU * i / seg), cs + r * math.sin(TAU * i / seg), z)
            for i in range(seg)]


def obj(name, mb, bevel=0.02):
    o = new_obj(name, mb, MATS)
    finish(o, bevel=bevel, seg=1)
    return o


def wheel(mb, x, s, z, r, w, mat=RB):
    mb.cyl((x - w / 2, s, z), (x + w / 2, s, z), r, r, 12, True, mat, up=(0, 1, 0))
    mb.cyl((x - w / 2 * 0.55, s, z), (x + w / 2 * 0.55, s, z), r * 0.45, r * 0.45, 10, True, ST, up=(0, 1, 0))


# ================================================================ truck =====
# A six-wheel military lorry: bonnet, cab, canvas-tilted cargo bed. The tilt is what
# makes it read as a supply truck rather than as a box on wheels.
def build_truck():
    mb = MB()
    W = 1.24
    # chassis
    mb.box(-W * 0.82, W * 0.82, S0 - 3.55, S0 + 3.60, 0.62, 0.86, OL2)
    # bonnet and cab
    mb.box(-W * 0.86, W * 0.86, S0 - 3.62, S0 - 2.32, 0.86, 1.62, OL)
    mb.box(-W * 0.92, W * 0.92, S0 - 2.32, S0 - 1.00, 0.86, 2.42, OL)
    mb.box(-W * 0.80, W * 0.80, S0 - 2.34, S0 - 2.26, 1.72, 2.28, GL)     # windscreen
    for k in (-1, 1):
        mb.box(k * W * 0.93, k * W * 0.86, S0 - 2.26, S0 - 1.20, 1.66, 2.24, GL)
    mb.box(-W * 0.90, W * 0.90, S0 - 3.70, S0 - 3.58, 1.00, 1.46, ST)     # grille
    for k in (-1, 1):
        mb.cyl((k * W * 0.62, S0 - 3.70, 1.22), (k * W * 0.62, S0 - 3.76, 1.22), 0.15, 0.15, 10, True, GL)
    # cargo bed with a canvas tilt
    mb.box(-W, W, S0 - 0.95, S0 + 3.60, 0.86, 1.30, OL2)
    rings = []
    for (ss, sc) in ((S0 - 0.95, 0.96), (S0 - 0.30, 1.0), (S0 + 3.0, 1.0), (S0 + 3.60, 0.96)):
        pts = []
        n = 9
        for i in range(n):
            t = i / (n - 1)
            ang = math.pi * t
            pts.append((-math.cos(ang) * W * sc, 1.28 + math.sin(ang) * 1.02 * sc))
        pts = [(W * sc, 1.28)] + pts + [(-W * sc, 1.28)]
        rings.append([P(dx, ss, dz) for (dx, dz) in pts])
    mb._loft_world(rings, True, True, True, CV)
    for s in (-2.90, 0.55, 2.35):
        for k in (-1, 1):
            wheel(mb, k * W * 0.90, S0 + s, 0.60, 0.60, 0.34)
    return obj('Truck', mb)


# ================================================================== APC =====
# Eight wheels, a sloped nose and a small turret: a BTR in outline.
def build_apc():
    mb = MB()
    W = 1.42
    body = [(0.62, S0 - 3.80), (1.05, S0 - 3.20), (1.34, S0 - 2.10),
            (1.42, S0 + 1.20), (1.30, S0 + 3.30), (0.92, S0 + 3.85)]
    lower, upper = [], []
    for (w, ss) in body:
        lower.append([P(-w, ss, 0.78), P(w, ss, 0.78)])
        upper.append([P(-w * 0.86, ss, 1.62), P(w * 0.86, ss, 1.62)])
    rings = []
    for i, (w, ss) in enumerate(body):
        rings.append([P(-w, ss, 0.72), P(w, ss, 0.72), P(w * 0.88, ss, 1.66),
                      P(-w * 0.88, ss, 1.66)])
    mb._loft_world(rings, True, True, True, OL)
    # sloped glacis and the flat deck
    mb.box(-W * 0.70, W * 0.70, S0 - 2.30, S0 + 1.60, 1.66, 1.92, OL)
    for k in (-1, 1):
        mb.box(k * W * 0.72, k * W * 0.66, S0 - 2.20, S0 - 1.50, 1.70, 1.88, GL)
    # turret
    mb.cyl((0, S0 - 0.55, 1.92), (0, S0 - 0.55, 2.46), 0.62, 0.50, 14, True, OL2)
    mb.cyl((0, S0 - 0.55, 2.28), (0, S0 - 2.35, 2.28), 0.055, 0.045, 10, True, ST, up=(0, 0, 1))
    for s in (-2.60, -1.30, 1.35, 2.65):
        for k in (-1, 1):
            wheel(mb, k * W * 0.94, S0 + s, 0.66, 0.66, 0.30)
    return obj('APC', mb)


# ========================================================== radar site =====
def build_radar_cabin():
    mb = MB()
    mb.box(-1.55, 1.55, S0 - 3.10, S0 + 3.10, 0.0, 2.70, OL)
    mb.box(-1.62, 1.62, S0 - 3.20, S0 + 3.20, 2.62, 2.86, OL2)
    for k in (-1, 1):
        mb.box(k * 1.56, k * 1.50, S0 - 2.10, S0 - 0.70, 1.40, 2.10, GL)
    # the mast the dish turns on
    mb.cyl((0, S0, 2.80), (0, S0, 4.60), 0.34, 0.26, 12, True, ST, up=(0, 0, 1))
    for k in (-1, 1):
        mb.cyl((0, S0 + k * 0.30, 2.90), (k * 1.30, S0 + k * 1.30, 4.30), 0.05, 0.05, 8, True, ST)
    return obj('RadarCabin', mb)


def build_radar_dish():
    """A rotating planar array, modelled about its own pivot so the engine can spin it."""
    mb = MB()
    mb.cyl((0, S0, -0.30), (0, S0, 0.10), 0.30, 0.36, 12, True, ST, up=(0, 0, 1))
    # the array itself: a tall slightly curved panel
    HW, HT = 2.55, 4.20
    rings = []
    for (ss, sc) in ((S0 - 0.14, 0.62), (S0, 1.0), (S0 + 0.14, 0.62)):
        rings.append([P(-HW, ss, 0.10), P(HW, ss, 0.10),
                      P(HW * 0.88, ss, 0.10 + HT * sc), P(-HW * 0.88, ss, 0.10 + HT * sc)])
    mb._loft_world(rings, True, True, True, WH)
    # feed horn on a boom out front
    mb.cyl((0, S0, HT * 0.5), (0, S0 - 1.90, HT * 0.5), 0.06, 0.06, 8, True, ST)
    mb.cyl((0, S0 - 1.90, HT * 0.5), (0, S0 - 2.30, HT * 0.5), 0.10, 0.22, 10, True, ST)
    # stiffening ribs, which is most of what you see of a real array from behind
    for i in range(6):
        z = 0.35 + i * 0.66
        mb.box(-HW * 0.99, HW * 0.99, S0 + 0.11, S0 + 0.19, z, z + 0.08, ST)
    return obj('RadarDish', mb, bevel=0.01)


# ============================================================ fuel tank =====
def build_fuel_tank():
    mb = MB()
    R, H = 5.20, 7.40
    mb.cyl((0, S0, 0.35), (0, S0, H), R, R, 26, False, WH, up=(0, 0, 1))
    # Domed roof, in the horizontal plane. A shallow cap, the way a fixed-roof fuel
    # tank is actually built, closed at the crown rather than fanned from a centroid.
    rings = []
    for i in range(7):
        t = i / 6
        ang = t * (math.pi * 0.5)
        rings.append(hring(0, S0, H + math.sin(ang) * R * 0.26, max(R * math.cos(ang), 0.02), 26))
    mb._loft_world(rings, True, False, True, WH)
    # two hoops and a spiral stair, the things that give a tank its scale
    for z in (2.4, 5.0):
        mb.cyl((0, S0, z), (0, S0, z + 0.16), R * 1.012, R * 1.012, 26, False, ST, up=(0, 0, 1))
    # A caged ladder up the outside, which is what gives a tank its scale from the air.
    for i in range(20):
        z = 0.5 + i * 0.36
        if z > H + 0.4:
            break
        mb.box(-0.34, 0.34, S0 + R * 0.99, S0 + R * 1.16, z, z + 0.06, ST)
    mb.cyl((0, S0 + R * 1.10, 0.4), (0, S0 + R * 1.10, H + 0.6), 0.05, 0.05, 6, True, ST, up=(0, 0, 1))
    mb.cyl((0, S0, 0.0), (0, S0, 0.40), R * 1.10, R * 1.10, 26, True, CO, up=(0, 0, 1))
    return obj('FuelTank', mb, bevel=0.01)


# =========================================================== patrol boat =====
def build_boat():
    mb = MB()
    L, W = 14.0, 2.10
    sec = [(-L * 0.5, 0.15), (-L * 0.34, 0.70), (-L * 0.05, 1.00), (L * 0.28, 1.00), (L * 0.5, 0.80)]
    rings = []
    for (ss, w) in sec:
        rings.append([P(-W * w, S0 + ss, -1.05), P(W * w, S0 + ss, -1.05),
                      P(W * w * 1.02, S0 + ss, 0.70), P(-W * w * 1.02, S0 + ss, 0.70)])
    mb._loft_world(rings, True, True, True, NV)
    # boot topping, so the waterline reads
    mb.box(-W * 1.03, W * 1.03, S0 - L * 0.48, S0 + L * 0.48, -0.30, 0.02, RD)
    # deckhouse and bridge
    mb.box(-W * 0.72, W * 0.72, S0 - 2.10, S0 + 2.60, 0.70, 2.30, WH)
    mb.box(-W * 0.56, W * 0.56, S0 - 1.10, S0 + 1.20, 2.30, 3.20, WH)
    for k in (-1, 1):
        mb.box(k * W * 0.57, k * W * 0.52, S0 - 1.00, S0 + 1.10, 2.55, 3.05, GL)
    mb.box(-W * 0.50, W * 0.50, S0 - 1.15, S0 - 1.05, 2.55, 3.05, GL)
    mb.cyl((0, S0 + 0.60, 3.20), (0, S0 + 0.90, 6.20), 0.10, 0.06, 8, True, ST, up=(0, 0, 1))
    # forward gun mount
    mb.cyl((0, S0 - 4.20, 0.70), (0, S0 - 4.20, 1.30), 0.55, 0.45, 12, True, WH, up=(0, 0, 1))
    mb.cyl((0, S0 - 4.20, 1.15), (0, S0 - 5.60, 1.20), 0.055, 0.045, 8, True, ST)
    return obj('PatrolBoat', mb)


# ================================================================ hangar =====
def build_hangar():
    mb = MB()
    W, L, H = 11.0, 16.0, 7.4
    rings = []
    for ss in (S0 - L / 2, S0 + L / 2):
        pts = []
        n = 13
        for i in range(n):
            t = i / (n - 1)
            ang = math.pi * t
            pts.append((-math.cos(ang) * W, math.sin(ang) * H))
        pts = [(W, 0.0)] + pts + [(-W, 0.0)]
        rings.append([P(dx, ss, dz) for (dx, dz) in pts])
    mb._loft_world(rings, True, True, True, OL2)
    # Door surround: a rim following the arch, not a slab across the opening — one
    # reads as a hangar mouth, the other as a wall someone parked a roof against.
    for ss, k in ((S0 - L / 2 - 0.30, 1.07), (S0 - L / 2, 1.0)):
        pass
    rim = []
    for (ss, sc) in ((S0 - L / 2 - 0.30, 1.07), (S0 - L / 2 + 0.02, 1.07)):
        pts = []
        n = 13
        for i in range(n):
            t = i / (n - 1)
            ang = math.pi * t
            pts.append((-math.cos(ang) * W * sc, math.sin(ang) * H * sc))
        pts = [(W * sc, 0.0)] + pts + [(-W * sc, 0.0)]
        rim.append([P(dx, ss, dz) for (dx, dz) in pts])
    mb._loft_world(rim, True, False, False, CO)
    # and the inner lip, so the rim has thickness seen from the front
    inner = []
    for (ss, sc) in ((S0 - L / 2 - 0.30, 1.0), (S0 - L / 2 - 0.30, 1.07)):
        pts = []
        n = 13
        for i in range(n):
            t = i / (n - 1)
            ang = math.pi * t
            pts.append((-math.cos(ang) * W * sc, math.sin(ang) * H * sc))
        pts = [(W * sc, 0.0)] + pts + [(-W * sc, 0.0)]
        inner.append([P(dx, ss, dz) for (dx, dz) in pts])
    mb._loft_world(inner, True, False, False, CO)
    return obj('Hangar', mb, bevel=0.03)


def build_tower():
    mb = MB()
    mb.box(-2.10, 2.10, S0 - 2.10, S0 + 2.10, 0.0, 9.0, CO)
    mb.box(-2.80, 2.80, S0 - 2.80, S0 + 2.80, 9.0, 12.2, CO)
    for k in (-1, 1):
        mb.box(k * 2.82, k * 2.68, S0 - 2.60, S0 + 2.60, 9.5, 11.8, GL)
        mb.box(-2.60, 2.60, S0 + k * 2.82, S0 + k * 2.68, 9.5, 11.8, GL)
    mb.box(-3.05, 3.05, S0 - 3.05, S0 + 3.05, 12.2, 12.6, CO)
    mb.cyl((0, S0, 12.6), (0, S0, 15.4), 0.09, 0.06, 8, True, ST, up=(0, 0, 1))
    return obj('Tower', mb)


def build_crate():
    mb = MB()
    mb.box(-1.10, 1.10, S0 - 1.10, S0 + 1.10, 0.0, 1.30, CV)
    mb.box(-1.14, 1.14, S0 - 1.14, S0 + 1.14, 1.24, 1.36, OL2)
    return obj('Crate', mb, bevel=0.015)


BUILT = [build_truck(), build_apc(), build_radar_cabin(), build_radar_dish(),
         build_fuel_tank(), build_boat(), build_hangar(), build_tower(), build_crate()]
x = 0.0
for ob in BUILT:
    ob.location = (x, 0, 0)
    x += 18.0
print('TARGETS', [(o.name, len(o.data.polygons)) for o in BUILT])
