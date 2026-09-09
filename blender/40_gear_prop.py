import bpy, sys, math, importlib
sys.path.insert(0, '/Users/samy/Documents/dev/code/aeris/blender')
import lib_geo; importlib.reload(lib_geo)
from lib_geo import *
from mathutils import Vector, Matrix, Euler
root = bpy.data.objects['Cessna']
M_BODY = bpy.data.materials['Paint_Body']; M_METAL = bpy.data.materials['Metal_Worn']
M_TIRE = bpy.data.materials['Rubber_Tire']; M_BLADE = bpy.data.materials['Prop_Blade']
M_TIP = get_mat('Prop_Tip', (0.95, 0.75, 0.05, 1), 0.45); M_DARK = bpy.data.materials['Cowl_Dark']
M_BLUR = bpy.data.materials['PropBlur']

def place_pivot(ob, loc, rot=(0,0,0)):
    M = Matrix.Translation(Vector(loc)) @ Euler(rot, 'XYZ').to_matrix().to_4x4()
    ob.data.transform(M.inverted()); ob.matrix_world = M; ob.data.update()

def join_into(target, parts):
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts: p.select_set(True)
    target.select_set(True); bpy.context.view_layer.objects.active = target
    bpy.ops.object.join()

def tube(name, path, radius, mat, n=10, rad_fn=None, cap=True):
    pts = [Vector(p) for p in path]
    rings = []
    for i, p in enumerate(pts):
        d = (pts[min(i+1, len(pts)-1)] - pts[max(i-1, 0)]).normalized()
        u = Vector((1,0,0)) if abs(d.x) < 0.9 else Vector((0,0,1))
        u = (u - d*u.dot(d)).normalized(); w = d.cross(u)
        r = radius if rad_fn is None else rad_fn(i, len(pts))
        rings.append([p + u*r*math.cos(t) + w*r*math.sin(t) for t in [2*math.pi*k/n for k in range(n)]])
    v, f = loft(rings, cap_start='ngon' if cap else None, cap_end='ngon' if cap else None)
    ob = new_mesh_object(name, v, f, mat); shade_smooth_angle(ob, 45); return ob

def revolve(name, profile, mat, n=32, axis_origin=(0,0,0), axis='Y', cap=True):
    """profile: list of (r, a) with a along axis. Revolve around axis through origin."""
    o = Vector(axis_origin)
    rings = []
    for r, a in profile:
        ring = []
        for k in range(n):
            t = 2*math.pi*k/n
            if axis == 'Y': ring.append(o + Vector((r*math.cos(t), a, r*math.sin(t))))
            elif axis == 'X': ring.append(o + Vector((a, r*math.cos(t), r*math.sin(t))))
            else: ring.append(o + Vector((r*math.cos(t), r*math.sin(t), a)))
        rings.append(ring)
    v, f = loft(rings, cap_start='ngon' if cap else None, cap_end='ngon' if cap else None)
    ob = new_mesh_object(name, v, f, mat); shade_smooth_angle(ob, 40); return ob

# ================= WHEELS
def make_wheel(name, axle, R, width, pant_len, pant_h, parent):
    ax = Vector(axle)
    rt = width/2  # tire half width
    # tire: superellipse cross section revolve around X
    prof = []
    n = 14
    for k in range(n+1):
        t = -math.pi/2 + math.pi*k/n
        # (r, a): r radial from axle, a along X
        rr = R - rt*0.75 + rt*0.75*abs(math.cos(t))**(2/3.0) * (1 if True else 1)
        rr = (R - rt) + rt * abs(math.cos(t))**(0.6)
        prof.append((rr, rt*math.sin(t)*abs(math.sin(t))**(0.4) if abs(math.sin(t))>1e-9 else 0.0))
    prof = [(R - rt*0.7, -rt*0.95)] + prof + [(R - rt*0.7, rt*0.95)]
    rings = []
    for r, a in prof:
        rings.append([ax + Vector((a, r*math.cos(t), r*math.sin(t))) for t in [2*math.pi*k/36 for k in range(36)]])
    rings.append(rings[0])
    v, f = loft(rings)
    tire = new_mesh_object(name, v, f, M_TIRE); shade_smooth_angle(tire, 40)
    # rim + hub (metal)
    rim = revolve('_rim', [(0.0, -rt*0.9), (R - rt*0.75, -rt*0.9), (R - rt*0.65, -rt*0.6), (R - rt*0.65, rt*0.6), (R - rt*0.75, rt*0.9), (0.0, rt*0.9)], M_METAL, 24, ax, 'X')
    hub = revolve('_hub', [(0.0, -rt*1.15), (0.035*R/0.22, -rt*1.15), (0.045*R/0.22, -rt*0.9), (0.0, -rt*0.9)], M_METAL, 16, ax, 'X')
    join_into(tire, [rim, hub])
    # UVs for tire: u = angle around axle, v = across tread (needed for tread normal map)
    me = tire.data
    if not me.uv_layers: me.uv_layers.new(name='UVMap')
    uv = me.uv_layers[0].data
    for poly in me.polygons:
        for li in poly.loop_indices:
            p = me.vertices[me.loops[li].vertex_index].co - ax
            ang = math.atan2(p.z, p.y)
            # handle wrap: use polygon center angle to avoid seams
            pc = poly.center - ax; angc = math.atan2(pc.z, pc.y)
            if ang - angc > math.pi: ang -= 2*math.pi
            if angc - ang > math.pi: ang += 2*math.pi
            u = ang / (2*math.pi) * 6.0   # tile 6 times around
            vv = (p.x / width + 0.5)
            uv[li].uv = (u, vv)
    place_pivot(tire, ax)
    parent_keep(tire, parent)
    return tire

