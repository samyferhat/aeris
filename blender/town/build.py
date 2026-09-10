"""The built world: houses, blocks, sheds, a church, dock cranes, boats, a bridge tower.

Twenty-odd archetypes, reused a few thousand times each. Coordinates here are plain
Blender ones — X right, Y north, Z up — because nothing in a town is measured from the
nose of an aeroplane. Every object is centred on its own footprint and sits with its
floor at z = 0, so the engine can drop it on the terrain by its origin alone.

These are read from three hundred metres and up, and in a street from fifty. What has to
be right at that range is the silhouette, the roof pitch, the floor count and the rhythm
of the windows; anything finer is invisible and costs a draw call's worth of triangles.

Materials are named by role, and the engine reads the prefix:
    W_  wall      tinted per instance, so the same house is never the same colour twice
    R_  roof      tile or metal, tinted only a little
    G_  glass     the windows, which light up at dusk one building at a time
    D_  detail    trim, wood, concrete, steel — left alone
"""
import bpy, math, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'mig'))
sys.path.insert(0, os.path.join(HERE, '..', 'weapons'))
from mlib import MB, new_obj, finish, make_mat  # noqa: E402
from wlib import clear_scene  # noqa: E402

clear_scene()
TAU = math.pi * 2.0

MAT = {
    'plaster': make_mat('W_Plaster', (0.62, 0.58, 0.52), 0.80, 0.0),
    'stone':   make_mat('W_Stone',   (0.44, 0.42, 0.38), 0.86, 0.0),
    'render':  make_mat('W_Render',  (0.55, 0.53, 0.50), 0.84, 0.0),
    'tile':    make_mat('R_Tile',    (0.26, 0.115, 0.070), 0.82, 0.0),
    'slate':   make_mat('R_Slate',   (0.055, 0.058, 0.062), 0.66, 0.0),
    'zinc':    make_mat('R_Zinc',    (0.20, 0.205, 0.21), 0.52, 0.55),
    'glass':   make_mat('G_Window',  (0.030, 0.038, 0.048), 0.16, 0.0),
    'wood':    make_mat('D_Wood',    (0.115, 0.072, 0.042), 0.86, 0.0),
    'conc':    make_mat('D_Conc',    (0.30, 0.295, 0.280), 0.88, 0.0),
    'white':   make_mat('D_White',   (0.70, 0.70, 0.68), 0.70, 0.0),
    'steel':   make_mat('D_Steel',   (0.32, 0.33, 0.34), 0.44, 0.9),
    'dark':    make_mat('D_Dark',    (0.045, 0.045, 0.048), 0.70, 0.0),
    'rust':    make_mat('D_Rust',    (0.20, 0.105, 0.055), 0.88, 0.0),
    'navy':    make_mat('D_Navy',    (0.055, 0.070, 0.095), 0.62, 0.0),
}
ORDER = ['plaster', 'stone', 'render', 'tile', 'slate', 'zinc', 'glass',
         'wood', 'conc', 'white', 'steel', 'dark', 'rust', 'navy']
IDX = {k: i for i, k in enumerate(ORDER)}
MATS = [MAT[k] for k in ORDER]
PL, ST, RE, TI, SL, ZI, GL, WD, CO, WH, STL, DK, RU, NV = (IDX[k] for k in ORDER)


