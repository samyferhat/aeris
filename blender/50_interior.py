import bpy, sys, math, importlib
sys.path.insert(0, '/Users/samy/Documents/dev/code/aeris/blender')
import lib_geo; importlib.reload(lib_geo)
from lib_geo import *
from mathutils import Vector, Matrix, Euler
exec(open('/Users/samy/Documents/dev/code/aeris/blender/10_fuselage.py').read().split('rings = []')[0].split("root = bpy.data.objects['Cessna']")[1].replace("M_BODY = bpy.data.materials['Paint_Body']; M_GLASS = bpy.data.materials['Glass']; M_DARK = bpy.data.materials['Cowl_Dark']", ""))
root = bpy.data.objects['Cessna']; cock = bpy.data.objects['Cockpit']
M_PL = bpy.data.materials['Cockpit_Plastic']; M_CM = bpy.data.materials['Cockpit_Metal_Worn']
M_LE = bpy.data.materials['Leather_Seat']; M_GA = bpy.data.materials['Gauge_Faces']
M_TRIM = get_mat('Cockpit_Trim', (0.42, 0.40, 0.36, 1), 0.85)
M_CARPET = get_mat('Cockpit_Carpet', (0.12, 0.11, 0.10, 1), 0.95)

def place_pivot(ob, loc, rot=(0,0,0)):
    M = Matrix.Translation(Vector(loc)) @ Euler(rot, 'XYZ').to_matrix().to_4x4()
    ob.data.transform(M.inverted()); ob.matrix_world = M; ob.data.update()
def join_into(target, parts):
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts: p.select_set(True)
    target.select_set(True); bpy.context.view_layer.objects.active = target
    bpy.ops.object.join()
def face_toward_y(ob):
    for p in ob.data.polygons:
        if p.normal.y < 0: p.flip()
    ob.data.update()
def box(name, center, size, mat, bevel=0.0):
    cx, cy, cz = center; sx, sy, sz = [s/2 for s in size]
    v = [(cx-sx,cy-sy,cz-sz),(cx+sx,cy-sy,cz-sz),(cx+sx,cy+sy,cz-sz),(cx-sx,cy+sy,cz-sz),(cx-sx,cy-sy,cz+sz),(cx+sx,cy-sy,cz+sz),(cx+sx,cy+sy,cz+sz),(cx-sx,cy+sy,cz+sz)]
    f = [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]
    ob = new_mesh_object(name, v, f, mat)
    if bevel > 0:
        add_bevel(ob, bevel, 3, 30); apply_all_modifiers(ob); shade_smooth_angle(ob, 30)
    return ob
def tube(name, path, radius, mat, n=8):
    pts = [Vector(p) for p in path]; rings = []
    for i, p in enumerate(pts):
        d = (pts[min(i+1, len(pts)-1)] - pts[max(i-1, 0)]).normalized()
        u = Vector((1,0,0)) if abs(d.x) < 0.9 else Vector((0,0,1))
        u = (u - d*u.dot(d)).normalized(); w = d.cross(u)
        rings.append([p + u*radius*math.cos(t) + w*radius*math.sin(t) for t in [2*math.pi*k/n for k in range(n)]])
    v, f = loft(rings, cap_start='ngon', cap_end='ngon')
    ob = new_mesh_object(name, v, f, mat); shade_smooth_angle(ob, 45); return ob
def revolve(name, profile, mat, n=24, origin=(0,0,0), axis='Y'):
    o = Vector(origin); rings = []
    for r, a in profile:
        ring = []
        for k in range(n):
            t = 2*math.pi*k/n
            if axis == 'Y': ring.append(o + Vector((r*math.cos(t), a, r*math.sin(t))))
            elif axis == 'X': ring.append(o + Vector((a, r*math.cos(t), r*math.sin(t))))
            else: ring.append(o + Vector((r*math.cos(t), r*math.sin(t), a)))
        rings.append(ring)
    v, f = loft(rings, cap_start='ngon', cap_end='ngon')
    ob = new_mesh_object(name, v, f, mat); shade_smooth_angle(ob, 40); return ob

# ---------------- Cockpit walls: inner skin from station table (y in [-1.0, 1.95]) offset inward, no windows
inner = []
ys_in = []
for st in ST:
    y = st[0]
    if y < -1.0 - 1e-6 or y > 2.3: continue
    pts = ring_points(st)
    cen = Vector((0, sum(z for x, z in pts)/len(pts)))
    ring = []
    shear = 0.36 if abs(y - 1.55) < 1e-6 else None
    for x, z in pts:
        p = Vector((x, z)); d = (p - cen).normalized()
        q = p - d*0.035
        ring.append(Vector((q.x, shear_y(y, z, shear), q.y)))
    inner.append(ring); ys_in.append(y)
