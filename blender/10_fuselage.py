import bpy, sys, math, importlib, bmesh
sys.path.insert(0, '/Users/samy/Documents/dev/code/aeris/blender')
import lib_geo; importlib.reload(lib_geo)
from lib_geo import *
from mathutils import Vector

root = bpy.data.objects['Cessna']
M_BODY = bpy.data.materials['Paint_Body']; M_GLASS = bpy.data.materials['Glass']; M_DARK = bpy.data.materials['Cowl_Dark']

# station table: y -> (ztop, P1, P2, P3, P4, P5, zbot, shear)
# P1 roof shoulder, P2 window top / upper side, P3 sill (max width), P4 lower side, P5 bottom corner
ST = [
 (-2.38, 0.40, (0.16,0.39), (0.26,0.33), (0.30,0.18), (0.29,0.00), (0.20,-0.08), -0.11),
 (-2.30, 0.44, (0.22,0.43), (0.34,0.37), (0.39,0.18), (0.38,-0.05), (0.28,-0.17), -0.21),
 (-2.10, 0.48, (0.26,0.47), (0.40,0.40), (0.45,0.18), (0.44,-0.09), (0.33,-0.24), -0.28),
 (-1.70, 0.53, (0.30,0.52), (0.47,0.45), (0.52,0.22), (0.52,-0.09), (0.40,-0.29), -0.35),
 (-1.30, 0.55, (0.30,0.54), (0.49,0.48), (0.54,0.26), (0.54,-0.07), (0.43,-0.31), -0.36),
 (-1.06, 0.56, (0.30,0.55), (0.50,0.50), (0.55,0.28), (0.55,-0.06), (0.44,-0.31), -0.36),
 (-1.00, 0.56, (0.30,0.55), (0.50,0.50), (0.55,0.28), (0.55,-0.06), (0.44,-0.31), -0.36),  # windshield base
 (-0.72, 0.79, (0.33,0.77), (0.52,0.68), (0.56,0.29), (0.55,-0.06), (0.45,-0.31), -0.36),
 (-0.42, 1.00, (0.35,0.98), (0.53,0.85), (0.57,0.30), (0.56,-0.07), (0.46,-0.31), -0.36),  # windshield top / door post
 (-0.36, 1.00, (0.35,0.98), (0.535,0.85), (0.57,0.30), (0.56,-0.07), (0.46,-0.31), -0.36),  # door window start
 ( 0.15, 1.00, (0.36,0.98), (0.54,0.85), (0.575,0.30), (0.56,-0.08), (0.46,-0.31), -0.36),
 ( 0.62, 1.00, (0.36,0.98), (0.54,0.85), (0.575,0.30), (0.56,-0.08), (0.46,-0.31), -0.36),  # door window end
 ( 0.70, 1.00, (0.36,0.98), (0.54,0.85), (0.57,0.30), (0.56,-0.08), (0.46,-0.30), -0.35),   # rear window start
 ( 1.10, 0.99, (0.35,0.97), (0.52,0.84), (0.55,0.30), (0.53,-0.06), (0.43,-0.28), -0.33),
 ( 1.55, 0.95, (0.31,0.93), (0.47,0.80), (0.49,0.31), (0.46,-0.02), (0.36,-0.23), -0.29),   # rear window end (sheared)
 ( 2.20, 0.83, (0.23,0.80), (0.34,0.67), (0.37,0.32), (0.34,0.07), (0.25,-0.11), -0.18),
 ( 3.00, 0.69, (0.16,0.66), (0.25,0.56), (0.28,0.33), (0.25,0.14), (0.17,0.02), -0.04),
 ( 3.80, 0.59, (0.11,0.57), (0.18,0.50), (0.20,0.35), (0.18,0.21), (0.12,0.12),  0.08),
 ( 4.60, 0.54, (0.08,0.53), (0.13,0.47), (0.145,0.36), (0.13,0.25), (0.09,0.19), 0.16),
 ( 5.40, 0.52, (0.06,0.51), (0.095,0.46), (0.105,0.36), (0.095,0.27), (0.065,0.22), 0.19),
 ( 5.90, 0.50, (0.04,0.49), (0.06,0.45), (0.065,0.36), (0.06,0.28), (0.04,0.24), 0.22),
]
COUNTS = [3, 2, 4, 3, 3, 3]   # samples per key segment (right half); P indices: P0=0,P1=3,P2=5,P3=9,P4=12,P5=15,P6=18
IDX = {'P0':0,'P1':3,'P2':5,'P3':9,'P4':12,'P5':15,'P6':18}
NH = sum(COUNTS)  # 18
N = 2 * NH        # 36 verts per ring