def make_pant(name, axle, R, length_f, length_r, height, width, mat):
    """wheel pant loft along Y (open bottom). Returns object (world coords)."""
    ax = Vector(axle)
    rings = []
    Ts = [-length_f, -length_f+0.03, -length_f+0.10, -length_f+0.22, 0.0, 0.15, length_r*0.6, length_r]
    for t in Ts:
        # width & top height along length
        ft = (t + length_f) / (length_f + length_r)
        w = width/2 * math.sin(math.pi * min(1.0, 0.08 + 0.92*ft))**0.5 * (1.0 - 0.35*ft)
        w = max(w, 0.015)
        ztop = ax.z + height * (0.55 + 0.45*math.sin(math.pi*min(1, (ft*1.15)))**0.8) * (1.0 - 0.15*ft)
        zbot = ax.z - 0.03 + 0.12 * max(0, (0.45 - ft)/0.45)**2 + 0.16 * max(0, (ft - 0.55)/0.45)**1.5
        zmid = (ztop + zbot) * 0.5
        keys = [(w*0.92, zbot), (w, zmid), (w*0.85, ztop - 0.07*height), (0, ztop), (-w*0.85, ztop - 0.07*height), (-w, zmid), (-w*0.92, zbot)]
        pts = catmull_rom_open(keys, 18)
        rings.append([Vector((ax.x + x, ax.y + t, z)) for x, z in pts])
    v, f = loft(rings, close=False)
    ob = new_mesh_object(name, v, f, mat); shade_smooth_angle(ob, 40); return ob

# ================= MAIN GEAR
def make_main_gear(sign):
    root_p = Vector((sign*0.30, 0.45, -0.30)); axle = Vector((sign*1.25, 0.55, -0.68))
    keys = [(0.30, 0.45, -0.30), (0.62, 0.48, -0.39), (0.95, 0.52, -0.52), (1.16, 0.55, -0.63), (1.25, 0.55, -0.68)]
    path = catmull_rom_open([(sign*x, y, z) for x, y, z in keys], 9)
    # leg fairing: ellipse chord 0.15 (Y) x 0.045 (thickness), aligned with tangent
    pts = [Vector(p) for p in path]
    rings = []
    for i, p in enumerate(pts):
        d = (pts[min(i+1, len(pts)-1)] - pts[max(i-1, 0)]).normalized()
        u = Vector((0,1,0)); u = (u - d*u.dot(d)).normalized(); w = d.cross(u)
        fade = 1.0 if i < len(pts)-2 else 0.7
        rings.append([p + u*0.075*fade*math.cos(t) + w*0.022*fade*math.sin(t) for t in [2*math.pi*k/14 for k in range(14)]])
    rings[0] = [q + Vector((-sign*0.12, 0, 0.03)) for q in rings[0]]
    v, f = loft(rings, cap_start='ngon', cap_end='ngon')
    leg = new_mesh_object('Gear_%s' % ('L' if sign > 0 else 'R'), v, f, M_BODY); shade_smooth_angle(leg, 40)
    pant = make_pant('_pant', axle, 0.22, 0.34, 0.46, 0.32, 0.24, M_BODY)
    # axle stub
    stub = revolve('_stub', [(0, -sign*0.16), (0.03, -sign*0.16), (0.03, sign*0.02), (0, sign*0.02)], M_METAL, 12, axle, 'X')
    join_into(leg, [pant, stub])
    place_pivot(leg, root_p)
    parent_keep(leg, root)
    wheel = make_wheel('Wheel_%s' % ('L' if sign > 0 else 'R'), axle, 0.22, 0.16, 0.34, 0.32, leg)
    return leg
