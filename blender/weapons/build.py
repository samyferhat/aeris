"""Every store the MiG-29 can carry, built as separate objects in one file.

The engine loads stores.glb once and clones the object named after each store id,
so each object here has to be self-contained, centred on its own mid-length, and
named exactly as the armament catalogue names it.
"""
import bpy, math, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', 'mig'))
from mlib import MB, P, S0, TAU, new_obj, finish, make_mat  # noqa: E402
from wlib import ring, ogive, tube, fin, fin_set, clear_scene  # noqa: E402

clear_scene()

# ------------------------------------------------------------- materials ---
# Soviet air-to-air rounds leave the factory in a light grey lacquer; ground
# ordnance is olive drab. The seeker windows are the only things that are not
# paint, and they are what makes a missile read as a missile up close.
MAT = {
    'aam':    make_mat('Store_AAM',    (0.58, 0.59, 0.57), 0.42, 0.0),
    'aam2':   make_mat('Store_AAM2',   (0.30, 0.31, 0.30), 0.50, 0.0),
    'seeker': make_mat('Store_Seeker', (0.05, 0.06, 0.08), 0.06, 0.35, ior=1.9),
    'radome': make_mat('Store_Radome', (0.16, 0.14, 0.12), 0.45, 0.0),
    'metal':  make_mat('Store_Metal',  (0.44, 0.44, 0.45), 0.30, 1.0),
    'nozzle': make_mat('Store_Nozzle', (0.10, 0.09, 0.09), 0.55, 1.0),
    'pod':    make_mat('Store_Pod',    (0.21, 0.24, 0.19), 0.62, 0.0),
    'bore':   make_mat('Store_Bore',   (0.03, 0.03, 0.03), 0.85, 0.0),
    'bomb':   make_mat('Store_Bomb',   (0.20, 0.22, 0.17), 0.68, 0.0),
    'band':   make_mat('Store_Band',   (0.42, 0.12, 0.10), 0.60, 0.0),
}
ORDER = ['aam', 'aam2', 'seeker', 'radome', 'metal', 'nozzle', 'pod', 'bore', 'bomb', 'band']
IDX = {k: i for i, k in enumerate(ORDER)}
MATS = [MAT[k] for k in ORDER]
A, A2, SK, RD, ME, NZ, PD, BO, BM, BA = (IDX[k] for k in ORDER)


def store(name, mb):
    ob = new_obj(name, mb, MATS)
    finish(ob, bevel=0.004, seg=1)
    return ob


def body_bands(mb, s0, s1, r, n=2, w=0.035, mat=None):
    """Painted identification bands. Two millimetres proud so they catch a highlight
    instead of relying on a texture the store does not have."""
    for i in range(n):
        s = s0 + (s1 - s0) * (i + 1) / (n + 1)
        tube(mb, s - w, s + w, r * 1.012, r * 1.012, 20, False, False,
             BA if mat is None else mat)


# ================================================================= R-73 ====
# 2.90 m, 170 mm body, 510 mm over the wings. The signature shape is the stack of
# four control surfaces: nose destabilisers, canards, mid wings and tail fins.
def build_r73():
    mb = MB()
    L, r = 2.90, 0.085
    s0 = S0 - L / 2
    ogive(mb, s0, s0 + 0.30, r, 8, 18, SK, blunt=0.30)          # seeker dome
    tube(mb, s0 + 0.30, s0 + 0.34, r, r, 18, False, False, A2)  # dome ring
    tube(mb, s0 + 0.34, s0 + L - 0.10, r, r, 18, False, False, A)
    tube(mb, s0 + L - 0.10, s0 + L, r, r * 0.86, 18, False, True, NZ)
    tube(mb, s0 + L - 0.13, s0 + L - 0.02, r * 0.55, r * 0.55, 14, True, True, NZ)
    body_bands(mb, s0 + 0.45, s0 + 1.30, r, 2)
    # nose destabilisers: tiny, and set at 45 degrees to the canards
    fin_set(mb, 4, TAU / 8, s0 + 0.33, s0 + 0.46, s0 + 0.40, s0 + 0.46,
            r, r + 0.055, 0.012, ME)
    # canards
    fin_set(mb, 4, 0.0, s0 + 0.62, s0 + 0.92, s0 + 0.74, s0 + 0.92,
            r, r + 0.115, 0.016, A2)
    # mid wings, long and shallow
    fin_set(mb, 4, 0.0, s0 + 1.62, s0 + 2.40, s0 + 1.96, s0 + 2.40,
            r, r + 0.170, 0.018, A)
    # tail fins with the cropped tip the R-73 has
    fin_set(mb, 4, TAU / 8, s0 + 2.42, s0 + 2.88, s0 + 2.58, s0 + 2.88,
            r, r + 0.150, 0.016, A2)
    return store('R73', mb)