v, f = loft(inner, cap_start='ngon', cap_end='ngon')
walls = new_mesh_object('Cockpit_Walls', v, f, M_TRIM)
# remove window faces & flip normals inward
nloft = (len(inner)-1) * N
del_faces = []
for fi in range(nloft):
    i, j = fi // N, fi % N
    y0, y1 = ys_in[i], ys_in[i+1]
    col = j
    side_win = (5 <= col <= 8) or (27 <= col <= 30); top_win = (col <= 4) or (col >= 31)
    if -1.0 - 1e-6 <= y0 and y1 <= -0.42 + 1e-6 and top_win: del_faces.append(fi)
    if -0.36 - 1e-6 <= y0 and y1 <= 0.62 + 1e-6 and side_win: del_faces.append(fi)
    if 0.70 - 1e-6 <= y0 and y1 <= 1.55 + 1e-6 and side_win: del_faces.append(fi)
import bmesh
bm = bmesh.new(); bm.from_mesh(walls.data); bm.faces.ensure_lookup_table()
bmesh.ops.delete(bm, geom=[bm.faces[i] for i in del_faces], context='FACES_ONLY')
for fc in bm.faces: fc.normal_flip()
bm.to_mesh(walls.data); bm.free(); walls.data.update()
shade_smooth_angle(walls, 40)
walls.data.materials.append(M_PL)
parent_keep(walls, cock)

# ---------------- floor
floor = box('Cockpit_Floor', (0, 0.35, -0.305), (1.0, 2.5, 0.02), M_CARPET)
# baggage shelf / rear deck
shelf = box('_shelf', (0, 1.95, 0.10), (0.8, 0.7, 0.02), M_CARPET)
join_into(floor, [shelf]); parent_keep(floor, cock)

# ---------------- instrument panel
PY = -0.80; TILT = math.radians(8)
panel = box('Panel', (0, PY, 0.33), (1.06, 0.03, 0.45), M_PL, 0.006)
gl_keys = [(PY + 0.015, 0.545), (PY - 0.02, 0.56), (PY - 0.10, 0.565), (PY - 0.16, 0.555), (PY - 0.19, 0.53)]
gl_pts = catmull_rom_open(gl_keys, 8)
rings = [[Vector((x, y, z)) for y, z in gl_pts] + [Vector((x, y, z - 0.02)) for y, z in reversed(gl_pts)] for x in (-0.55, -0.3, 0, 0.3, 0.55)]
v, f = loft(rings, cap_start='ngon', cap_end='ngon')
glare = new_mesh_object('_glare', v, f, M_PL); shade_smooth_angle(glare, 40)
parts = [glare]
# six pack bezels + faces
tiles = {'ASI': (0, 0), 'AI': (1, 0), 'ALT': (2, 0), 'TC': (0, 1), 'HDG': (1, 1), 'VSI': (2, 1)}
layout = [('ASI', -0.40, 0.45), ('AI', -0.30, 0.45), ('ALT', -0.20, 0.45), ('TC', -0.40, 0.35), ('HDG', -0.30, 0.35), ('VSI', -0.20, 0.35)]
def gauge(nm, cx, cz, r=0.042, face_tile=None):
    bez = revolve('_bez_' + nm, [(r*0.8, 0.0), (r*1.12, 0.0), (r*1.15, 0.010), (r*1.05, 0.016), (r*0.8, 0.012)], M_PL, 24, (cx, PY + 0.015, cz), 'Y')
    # face disc with UVs
    n = 24
    verts = [(cx, PY + 0.019, cz)] + [(cx + r*0.85*math.cos(2*math.pi*k/n), PY + 0.019, cz + r*0.85*math.sin(2*math.pi*k/n)) for k in range(n)]
    faces = [(0, 1 + (k+1) % n, 1 + k) for k in range(n)]
    fd = new_mesh_object('_face_' + nm, verts, faces, M_GA if face_tile else M_PL)
    face_toward_y(fd)
    if face_tile:
        me = fd.data; me.uv_layers.new(name='UVMap'); uv = me.uv_layers[0].data
        col, row = face_tile; T = 1/3
        for poly in me.polygons:
            for li in poly.loop_indices:
                p = me.vertices[me.loops[li].vertex_index].co
                u = col*T + T/2 + (p.x - cx) / (r*0.85) * 0.47 * T
                vv = 1 - (row*T + T/2) + (p.z - cz) / (r*0.85) * 0.47 * T
                uv[li].uv = (u, vv)
    return [bez, fd]
for nm, cx, cz in layout:
    parts += gauge(nm, cx, cz, 0.042, tiles[nm])
# right side engine gauges (blank), small
for cx, cz in ((0.32, 0.46), (0.42, 0.46), (0.32, 0.36), (0.42, 0.36)):
    parts += gauge('e%d%d' % (int(cx*100), int(cz*100)), cx, cz, 0.03, None)