# ---------------------------------------------------------------- helpers --
def bx(mb, cx, cy, w, d, z0, z1, mat):
    """Axis-aligned box by centre and size, in Blender coordinates."""
    x0, x1, y0, y1 = cx - w / 2, cx + w / 2, cy - d / 2, cy + d / 2
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
         (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    f = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
    mb.add(v, f, mat)


def gable(mb, cx, cy, w, d, z0, h, mat, over=0.35, along_x=True):
    """Two-slope roof. The ridge runs along X unless told otherwise."""
    W, D = w / 2 + over, d / 2 + over
    if not along_x:
        W, D = D, W
    v = [(cx - W, cy - D, z0), (cx + W, cy - D, z0), (cx + W, cy + D, z0), (cx - W, cy + D, z0),
         (cx - W, cy, z0 + h), (cx + W, cy, z0 + h)]
    f = [[0, 1, 5, 4], [2, 3, 4, 5], [0, 4, 3], [1, 2, 5]]
    if not along_x:
        v = [(cx + (p[1] - cy), cy - (p[0] - cx), p[2]) for p in v]
        f = [list(reversed(fc)) for fc in f]
    mb.add(v, f, mat)


def hip(mb, cx, cy, w, d, z0, h, mat, over=0.4):
    """Hipped roof: four slopes meeting on a short ridge along the long side."""
    W, D = w / 2 + over, d / 2 + over
    r = max(0.0, (w - d) / 2) if w > d else 0.0
    v = [(cx - W, cy - D, z0), (cx + W, cy - D, z0), (cx + W, cy + D, z0), (cx - W, cy + D, z0),
         (cx - r, cy, z0 + h), (cx + r, cy, z0 + h)]
    f = [[0, 1, 5, 4], [2, 3, 4, 5], [0, 4, 3], [1, 2, 5]]
    mb.add(v, f, mat)


def parapet(mb, cx, cy, w, d, z, hgt, mat, t=0.28):
    for (ox, oy, ww, dd) in ((0, -d / 2 + t / 2, w, t), (0, d / 2 - t / 2, w, t),
                             (-w / 2 + t / 2, 0, t, d - 2 * t), (w / 2 - t / 2, 0, t, d - 2 * t)):
        bx(mb, cx + ox, cy + oy, ww, dd, z, z + hgt, mat)


def wall_windows(mb, cx, cy, w, d, z0, floors, fh, cols, mat=GL, sill=0.9, wh=1.45, ww=1.0):
    """
    Rows of windows on all four faces, as single quads standing a few centimetres proud
    of the wall. Quads rather than recesses: a window is two triangles at this range, and
    a recess is twenty-four for a shadow nobody sees from the air.
    """
    e = 0.05
    for fl in range(floors):
        z = z0 + fl * fh + sill
        for (nx, ny, sgn) in ((1, 0, -1), (1, 0, 1), (0, 1, -1), (0, 1, 1)):
            span = (w if nx else d) - 1.4
            if span <= 0 or cols <= 0:
                continue
            for c in range(cols):
                t = (c + 0.5) / cols - 0.5
                if nx:
                    x, y = cx + t * span, cy + sgn * (d / 2 + e)
                    v = [(x - ww / 2, y, z), (x + ww / 2, y, z), (x + ww / 2, y, z + wh), (x - ww / 2, y, z + wh)]
                    f = [[0, 1, 2, 3]] if sgn > 0 else [[3, 2, 1, 0]]
                else:
                    x, y = cx + sgn * (w / 2 + e), cy + t * span
                    v = [(x, y - ww / 2, z), (x, y + ww / 2, z), (x, y + ww / 2, z + wh), (x, y - ww / 2, z + wh)]
                    f = [[3, 2, 1, 0]] if sgn > 0 else [[0, 1, 2, 3]]
                mb.add(v, f, mat)


def chimney(mb, x, y, z0, h, mat=ST):
    bx(mb, x, y, 0.7, 0.7, z0, z0 + h, mat)
    bx(mb, x, y, 0.95, 0.95, z0 + h, z0 + h + 0.18, CO)


def obj(name, mb, bevel=0.025):
    o = new_obj(name, mb, MATS)
    finish(o, bevel=bevel, seg=1, angle=math.radians(25))
    return o


# ============================================================ old town =====
# Narrow, deep, tall and touching. What makes a waterfront read as an old quarter is
# that the plots are three times deeper than they are wide and the ridges all run the
# same way; the variation is in the height, not in the plan.
def town_house(name, w, d, floors, fh=3.1, roof=TI, wall=PL, cols=2):
    mb = MB()
    h = floors * fh
    bx(mb, 0, 0, w, d, 0, h, wall)
    gable(mb, 0, 0, w, d, h, min(w, d) * 0.34, roof, over=0.3, along_x=w >= d)
    wall_windows(mb, 0, 0, w, d, 0, floors, fh, cols)
    # Ground floor: a door, and a band of darker render at street level.
    bx(mb, 0, -d / 2 - 0.04, 1.1, 0.08, 0.0, 2.25, WD)
    bx(mb, 0, 0, w + 0.06, d + 0.06, 0, 0.55, ST)
    chimney(mb, w * 0.28, d * 0.18, h, 1.5)
    return obj(name, mb)


def build_town_a():
    return town_house('Town_A', 6.2, 9.0, 3)


def build_town_b():
    return town_house('Town_B', 7.4, 10.5, 4, cols=3)


def build_town_c():
    return town_house('Town_C', 8.6, 7.4, 2, roof=TI, wall=RE, cols=3)


def build_town_d():
    """A corner building: two wings meeting at right angles round a small yard."""
    mb = MB()
    fh, floors = 3.15, 3
    h = floors * fh
    bx(mb, 0, 2.0, 12.0, 7.0, 0, h, PL)
    bx(mb, -3.0, -3.5, 6.0, 4.5, 0, h, PL)
    gable(mb, 0, 2.0, 12.0, 7.0, h, 2.4, TI, along_x=True)
    gable(mb, -3.0, -3.5, 6.0, 4.5, h, 1.6, TI, along_x=True)
    wall_windows(mb, 0, 2.0, 12.0, 7.0, 0, floors, fh, 4)
    bx(mb, 0, 2.0, 12.1, 7.1, 0, 0.6, ST)
    chimney(mb, 4.0, 4.0, h, 1.6)
    return obj('Town_D', mb)


# ============================================================= suburb ======
def build_house_a():
    mb = MB()
    bx(mb, 0, 0, 9.0, 7.2, 0, 3.2, PL)
    hip(mb, 0, 0, 9.0, 7.2, 3.2, 2.3, TI)
    wall_windows(mb, 0, 0, 9.0, 7.2, 0, 1, 3.2, 2, sill=1.0)
    bx(mb, -1.6, -3.7, 1.0, 0.1, 0, 2.1, WD)
    chimney(mb, 2.6, 1.4, 4.4, 1.2)
    return obj('House_A', mb)


def build_house_b():
    mb = MB()
    fh = 3.0
    bx(mb, 0, 0, 11.0, 8.0, 0, 2 * fh, RE)
    gable(mb, 0, 0, 11.0, 8.0, 2 * fh, 2.9, TI)
    wall_windows(mb, 0, 0, 11.0, 8.0, 0, 2, fh, 3)
    # A porch on the south face.
    bx(mb, 0, -4.6, 4.0, 1.4, 0, 2.6, WH)
    bx(mb, 0, -4.6, 4.4, 1.8, 2.6, 2.8, WD)
    chimney(mb, 3.4, 1.0, 2 * fh + 2.0, 1.3)
    return obj('House_B', mb)


def build_villa():
    mb = MB()
    fh = 3.2
    bx(mb, 0, 0, 14.0, 10.0, 0, 2 * fh, PL)
    hip(mb, 0, 0, 14.0, 10.0, 2 * fh, 2.6, TI)
    wall_windows(mb, 0, 0, 14.0, 10.0, 0, 2, fh, 4)
    # Terrace with a pergola on the seaward side.
    bx(mb, 0, -6.4, 12.0, 3.2, 0, 0.45, WH)
    for k in (-5.0, -1.7, 1.7, 5.0):
        bx(mb, k, -7.6, 0.22, 0.22, 0.45, 3.0, WD)
    for k in range(7):
        bx(mb, 0, -7.9 + k * 0.42, 12.0, 0.1, 3.0, 3.12, WD)
    chimney(mb, 4.6, 2.0, 2 * fh + 2.2, 1.4)
    return obj('Villa', mb)


def build_farm():
    """A farmhouse with a barn attached at right angles, and a yard between them."""
    mb = MB()
    bx(mb, -4.0, 0, 12.0, 8.0, 0, 5.8, RE)
    gable(mb, -4.0, 0, 12.0, 8.0, 5.8, 2.6, TI)
    wall_windows(mb, -4.0, 0, 12.0, 8.0, 0, 2, 2.9, 3)
    chimney(mb, -8.0, 1.6, 8.4, 1.3)
    # Barn: open-sided, higher ridge, corrugated roof.
    bx(mb, 6.5, -3.0, 9.0, 14.0, 0, 5.0, WD)
    gable(mb, 6.5, -3.0, 9.0, 14.0, 5.0, 2.2, ZI, along_x=False)
    bx(mb, 6.5, -3.0, 9.2, 14.2, 0, 0.4, CO)
    return obj('Farm', mb)


# ========================================================== apartments =====
def block(name, w, d, floors, fh=3.05, wall=RE, stair=True):
    mb = MB()
    h = floors * fh
    bx(mb, 0, 0, w, d, 0, h, wall)
    parapet(mb, 0, 0, w, d, h, 0.85, CO)
    wall_windows(mb, 0, 0, w, d, 0, floors, fh, max(2, int(w / 4.2)), sill=1.0, wh=1.5, ww=1.2)
    # Balcony slabs down the long faces: the one thing that says flats and not offices.
    for fl in range(1, floors):
        for sgn in (-1, 1):
            bx(mb, 0, sgn * (d / 2 + 0.55), w * 0.82, 1.1, fl * fh - 0.12, fl * fh, WH)
    if stair:
        bx(mb, w * 0.36, 0, 3.0, d * 0.5, h, h + 2.6, CO)
    bx(mb, 0, 0, w + 0.08, d + 0.08, 0, 0.8, CO)
    return obj(name, mb)


def build_block_a():
    return block('Block_A', 22.0, 12.0, 5)


def build_block_b():
    return block('Block_B', 30.0, 14.0, 8)


def build_block_c():
    return block('Block_C', 16.0, 11.0, 3, wall=PL, stair=False)


def build_terrace():
    """A run of five joined townhouses: the periphery's cheapest possible street wall."""
    mb = MB()
    fh, floors, n, w = 3.0, 3, 5, 6.4
    for i in range(n):
        x = (i - (n - 1) / 2) * w
        h = floors * fh + (0.0 if i % 2 else 0.35)
        bx(mb, x, 0, w, 8.4, 0, h, PL if i % 2 else RE)
        gable(mb, x, 0, w, 8.4, h, 2.0, TI, over=0.12)
        wall_windows(mb, x, 0, w, 8.4, 0, floors, fh, 2)
        bx(mb, x - 1.4, -4.3, 1.0, 0.1, 0, 2.1, WD)
    bx(mb, 0, 0, n * w + 0.1, 8.5, 0, 0.5, ST)
    return obj('Terrace', mb)


# ============================================================== civic ======
def build_church():
    mb = MB()
    # Nave
    bx(mb, 0, 0, 11.0, 24.0, 0, 9.5, ST)
    gable(mb, 0, 0, 11.0, 24.0, 9.5, 4.2, TI, along_x=False)
    wall_windows(mb, 0, 0, 11.0, 24.0, 0, 1, 6.0, 5, sill=3.4, wh=3.2, ww=0.9)
    # Apse
    mb.cyl((0, 12.0, 0.0), (0, 12.0, 8.0), 5.5, 5.5, 14, False, ST)
    mb.cyl((0, 12.0, 8.0), (0, 12.0, 11.6), 5.9, 0.2, 14, True, TI)
    # Bell tower at the west end
    bx(mb, 0, -14.5, 7.0, 7.0, 0, 24.0, ST)
    for sgn in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        bx(mb, sgn[0] * 3.55, -14.5 + sgn[1] * 3.55, 1.8 if sgn[0] == 0 else 0.1,
           0.1 if sgn[0] == 0 else 1.8, 18.5, 22.0, DK)
    bx(mb, 0, -14.5, 7.8, 7.8, 24.0, 24.7, CO)
    mb.cyl((0, -14.5, 24.7), (0, -14.5, 33.0), 4.4, 0.15, 4, True, SL)
    mb.cyl((0, -14.5, 33.0), (0, -14.5, 35.2), 0.09, 0.09, 6, True, STL)
    return obj('Church', mb, bevel=0.03)


def build_school():
    mb = MB()
    fh, floors = 3.6, 2
    bx(mb, 0, 0, 34.0, 14.0, 0, floors * fh, RE)
    parapet(mb, 0, 0, 34.0, 14.0, floors * fh, 0.7, CO)
    wall_windows(mb, 0, 0, 34.0, 14.0, 0, floors, fh, 8, sill=1.1, wh=1.8, ww=1.6)
    bx(mb, 0, -7.9, 6.0, 2.2, 0, 3.4, WH)
    return obj('School', mb)


def build_shop():
    mb = MB()
    fh = 3.3
    bx(mb, 0, 0, 10.0, 8.0, 0, 2 * fh, PL)
    gable(mb, 0, 0, 10.0, 8.0, 2 * fh, 2.2, TI)
    wall_windows(mb, 0, 0, 10.0, 8.0, 3.3, 1, fh, 3)
    # Shopfront: full-width glass and a striped awning over the pavement.
    bx(mb, 0, -4.02, 8.4, 0.1, 0.4, 2.9, GL)
    bx(mb, 0, -5.3, 9.0, 2.6, 3.0, 3.16, RU)
    return obj('Shop', mb)


# ========================================================= industrial ======
def build_warehouse():
    mb = MB()
    bx(mb, 0, 0, 40.0, 20.0, 0, 8.5, CO)
    gable(mb, 0, 0, 40.0, 20.0, 8.5, 2.6, ZI, over=0.5, along_x=True)
    for i in range(4):
        bx(mb, -15.0 + i * 10.0, -10.06, 5.0, 0.12, 0.0, 5.0, DK)
    wall_windows(mb, 0, 0, 40.0, 20.0, 0, 1, 7.0, 6, sill=6.0, wh=1.2, ww=2.4)
    return obj('Warehouse', mb, bevel=0.03)


def build_shed():
    mb = MB()
    bx(mb, 0, 0, 18.0, 10.0, 0, 5.2, ZI)
    gable(mb, 0, 0, 18.0, 10.0, 5.2, 1.5, ZI, over=0.4)
    bx(mb, 0, -5.06, 6.0, 0.12, 0.0, 4.2, RU)
    return obj('Shed', mb, bevel=0.02)


def build_silo():
    mb = MB()
    for k in (-1, 1):
        mb.cyl((k * 3.4, 0, 0), (k * 3.4, 0, 13.0), 3.0, 3.0, 16, True, WH)
        mb.cyl((k * 3.4, 0, 13.0), (k * 3.4, 0, 15.2), 3.0, 0.6, 16, True, STL)
    bx(mb, 0, 0, 7.4, 0.5, 9.0, 13.5, STL)
    return obj('Silo', mb, bevel=0.02)


def build_water_tower():
    mb = MB()
    for (sx, sy) in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        mb.cyl((sx * 2.6, sy * 2.6, 0), (sx * 1.1, sy * 1.1, 14.0), 0.20, 0.16, 6, True, STL)
    for z in (5.0, 10.0):
        for (a, b) in (((1, 1), (1, -1)), ((1, -1), (-1, -1)), ((-1, -1), (-1, 1)), ((-1, 1), (1, 1))):
            t = z / 14.0
            r = 2.6 + (1.1 - 2.6) * t
            mb.cyl((a[0] * r, a[1] * r, z), (b[0] * r, b[1] * r, z), 0.09, 0.09, 5, True, STL)
    mb.cyl((0, 0, 14.0), (0, 0, 19.4), 3.6, 3.6, 16, True, WH)
    mb.cyl((0, 0, 19.4), (0, 0, 21.0), 3.6, 0.4, 16, True, STL)
    return obj('WaterTower', mb, bevel=0.02)


def build_crane():
    """Dock gantry: a portal on rails with a jib out over the water."""
    mb = MB()
    for (sx, sy) in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        mb.cyl((sx * 5.0, sy * 4.0, 0), (sx * 2.2, sy * 2.6, 21.0), 0.42, 0.32, 6, True, RU)
    bx(mb, 0, 0, 6.0, 6.4, 21.0, 24.0, RU)
    # Jib, cantilevered seaward, with a counterweight aft.
    bx(mb, 0, -16.0, 2.2, 34.0, 22.6, 23.6, RU)
    bx(mb, 0, 7.5, 3.4, 5.0, 22.0, 25.2, DK)
    mb.cyl((0, -30.0, 22.6), (0, -30.0, 12.0), 0.07, 0.07, 5, True, DK)
    bx(mb, 0, -30.0, 1.6, 1.6, 10.4, 12.0, DK)
    for sy in (-1, 1):
        bx(mb, 0, sy * 4.0, 11.0, 0.9, 0.0, 0.7, STL)
    return obj('Crane', mb, bevel=0.03)


def build_quay_shed():
    mb = MB()
    bx(mb, 0, 0, 26.0, 13.0, 0, 7.0, RU)
    gable(mb, 0, 0, 26.0, 13.0, 7.0, 1.8, ZI, over=0.45)
    for i in range(3):
        bx(mb, -8.0 + i * 8.0, -6.56, 4.4, 0.12, 0.0, 4.6, DK)
    return obj('QuayShed', mb, bevel=0.02)


# ============================================================== boats ======
def hull(mb, L, B, D, sheer, mat, deck_mat=None):
    """
    A boat hull as a lofted set of sections, with the deck closed over the top.

    Sheer runs the right way round: high at the bow, lowest a little aft of midships,
    rising again at the transom. Get that backwards and the boat reads as a bathtub
    however good the plan view is.
    """
    rings, tops = [], []
    for (t, wf, zf) in ((0.00, 0.08, 0.60), (0.10, 0.46, 0.32), (0.30, 0.92, 0.12),
                        (0.62, 1.00, 0.10), (0.88, 0.86, 0.18), (1.00, 0.68, 0.28)):
        y = L / 2 - L * t                       # t = 0 is the bow, at +Y
        b = B / 2 * wf
        zb = -D * (1.0 - zf)
        u = 2.0 * t - 1.0
        zt = sheer * (0.78 + 0.30 * u * u + 0.16 * max(0.0, u))
        rings.append([(-b, y, zt), (-b * 0.94, y, zb * 0.45), (0.0, y, zb),
                      (b * 0.94, y, zb * 0.45), (b, y, zt)])
        tops.append(((-b * 0.99, y, zt - 0.02), (b * 0.99, y, zt - 0.02)))
    mb._loft_world(rings, False, False, False, mat)
    vs, fs = [], []
    for i in range(len(tops) - 1):
        a, b2 = tops[i], tops[i + 1]
        base = len(vs)
        vs.extend([a[0], a[1], b2[1], b2[0]])
        fs.append([base, base + 1, base + 2, base + 3])
    mb.add(vs, fs, deck_mat if deck_mat is not None else mat)


def build_fishing_boat():
    mb = MB()
    hull(mb, 12.0, 3.8, 1.5, 1.15, WH, deck_mat=WD)
    bx(mb, 0, -0.6, 2.6, 3.2, 0.95, 3.3, WH)
    bx(mb, 0, -0.6, 2.7, 3.3, 3.3, 3.5, NV)
    bx(mb, 0, 0.98, 2.2, 0.1, 2.1, 3.1, GL)
    mb.cyl((0, 0.2, 3.5), (0, 0.2, 8.2), 0.10, 0.07, 6, True, WD)
    mb.cyl((0, 0.2, 6.4), (0, 4.0, 4.0), 0.07, 0.07, 5, True, WD)
    bx(mb, 0, -4.2, 2.4, 1.6, 0.95, 1.35, RU)
    return obj('BoatFishing', mb, bevel=0.02)


def build_cargo_ship():
    mb = MB()
    hull(mb, 78.0, 13.0, 5.2, 3.1, NV, deck_mat=RU)
    # Hold hatches, forward of the island.
    for i in range(4):
        bx(mb, 0, 12.0 - i * 11.5, 9.0, 8.6, 3.0, 3.9, WH)
    # Superstructure aft
    bx(mb, 0, -26.0, 11.4, 10.0, 3.0, 12.6, WH)
    for fl in range(3):
        for sgn in (-1, 1):
            bx(mb, sgn * 5.75, -26.0, 0.1, 8.0, 5.0 + fl * 2.6, 6.4 + fl * 2.6, GL)
    bx(mb, 0, -28.0, 5.6, 4.6, 12.6, 15.6, WH)
    mb.cyl((0, -29.0, 15.6), (0, -29.0, 21.0), 1.9, 1.7, 12, True, DK)
    # Kingposts amidships, which is most of a coaster's silhouette.
    for y in (18.0, -12.0):
        mb.cyl((0, y, 3.0), (0, y, 15.0), 0.45, 0.35, 8, True, WH)
    return obj('CargoShip', mb, bevel=0.04)


def build_skiff():
    mb = MB()
    hull(mb, 6.4, 2.1, 0.75, 0.62, WH, deck_mat=WD)
    bx(mb, 0, -0.4, 1.5, 1.2, 0.55, 1.45, WH)
    bx(mb, 0, 2.5, 0.7, 0.5, 0.55, 0.95, DK)
    return obj('Skiff', mb, bevel=0.015)


# ====================================================== infrastructure =====
def build_lighthouse():
    mb = MB()
    mb.cyl((0, 0, 0), (0, 0, 3.0), 5.2, 4.6, 16, True, WH)
    mb.cyl((0, 0, 3.0), (0, 0, 20.0), 3.2, 2.1, 16, False, WH)
    # Red band round the middle, so it reads at range.
    mb.cyl((0, 0, 9.0), (0, 0, 13.0), 2.78, 2.48, 16, False, RU)
    mb.cyl((0, 0, 20.0), (0, 0, 21.0), 3.0, 3.0, 16, True, STL)
    mb.cyl((0, 0, 21.0), (0, 0, 24.4), 2.2, 2.2, 12, False, GL)
    mb.cyl((0, 0, 24.4), (0, 0, 26.6), 2.6, 0.3, 12, True, DK)
    bx(mb, 0, 6.6, 7.0, 8.0, 0, 3.4, WH)
    gable(mb, 0, 6.6, 7.0, 8.0, 3.4, 1.6, TI)
    return obj('Lighthouse', mb, bevel=0.03)


def build_bridge_tower():
    """One tower of the suspension bridge: two legs, two cross beams, saddle on top."""
    mb = MB()
    H = 96.0
    for sx in (-1, 1):
        for z0, z1, r0, r1 in ((0.0, 30.0, 3.6, 3.0), (30.0, 66.0, 3.0, 2.5), (66.0, H, 2.5, 2.1)):
            mb.cyl((sx * 11.0, 0, z0), (sx * 9.0 * (1 - z1 / (H * 3.2)), 0, z1), r0, r1, 10, True, CO)
    for z in (34.0, 74.0):
        bx(mb, 0, 0, 22.0, 4.4, z, z + 3.6, CO)
    bx(mb, 0, 0, 26.0, 5.4, H, H + 2.4, CO)
    for sx in (-1, 1):
        bx(mb, sx * 8.4, 0, 3.2, 4.0, H + 2.4, H + 4.2, STL)
    return obj('BridgeTower', mb, bevel=0.06)


def build_bridge_deck():
    """A twenty-metre section of deck: box girder, roadway, railings, hangers."""
    mb = MB()
    L = 20.0
    bx(mb, 0, 0, 17.0, L, -2.6, -0.4, STL)
    bx(mb, 0, 0, 18.4, L, -0.4, 0.0, CO)
    for sx in (-1, 1):
        bx(mb, sx * 9.0, 0, 0.4, L, 0.0, 1.25, STL)
        for i in range(4):
            bx(mb, sx * 9.0, -L / 2 + (i + 0.5) * L / 4, 0.10, 0.10, 1.25, 1.35, STL)
    # Centre line, in white, so the deck reads as a road from above.
    bx(mb, 0, 0, 0.35, L * 0.6, 0.0, 0.03, WH)
    return obj('BridgeDeck', mb, bevel=0.02)



# ================================================================ life =====
def build_car():
    """A small saloon. Seen from two hundred metres it is a coloured dash on a road;
    what has to be right is the length, the roof line and the glazing band."""
    mb = MB()
    bx(mb, 0, 0, 1.72, 4.20, 0.28, 0.98, WH)
    bx(mb, 0, -0.15, 1.60, 2.30, 0.98, 1.46, WH)
    bx(mb, 0, -0.15, 1.62, 2.10, 1.02, 1.40, GL)
    for (sx, sy) in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        mb.cyl((sx * 0.80, sy * 1.35, 0.31), (sx * 0.70, sy * 1.35, 0.31), 0.31, 0.31, 8, True, DK, up=(0, 1, 0))
    bx(mb, 0, 2.12, 1.40, 0.08, 0.55, 0.80, GL)
    return obj('Car', mb, bevel=0.03)


def build_van():
    mb = MB()
    bx(mb, 0, 0, 2.00, 5.60, 0.34, 2.55, WH)
    bx(mb, 0, -2.30, 1.90, 0.10, 1.45, 2.30, GL)
    for (sx, sy) in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        mb.cyl((sx * 0.94, sy * 1.85, 0.37), (sx * 0.82, sy * 1.85, 0.37), 0.37, 0.37, 8, True, DK, up=(0, 1, 0))
    return obj('Van', mb, bevel=0.03)


def build_lamp():
    """Street lamp: a column, a curved arm, a lantern. The lantern is glass so it
    lights up with everything else at dusk."""
    mb = MB()
    mb.cyl((0, 0, 0), (0, 0, 7.2), 0.13, 0.09, 6, True, DK)
    mb.cyl((0, 0, 7.2), (0, 1.05, 7.55), 0.08, 0.07, 5, True, DK)
    bx(mb, 0, 1.30, 0.34, 0.62, 7.30, 7.55, GL)
    bx(mb, 0, 1.30, 0.40, 0.68, 7.55, 7.66, DK)
    return obj('Lamp', mb, bevel=0.015)


def build_pier():
    """A timber jetty on piles: twenty metres of deck and the piles under it."""
    mb = MB()
    bx(mb, 0, 0, 4.2, 20.0, 1.35, 1.65, WD)
    for i in range(5):
        for sx in (-1, 1):
            mb.cyl((sx * 1.7, -8.0 + i * 4.0, -2.5), (sx * 1.7, -8.0 + i * 4.0, 1.4), 0.20, 0.18, 6, True, WD)
    for i in range(6):
        for sx in (-1, 1):
            mb.cyl((sx * 2.05, -8.5 + i * 3.4, 1.65), (sx * 2.05, -8.5 + i * 3.4, 2.55), 0.07, 0.07, 5, True, WD)
    return obj('Pier', mb, bevel=0.02)


def build_breakwater():
    """A section of rubble mound: two rows of armour blocks on a berm."""
    mb = MB()
    bx(mb, 0, 0, 11.0, 12.0, -3.0, 1.1, ST)
    bx(mb, 0, 0, 6.0, 12.0, 1.1, 2.6, CO)
    for i in range(5):
        for sx in (-1, 1):
            mb.cyl((sx * (3.6 + (i % 2) * 0.7), -5.0 + i * 2.5, 0.4), (sx * (3.6 + (i % 2) * 0.7), -5.0 + i * 2.5, 2.3),
                   1.35, 1.15, 5, True, ST)
    return obj('Breakwater', mb, bevel=0.05)


def build_buoy():
    mb = MB()
    mb.cyl((0, 0, -0.9), (0, 0, 1.15), 0.62, 0.52, 8, True, RU)
    mb.cyl((0, 0, 1.15), (0, 0, 2.35), 0.10, 0.08, 5, True, STL)
    bx(mb, 0, 0, 0.34, 0.34, 2.35, 2.65, RU)
    return obj('Buoy', mb, bevel=0.02)


def build_wreck():
    """A coaster aground and broken in two, rusted through and leaning."""
    mb = MB()
    hull(mb, 54.0, 11.0, 4.4, 2.6, RU, deck_mat=RU)
    # The break: the after part sits lower and canted, so the two halves do not line up.
    bx(mb, 0, -14.0, 10.4, 3.0, 0.6, 3.0, RU)
    bx(mb, 0, -22.0, 9.6, 8.0, 1.6, 8.6, RU)
    for sgn in (-1, 1):
        bx(mb, sgn * 4.9, -22.0, 0.1, 6.0, 4.4, 6.4, DK)
    mb.cyl((0, -24.0, 8.6), (0, -24.0, 12.6), 1.5, 1.35, 10, True, DK)
    # Ribs showing where the plating has gone.
    for i in range(6):
        bx(mb, 0, 4.0 + i * 4.0, 11.2, 0.35, 0.4, 2.8, DK)
    return obj('Wreck', mb, bevel=0.04)


def build_bird():
    """A seabird, as two swept wings and a body. Never seen closer than thirty metres,
    so what matters is the silhouette and that the wings can be flapped by a shader."""
    mb = MB()
    v = [(0.0, 0.34, 0.0), (0.0, -0.30, 0.0), (0.0, 0.05, 0.05),
         (-0.62, 0.16, 0.02), (-0.30, -0.02, 0.03),
         (0.62, 0.16, 0.02), (0.30, -0.02, 0.03)]
    f = [[0, 1, 2], [2, 4, 3], [2, 3, 0], [2, 5, 6], [2, 0, 5]]
    mb.add(v, f, DK)
    return obj('Bird', mb, bevel=0.0)


def build_tunnel_portal():
    """A portal cut into a hillside: a concrete headwall with an arched mouth."""
    mb = MB()
    bx(mb, 0, 0, 13.0, 1.6, 0.0, 8.4, CO)
    rings = []
    for ss in (-0.9, 0.9):
        pts = []
        n = 13
        for i in range(n):
            t = i / (n - 1)
            ang = math.pi * t
            pts.append((-math.cos(ang) * 4.3, 1.2 + math.sin(ang) * 4.3))
        pts = [(4.3, 0.0)] + pts + [(-4.3, 0.0)]
        rings.append([(dx, ss, dz) for (dx, dz) in pts])
    mb._loft_world(rings, True, False, False, DK)
    bx(mb, 0, 0, 15.0, 2.2, 8.4, 9.1, CO)
    return obj('TunnelPortal', mb, bevel=0.03)


BUILT = [
    build_town_a(), build_town_b(), build_town_c(), build_town_d(),
    build_house_a(), build_house_b(), build_villa(), build_farm(),
    build_block_a(), build_block_b(), build_block_c(), build_terrace(),
    build_church(), build_school(), build_shop(),
    build_warehouse(), build_shed(), build_silo(), build_water_tower(),
    build_crane(), build_quay_shed(),
    build_fishing_boat(), build_cargo_ship(), build_skiff(),
    build_lighthouse(), build_bridge_tower(), build_bridge_deck(),
    build_car(), build_van(), build_lamp(), build_pier(), build_breakwater(),
    build_buoy(), build_wreck(), build_tunnel_portal(), build_bird(),
]
x = 0.0
for ob in BUILT:
    ob.location = (x, 0, 0)
    x += 45.0
print('TOWN', sum(len(o.data.polygons) for o in BUILT),
      [(o.name, len(o.data.polygons)) for o in BUILT])