# ================================================================ R-27R ====
# 4.08 m, 230 mm. Long pointed radome and the notched "butterfly" mid wings that
# nothing else in the inventory has.
def build_r27():
    mb = MB()
    L, r = 4.08, 0.115
    s0 = S0 - L / 2
    ogive(mb, s0, s0 + 0.78, r, 10, 20, RD, blunt=0.10)
    tube(mb, s0 + 0.78, s0 + L - 0.12, r, r, 20, False, False, A)
    tube(mb, s0 + L - 0.12, s0 + L, r, r * 0.80, 20, False, True, NZ)
    body_bands(mb, s0 + 1.00, s0 + 2.20, r, 2)
    # butterfly wings: a shallow root panel then a sharply swept outer panel
    for i in range(4):
        roll = TAU * i / 4
        fin(mb, roll, s0 + 1.62, s0 + 2.34, s0 + 1.74, s0 + 2.34,
            r, r + 0.075, 0.020, A)
        fin(mb, roll, s0 + 1.74, s0 + 2.34, s0 + 2.10, s0 + 2.30,
            r + 0.075, r + 0.271, 0.016, A)
    # tail control fins, set 45 degrees off the wings
    fin_set(mb, 4, TAU / 8, s0 + 3.30, s0 + 4.04, s0 + 3.62, s0 + 4.04,
            r, r + 0.225, 0.018, A2)
    return store('R27', mb)


# ================================================================ R-60M ====
def build_r60():
    mb = MB()
    L, r = 2.09, 0.060
    s0 = S0 - L / 2
    ogive(mb, s0, s0 + 0.19, r, 7, 14, SK, blunt=0.34)
    tube(mb, s0 + 0.19, s0 + L - 0.07, r, r, 14, False, False, A)
    tube(mb, s0 + L - 0.07, s0 + L, r, r * 0.84, 14, False, True, NZ)
    body_bands(mb, s0 + 0.34, s0 + 0.90, r, 1)
    fin_set(mb, 4, 0.0, s0 + 0.30, s0 + 0.50, s0 + 0.40, s0 + 0.50,
            r, r + 0.055, 0.012, ME)
    fin_set(mb, 4, TAU / 8, s0 + 1.60, s0 + 2.06, s0 + 1.80, s0 + 2.06,
            r, r + 0.135, 0.014, A2)
    return store('R60', mb)


# =============================================================== B-8M1 =====
# Twenty 80 mm tubes. The open muzzle face is the whole character of the pod, so
# each tube is a real bore with a wall and a dark base rather than a painted dot.
def _pod(name, L, R, rings, bore, nose_frac=0.16):
    mb = MB()
    s0 = S0 - L / 2
    sf = s0 + L * nose_frac                       # muzzle face
    tube(mb, s0, sf, R * 0.94, R, 24, False, False, PD)     # short nose fairing
    tube(mb, sf, s0 + L - 0.30, R, R, 24, False, False, PD)
    tube(mb, s0 + L - 0.30, s0 + L, R, R * 0.72, 24, False, True, PD)
    for k in (-1, 1):
        mb.box(-0.032, 0.032, S0 + k * 0.180, S0 + k * 0.180 + 0.060, R * 0.98, R + 0.080, ME)
    # muzzle face: an annulus, then the bores sunk into it
    mb._loft_world([ring(0, 0, sf, R, 24), ring(0, 0, sf, R * 0.985, 24)],
                   True, False, False, PD)
    depth = min(0.55, L * 0.30)
    for (rr, n) in rings:
        for i in range(n):
            a = TAU * i / n + (0.5 * TAU / n if rr > 0 else 0)
            cx, cz = rr * math.cos(a), rr * math.sin(a)
            b0 = [P(cx + bore * math.cos(TAU * k / 8), sf, cz + bore * math.sin(TAU * k / 8)) for k in range(8)]
            b1 = [P(cx + bore * math.cos(TAU * k / 8), sf + depth, cz + bore * math.sin(TAU * k / 8)) for k in range(8)]
            mb._loft_world([b0, b1], True, False, True, BO, flip=True)
    return store(name, mb)


def build_b8m1():
    return _pod('B8M1', 2.76, 0.260, [(0.0, 1), (0.098, 6), (0.185, 13)], 0.042)


def build_ub32():
    return _pod('UB32', 2.08, 0.230, [(0.0, 1), (0.073, 6), (0.135, 11), (0.190, 14)], 0.030)