# radio stack: 3 boxes with display faces mapped to atlas bottom row
for i in range(3):
    cz = 0.47 - i*0.075
    rb = box('_radio%d' % i, (0.10, PY + 0.03, cz), (0.16, 0.06, 0.065), M_PL, 0.004)
    # display: small quad with UV into radio strip (row 2)
    dx0, dx1 = 0.035, 0.175; dz0, dz1 = cz - 0.02, cz + 0.02
    verts = [(dx0, PY + 0.062, dz0), (dx1, PY + 0.062, dz0), (dx1, PY + 0.062, dz1), (dx0, PY + 0.062, dz1)]
    dq = new_mesh_object('_disp%d' % i, verts, [(0, 1, 2, 3)], M_GA)
    face_toward_y(dq)
    me = dq.data; me.uv_layers.new(name='UVMap'); uv = me.uv_layers[0].data
    T = 1/3; u0 = i*T + 0.08*T; u1 = i*T + 0.92*T; v0 = 1 - (2*T + 0.75*T); v1 = 1 - (2*T + 0.2*T)
    uvs = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
    for li in me.polygons[0].loop_indices: uv[li].uv = uvs[li]
    parts += [rb, dq]
# switches row & knobs
for k in range(8):
    parts.append(box('_sw%d' % k, (-0.46 + k*0.045, PY + 0.02, 0.19), (0.012, 0.02, 0.025), M_CM))
for k in range(4):
    parts.append(revolve('_knob%d' % k, [(0, 0), (0.012, 0), (0.012, 0.025), (0, 0.025)], M_CM, 12, (0.24 + k*0.06, PY + 0.015, 0.20), 'Y'))
# magnetic compass on glareshield
parts.append(box('_compass', (0, PY - 0.05, 0.60), (0.06, 0.06, 0.06), M_PL, 0.008))
# panel lower lip / center pedestal
parts.append(box('_pedestal', (0, PY + 0.10, -0.05), (0.16, 0.24, 0.50), M_PL, 0.01))
join_into(panel, parts)
parent_keep(panel, cock)

# ---------------- yoke (pilot)
YB = Vector((-0.28, PY + 0.02, 0.30))
shaft = tube('Yoke_L', [(-0.28, PY + 0.02, 0.30), (-0.28, PY + 0.30, 0.30)], 0.014, M_CM, 10)
hub = box('_yhub', (-0.28, PY + 0.31, 0.30), (0.09, 0.04, 0.06), M_PL, 0.01)
horns = []
for sgn in (1, -1):
    keys = [(-0.28 + sgn*0.03, PY + 0.31, 0.30), (-0.28 + sgn*0.09, PY + 0.31, 0.31), (-0.28 + sgn*0.15, PY + 0.30, 0.36), (-0.28 + sgn*0.17, PY + 0.28, 0.43), (-0.28 + sgn*0.15, PY + 0.27, 0.49), (-0.28 + sgn*0.11, PY + 0.27, 0.52)]
    path = catmull_rom_open(keys, 12)
    horns.append(tube('_horn%d' % sgn, path, 0.013, M_PL, 10))
join_into(shaft, [hub] + horns)
place_pivot(shaft, YB)
parent_keep(shaft, cock)

# ---------------- seats
def seat(name, x):
    base = box(name, (x, 0.38, -0.06), (0.44, 0.46, 0.11), M_LE, 0.03)
    back = box('_back', (x, 0.66, 0.24), (0.44, 0.09, 0.58), M_LE, 0.03)
    back.rotation_euler = (math.radians(-12), 0, 0)
    back.location = (0, 0, 0)
    M = Matrix.Translation(Vector((x, 0.62, -0.02))) @ Euler((math.radians(-12), 0, 0), 'XYZ').to_matrix().to_4x4() @ Matrix.Translation(Vector((-x, -0.62, 0.02)))
    back.data.transform(M); back.rotation_euler = (0,0,0)
    frame = []
    for sx in (-0.18, 0.18):
        frame.append(tube('_leg%s%d' % (name, int(sx*100)), [(x+sx, 0.20, -0.29), (x+sx, 0.20, -0.12), (x+sx, 0.56, -0.12), (x+sx, 0.56, -0.29)], 0.012, M_CM, 8))
    join_into(base, [back] + frame)
    place_pivot(base, (x, 0.38, -0.29))
    parent_keep(base, cock)
    return base
seat('Seat_L', -0.28); seat('Seat_R', 0.28)

# ---------------- rudder pedals (pilot + copilot)
peds = []
for x in (-0.36, -0.20, 0.20, 0.36):
    peds.append(box('_ped%d' % int(x*100), (x, -0.62, -0.14), (0.07, 0.015, 0.11), M_CM, 0.003))
    peds.append(tube('_parm%d' % int(x*100), [(x, -0.62, -0.19), (x, -0.55, -0.29)], 0.008, M_CM, 8))
pedals = peds[0]; join_into(pedals, peds[1:]); pedals.name = 'Rudder_Pedals'; pedals.data.name = 'Rudder_Pedals'
place_pivot(pedals, (0, -0.60, -0.29)); parent_keep(pedals, cock)

# ---------------- throttle (push-pull knob)
thr = tube('Throttle', [(0.05, PY + 0.015, 0.23), (0.05, PY + 0.09, 0.23)], 0.007, M_CM, 10)
knob = revolve('_tknob', [(0, 0), (0.018, 0), (0.02, 0.02), (0.017, 0.035), (0, 0.04)], M_PL, 14, (0.05, PY + 0.09, 0.23), 'Y')
join_into(thr, [knob])
place_pivot(thr, (0.05, PY + 0.015, 0.23)); parent_keep(thr, cock)
print('interior done')