make_main_gear(1); make_main_gear(-1)

# ================= NOSE GEAR
top = Vector((0, -1.22, -0.30)); axle = Vector((0, -1.25, -0.72))
strut_fair = tube('Gear_Nose', [(0, -1.22, -0.29), (0, -1.23, -0.40), (0, -1.24, -0.52)], 0.05, M_BODY, 12)
# make fairing streamlined: scale x by 0.6 relative to strut axis (done crudely by mesh scale about pivot)
for vtx in strut_fair.data.vertices: vtx.co.x *= 0.6; vtx.co.y = -1.23 + (vtx.co.y + 1.23) * 1.6
piston = tube('_piston', [(0, -1.24, -0.50), (0, -1.25, -0.66)], 0.022, M_METAL, 12)
fork_l = tube('_forkl', [(-0.02, -1.25, -0.64), (-0.075, -1.25, -0.72)], 0.014, M_METAL, 8)
fork_r = tube('_forkr', [(0.02, -1.25, -0.64), (0.075, -1.25, -0.72)], 0.014, M_METAL, 8)
naxle = revolve('_naxle', [(0, -0.09), (0.02, -0.09), (0.02, 0.09), (0, 0.09)], M_METAL, 10, axle, 'X')
npant = make_pant('_npant', axle, 0.18, 0.30, 0.40, 0.29, 0.20, M_BODY)
# scissor link (torque link): two small bars
sc1 = tube('_sc1', [(0, -1.17, -0.42), (0, -1.16, -0.53)], 0.012, M_METAL, 8)
sc2 = tube('_sc2', [(0, -1.16, -0.53), (0, -1.21, -0.62)], 0.012, M_METAL, 8)
join_into(strut_fair, [piston, fork_l, fork_r, naxle, npant, sc1, sc2])
place_pivot(strut_fair, top)
parent_keep(strut_fair, root)
make_wheel('Wheel_Nose', axle, 0.18, 0.13, 0.30, 0.29, strut_fair)

# ================= PROPELLER
HUB = Vector((0, -2.45, 0.19))
# spinner (ogive)
prof = []
for k in range(11):
    t = k / 10.0
    r = 0.17 * math.sin(t * math.pi / 2) ** 0.75
    prof.append((r, -0.30 + 0.30 * t))
prof.append((0.175, 0.01)); prof.append((0.175, 0.03)); prof.append((0.0, 0.03))
spinner = revolve('Propeller', prof, M_METAL, 32, HUB, 'Y')

def blade_rings(sign):
    rings = []
    stations = [(0.08, 0.06, 1.0), (0.13, 0.075, 1.0), (0.20, 0.11, 0.9), (0.30, 0.15, 0.55), (0.45, 0.155, 0.32), (0.60, 0.145, 0.22), (0.75, 0.13, 0.15), (0.86, 0.11, 0.12), (0.92, 0.08, 0.10), (0.95, 0.04, 0.08)]
    PITCH = 1.45
    for r, chord, thick_scale in stations:
        beta = math.atan(PITCH / (2 * math.pi * r))
        if r < 0.15: beta = math.radians(55)
        sec = wing_section(1.0, 0.7, 'full', '4412', n_main=10, n_aft=4)
        ring = []
        for c, t in sec:
            x = (c - 0.35) * chord; y = -t * chord * (thick_scale if thick_scale > 0.3 else 1.0)
            # round shank: blend toward circle for r < 0.15
            if r < 0.16:
                ang = math.atan2(y, x); rr = chord * 0.45
                bl = (0.16 - r) / 0.08
                x = x * (1 - bl) + rr * math.cos(ang) * bl; y = y * (1 - bl) + rr * math.sin(ang) * bl
            xp = x * math.cos(beta) + y * math.sin(beta); yp = -x * math.sin(beta) + y * math.cos(beta)
            if sign > 0: xp = -xp
            ring.append(HUB + Vector((xp, yp, sign * r)))
        rings.append(ring)
    return rings