# =============================================================== S-24B =====
def build_s24():
    mb = MB()
    L, r = 2.33, 0.120
    s0 = S0 - L / 2
    ogive(mb, s0, s0 + 0.42, r, 8, 16, BM, blunt=0.16)
    tube(mb, s0 + 0.42, s0 + L - 0.24, r, r, 16, False, False, BM)
    tube(mb, s0 + L - 0.24, s0 + L, r, r * 0.78, 16, False, True, NZ)
    body_bands(mb, s0 + 0.55, s0 + 1.00, r, 1)
    fin_set(mb, 4, TAU / 8, s0 + 1.72, s0 + 2.30, s0 + 1.92, s0 + 2.30,
            r, r + 0.145, 0.014, ME)
    return store('S24', mb)


# ======================================================== S-8 in flight ====
# The rocket that leaves the pod. Fins spring open on the way out, so they are
# modelled deployed: this object is only ever seen after launch.
def build_s8():
    mb = MB()
    L, r = 1.57, 0.040
    s0 = S0 - L / 2
    ogive(mb, s0, s0 + 0.22, r, 6, 12, BM, blunt=0.20)
    tube(mb, s0 + 0.22, s0 + L - 0.05, r, r, 12, False, False, BM)
    tube(mb, s0 + L - 0.05, s0 + L, r, r * 0.80, 12, False, True, NZ)
    fin_set(mb, 4, 0.0, s0 + L - 0.24, s0 + L, s0 + L - 0.20, s0 + L,
            r, r + 0.075, 0.006, ME)
    return store('S8', mb)


# ================================================================= FAB =====
def _fab(name, L, R):
    mb = MB()
    s0 = S0 - L / 2
    ogive(mb, s0, s0 + L * 0.30, R, 9, 18, BM, blunt=0.13)
    tube(mb, s0 + L * 0.30, s0 + L * 0.68, R, R, 18, False, False, BM)
    tube(mb, s0 + L * 0.68, s0 + L * 0.90, R, R * 0.55, 18, False, False, BM)
    tube(mb, s0 + L * 0.90, s0 + L, R * 0.55, R * 0.50, 18, False, True, BM)
    body_bands(mb, s0 + L * 0.34, s0 + L * 0.62, R, 2)
    # Boxy tail fins braced by a ring, the way a FAB is actually built. The root has
    # to start inside the tail cone, not at the cone's own radius: taken from the
    # surface the fins come out as slivers hanging off the very back.
    fin_set(mb, 4, TAU / 8, s0 + L * 0.66, s0 + L * 0.99, s0 + L * 0.66, s0 + L * 0.99,
            R * 0.30, R * 1.12, 0.014, ME, bevel_tip=False)
    tube(mb, s0 + L * 0.955, s0 + L * 0.985, R * 1.12, R * 1.12, 18, False, False, ME)
    # suspension lugs: the pair of steel eyes a bomb actually hangs from
    for k in (-1, 1):
        mb.box(-0.030, 0.030, s0 + L * 0.44 + k * 0.180, s0 + L * 0.44 + k * 0.180 + 0.055,
               R * 0.98, R + 0.075, ME)
    return store(name, mb)


def build_fab250():
    return _fab('FAB250', 1.924, 0.1425)


def build_fab500():
    return _fab('FAB500', 2.425, 0.2000)


# =============================================================== KMGU-2 ====
def build_kmgu():
    mb = MB()
    L, R = 3.70, 0.250
    s0 = S0 - L / 2
    ogive(mb, s0, s0 + 0.55, R, 8, 20, PD, blunt=0.22)
    tube(mb, s0 + 0.55, s0 + L - 0.55, R, R, 20, False, False, PD)
    tube(mb, s0 + L - 0.55, s0 + L, R, R * 0.42, 20, False, True, PD)
    # the row of dispenser bay doors along the belly
    for i in range(4):
        s = s0 + 0.85 + i * 0.55
        mb.box(-R * 0.55, R * 0.55, s, s + 0.42, -R * 1.02, -R * 0.90, A2)
    body_bands(mb, s0 + 0.70, s0 + 1.40, R, 1)
    return store('KMGU', mb)


BUILT = [build_r73(), build_r27(), build_r60(), build_b8m1(), build_ub32(),
         build_s24(), build_s8(), build_fab250(), build_fab500(), build_kmgu()]

# Lay them out along X so the viewport shows the whole rack at a glance.
x = 0.0
for ob in BUILT:
    ob.location = (x, 0, 0)
    x += 1.0

print('STORES', [(o.name, len(o.data.polygons)) for o in BUILT])