def ring_points(st):
    ztop, p1, p2, p3, p4, p5, zbot = st[1:8]
    keys = [(0, ztop), p1, p2, p3, p4, p5, (0, zbot), (-p5[0], p5[1]), (-p4[0], p4[1]), (-p3[0], p3[1]), (-p2[0], p2[1]), (-p1[0], p1[1])]
    counts = COUNTS + list(reversed(COUNTS))
    return catmull_rom_closed(keys, counts)   # 36 points, index 0 = top center, 18 = bottom center

def shear_y(y, z, shear):
    if shear is None: return y
    return y - shear * max(0.0, min(z - 0.30, 0.55))

rings = []
ys = []
for st in ST:
    y = st[0]
    shear = 0.36 if abs(y - 1.55) < 1e-6 else None
    pts = ring_points(st)
    rings.append([Vector((x, shear_y(y, z, shear), z)) for x, z in pts])
    ys.append(y)

verts, faces = loft(rings, cap_start=Vector((0, -2.41, 0.17)), cap_end=Vector((0, 5.93, 0.36)))
ob = new_mesh_object('Fuselage', verts, faces, M_BODY)
ob.data.materials.append(M_GLASS)
ob.data.materials.append(M_DARK)

# --- assign glass material to window faces (base grid, pre-subdivision)
def face_ring_row(fi):
    """face index -> (ring i, column j) for loft faces."""
    return fi // N, fi % N
def is_glass(i, j):
    y0 = ys[i]; y1 = ys[i+1]
    col = j % N
    # rows: right side vertex rows P2..P3 are columns 5..8 (face j between vertex j and j+1); left mirrored columns 27..30
    side_win = (5 <= col <= 8) or (27 <= col <= 30)
    top_win = (col <= 4) or (col >= 31)
    if -1.0 - 1e-6 <= y0 and y1 <= -0.42 + 1e-6:
        return top_win or (col in (5,30) and False)
    if -0.36 - 1e-6 <= y0 and y1 <= 0.62 + 1e-6:
        return side_win
    if 0.70 - 1e-6 <= y0 and y1 <= 1.55 + 1e-6:
        return side_win
    return False
nloft = (len(ST) - 1) * N
for fi in range(nloft):
    i, j = face_ring_row(fi)
    if is_glass(i, j):
        ob.data.polygons[fi].material_index = 1

# --- mark crease-like sharp features? (keep smooth) ; subdivide
shade_smooth_angle(ob, 40)
md = add_subsurf(ob, 2)
apply_all_modifiers(ob)

# --- separate glass faces into Canopy_Glass
bpy.ops.object.select_all(action='DESELECT')
ob.select_set(True); bpy.context.view_layer.objects.active = ob
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='DESELECT')
bpy.context.object.active_material_index = 1
bpy.ops.object.material_slot_select()
bpy.ops.mesh.separate(type='SELECTED')
bpy.ops.object.mode_set(mode='OBJECT')
glass = [o for o in bpy.context.selected_objects if o != ob][0]
clear_object('Canopy_Glass')
glass.name = 'Canopy_Glass'; glass.data.name = 'Canopy_Glass'
# cleanup material slots
for o in (ob, glass):
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.material_slot_remove_unused()
# glass: keep only Glass material
glass.data.materials.clear(); glass.data.materials.append(M_GLASS)
shade_smooth_angle(glass, 60)

for o in (ob, glass):
    parent_keep(o, root)

nf = len(ob.data.polygons); ng = len(glass.data.polygons)
print('fuselage faces', nf, 'glass faces', ng)