for sgn, nm in ((1, '_bladeU'), (-1, '_bladeD')):
    rings = blade_rings(sgn)
    tipc = HUB + Vector((0, 0, sgn * 0.955))
    v, f = loft(rings, cap_start='ngon', cap_end=tipc)
    if sgn > 0:
        f = [tuple(reversed(fc)) for fc in f]
    b = new_mesh_object(nm, v, f, M_BLADE); b.data.materials.append(M_TIP)
    for p in b.data.polygons:
        if abs(p.center.z - HUB.z) > 0.84: p.material_index = 1
    shade_smooth_angle(b, 50)
    join_into(spinner, [b])
place_pivot(spinner, HUB)
parent_keep(spinner, root)

# prop disc
n = 48
verts = [HUB + Vector((0.95*math.cos(2*math.pi*k/n), 0, 0.95*math.sin(2*math.pi*k/n))) for k in range(n)]
faces = [tuple(range(n))]
disc = new_mesh_object('Prop_Disc', verts, faces, M_BLUR)
disc.data.polygons[0].use_smooth = True
place_pivot(disc, HUB)
parent_keep(disc, root)

# ================= exhaust + cowl intakes + lights (joined into Fuselage)
fus = bpy.data.objects['Fuselage']
exh = tube('_exh', [(-0.14, -1.75, -0.22), (-0.16, -1.62, -0.34), (-0.19, -1.50, -0.40), (-0.21, -1.40, -0.41)], 0.028, M_METAL, 12, cap=True)
exh2 = tube('_exh2', [(-0.19, -1.50, -0.40), (-0.21, -1.40, -0.41)], 0.021, M_DARK, 12, cap=True)
parts = [exh, exh2]
for sign in (1, -1):
    cx, cz = sign*0.20, 0.22
    keys = [(0.085, -0.05), (0.085, 0.05), (0.0, 0.065), (-0.085, 0.05), (-0.085, -0.05), (0.0, -0.065)]
    pts = catmull_rom_closed(keys, [3,3,3,3,3,3])
    def ring(y, s):
        return [Vector((cx + x*s, y, cz + z*s)) for x, z in pts]
    v, f = loft([ring(-2.47, 1.0), ring(-2.50, 0.93), ring(-2.48, 0.86), ring(-2.20, 0.80)], cap_end='ngon')
    it = new_mesh_object('_intake%d' % sign, v, f, M_BODY); it.data.materials.append(M_DARK)
    for p in it.data.polygons:
        if p.center.y > -2.47: p.material_index = 1
    shade_smooth_angle(it, 40); parts.append(it)
# landing light in cowl (left of spinner, below): recessed lens
ll = revolve('_ll', [(0.0, -0.04), (0.06, -0.04), (0.065, 0.0), (0.0, 0.0)], get_mat('Lens', (0.9,0.9,0.9,1), 0.1, 0.8), 16, (-0.0, -2.42, -0.02), 'Y')
parts.append(ll)
# beacon on fin, strobe at tail
M_RED = get_mat('Light_Red', (0.9, 0.05, 0.05, 1), 0.2); M_GRN = get_mat('Light_Green', (0.05, 0.9, 0.2, 1), 0.2); M_WHT = get_mat('Light_White', (1,1,1,1), 0.2)
for m, col in ((M_RED, (1, 0.05, 0.05)), (M_GRN, (0.05, 1, 0.2)), (M_WHT, (1,1,1))):
    b = m.node_tree.nodes['Principled BSDF']; b.inputs['Emission Color'].default_value = (*col, 1); b.inputs['Emission Strength'].default_value = 2.0
beacon = revolve('_beacon', [(0, 0), (0.03, 0), (0.028, 0.02), (0.018, 0.035), (0, 0.04)], M_RED, 12, (0, 5.32, 1.83), 'Z')
strobe = revolve('_strobe', [(0, 0), (0.02, 0), (0.018, 0.02), (0, 0.03)], M_WHT, 10, (0, 5.93, 0.36), 'Y')
parts += [beacon, strobe]
join_into(fus, parts + [bpy.data.objects[n] for n in ('_Stab', '_Fin', '_Fillet', '_StrutR', '_StrutL', '_Tie')])
# nav lights joined into wings
wings = bpy.data.objects['Wings']
navL = revolve('_navL', [(0, 0), (0.025, 0), (0.022, 0.02), (0, 0.03)], M_RED, 10, (5.50, 0.06, 1.15), 'X')
navR = revolve('_navR', [(0, 0), (0.025, 0), (0.022, 0.02), (0, 0.03)], M_GRN, 10, (-5.50, 0.06, 1.15), 'X')
for vtx in navR.data.vertices: vtx.co.x = -5.50 - (vtx.co.x + 5.50)
for p in navR.data.polygons: p.flip()
join_into(wings, [navL, navR])
print('gear/prop done')
