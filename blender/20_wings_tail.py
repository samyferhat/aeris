import bpy, sys, math, importlib
sys.path.insert(0, '/Users/samy/Documents/dev/code/aeris/blender')
import lib_geo; importlib.reload(lib_geo)
from lib_geo import *
from mathutils import Vector, Matrix, Euler

root = bpy.data.objects['Cessna']
M_BODY = bpy.data.materials['Paint_Body']; M_METAL = bpy.data.materials['Metal_Worn']

DIHED = math.radians(1.73); TAN_D = math.tan(DIHED)
INC = math.radians(1.5)
LE_Y = -0.41; ROOT_C = 1.63; TIP_C = 1.13; TAPER_X = 2.9; TIP_X = 5.4
Z_ROOT = 1.0
FLAP_CUT = 0.72; AIL_CUT = 0.75

def chord_at(x):
    ax = abs(x)
    if ax <= TAPER_X: return ROOT_C
    return ROOT_C + (TIP_C - ROOT_C) * min(1.0, (ax - TAPER_X) / (TIP_X - TAPER_X))
def wing_z(x): return Z_ROOT + abs(x) * TAN_D

def rot_sec(sec, ang, pivot):
    c, s = math.cos(ang), math.sin(ang)
    out = []
    for a, b in sec:
        a -= pivot[0]; b -= pivot[1]
        out.append((a*c - b*s + pivot[0], a*s + b*c + pivot[1]))
    return out

def place_pivot(ob, loc, rot):
    """ob mesh currently in world coords; set pivot at loc with rotation (Euler XYZ radians)."""
    M = Matrix.Translation(Vector(loc)) @ Euler(rot, 'XYZ').to_matrix().to_4x4()
    ob.data.transform(M.inverted())
    ob.matrix_world = M
    ob.data.update()

def wing_ring(x, mode, cut, scale=1.0, tscale=1.0, cshift=0.0):
    c = chord_at(x) * scale
    sec = wing_section(1.0, cut, mode, '2412', n_main=22, n_aft=6)
    sec = [(a*c + cshift, b*c*tscale) for a, b in sec]
    sec = rot_sec(sec, -INC, (0.25*c, 0))   # nose up: rotate so that TE goes down => negative angle in (c,t) plane
    return [Vector((x, LE_Y + a, wing_z(x) + b)) for a, b in sec]

def build_wing_side(sign):
    """returns rings from center to tip (x*sign)."""
    S = []
    def add(x, mode, cut, scale=1.0, tscale=1.0, cshift=0.0):
        S.append(wing_ring(sign*x, mode, cut, scale, tscale, cshift))
    add(0.0, 'full', FLAP_CUT)
    add(0.60, 'full', FLAP_CUT)
    add(0.615, 'cut', FLAP_CUT)
    add(1.8, 'cut', FLAP_CUT)
    add(2.955, 'cut', FLAP_CUT)
    add(2.97, 'full', FLAP_CUT)
    add(3.035, 'full', AIL_CUT)
    add(3.05, 'cut', AIL_CUT)
    add(4.2, 'cut', AIL_CUT)
    add(5.345, 'cut', AIL_CUT)
    add(5.36, 'full', AIL_CUT)
    add(5.40, 'full', AIL_CUT)
    add(5.45, 'full', AIL_CUT, 0.92, 0.85, 0.03)
    add(5.49, 'full', AIL_CUT, 0.72, 0.6, 0.12)
    add(5.51, 'full', AIL_CUT, 0.40, 0.3, 0.30)
    return S

# ---- Wings (one mesh)
R = build_wing_side(1.0); L = build_wing_side(-1.0)
rings = list(reversed(L)) + R[1:]
tipR = Vector((5.52, LE_Y + 0.45*chord_at(5.52), wing_z(5.52)))
tipL = Vector((-5.52, LE_Y + 0.45*chord_at(5.52), wing_z(5.52)))
v, f = loft(rings, cap_start=tipL, cap_end=tipR)
wings = new_mesh_object('Wings', v, f, M_BODY)
shade_smooth_angle(wings, 50)
parent_keep(wings, root)

# ---- control surfaces on the wing
def build_ctrl(name, x0, x1, cut, sign, ncs=6):
    """x0..x1 positive spans; sign for side. Hinge at cut fraction. Returns object with pivot at inboard hinge end."""
    xs = [x0 + (x1 - x0) * i / (ncs - 1) for i in range(ncs)]
    rings = []
    for x in xs:
        c = chord_at(x)
        sec = control_section(1.0, cut, '2412', n_surf=12, n_nose=8)
        # hinge point in (c,t): (cut, camber) -> section already relative to hinge
        secw = [(a*c + cut*c, b*c) for a, b in sec]
        # add camber offset at hinge: control_section removed yc; wing_section keeps it -> recompute camber at cut
        up, lo = naca4('2412', 60)
        yc, th = lib_geo._camber_thickness_at(up, lo, cut)
        secw = [(a, b + yc*c) for a, b in secw]
        secw = rot_sec(secw, -INC, (0.25*c, 0))
        rings.append([Vector((sign*x, LE_Y + a, wing_z(x) + b)) for a, b in secw])
    if sign < 0: rings = list(reversed(rings))
    v, f = loft(rings, cap_start='ngon', cap_end='ngon')
    ob = new_mesh_object(name, v, f, M_BODY)
    # hinge root/tip world positions
    def hinge_pt(x):
        c = chord_at(x); up, lo = naca4('2412', 60); yc, th = lib_geo._camber_thickness_at(up, lo, cut)
        a, b = rot_sec([(cut*c, yc*c)], -INC, (0.25*c, 0))[0]
        return Vector((sign*x, LE_Y + a, wing_z(x) + b))
    # pivot: inboard hinge end, local X along hinge pointing toward +X world
    if sign > 0: p_in, p_out = hinge_pt(x0), hinge_pt(x1)
    else: p_in, p_out = hinge_pt(x1), hinge_pt(x0)   # left: inboard end is x0 but local +X toward +X world means start at outboard? keep pivot at inboard end
    # local X axis = direction toward +X world along hinge
    d = (hinge_pt(x1) - hinge_pt(x0)) * sign  # pointing outward for right, inward for left => pointing +X world both cases
    d.normalize()
    yaw = math.atan2(d.y, d.x)
    pitch = -math.asin(max(-1, min(1, d.z)))
    pivot = hinge_pt(x0) if sign > 0 else hinge_pt(x0)  # inboard end for both
    place_pivot(ob, pivot, (0.0, pitch, yaw))
    shade_smooth_angle(ob, 45)
    parent_keep(ob, root)
    return ob

flapL = build_ctrl('Flap_L', 0.625, 2.945, FLAP_CUT, 1, 4)
flapR = build_ctrl('Flap_R', 0.625, 2.945, FLAP_CUT, -1, 4)
ailL = build_ctrl('Aileron_L', 3.06, 5.335, AIL_CUT, 1, 6)
ailR = build_ctrl('Aileron_R', 3.06, 5.335, AIL_CUT, -1, 6)

# ---- Horizontal stabiliser + elevator
STAB_Z = 0.34; STAB_HINGE_Y = 5.50; STAB_CUT = 0.62
def stab_chord(x):
    ax = abs(x); return 1.05 + (0.72 - 1.05) * min(1.0, ax / 1.70)
def stab_ring(x, mode, scale=1.0, tscale=1.0, cshift=0.0):
    c = stab_chord(x) * scale
    le = STAB_HINGE_Y - STAB_CUT * stab_chord(x)
    sec = wing_section(1.0, STAB_CUT, mode, '0010', n_main=16, n_aft=6)
    return [Vector((x, le + a*c + cshift, STAB_Z + b*c*tscale)) for a, b in sec]
rings = []
for x in (-1.72, -1.705, -1.70, -1.66, -1.0, -0.15, 0.15, 1.0, 1.66, 1.70, 1.705, 1.72):
    ax = abs(x)
    if ax > 1.71: rings.append(stab_ring(x, 'full', 0.45, 0.35, 0.28))
    elif ax > 1.702: rings.append(stab_ring(x, 'full', 0.8, 0.7, 0.10))
    elif ax > 1.69: rings.append(stab_ring(x, 'full'))
    else: rings.append(stab_ring(x, 'cut'))
v, f = loft(rings, cap_start=Vector((-1.73, STAB_HINGE_Y - 0.2, STAB_Z)), cap_end=Vector((1.73, STAB_HINGE_Y - 0.2, STAB_Z)))
stab = new_mesh_object('_Stab', v, f, M_BODY)
shade_smooth_angle(stab, 50)

rings = []
for x in (-1.68, -0.9, -0.12, 0.12, 0.9, 1.68):
    c = stab_chord(x)
    sec = control_section(1.0, STAB_CUT, '0010', n_surf=10, n_nose=8)
    rings.append([Vector((x, STAB_HINGE_Y + a*c, STAB_Z + b*c)) for a, b in sec])
v, f = loft(rings, cap_start='ngon', cap_end='ngon')
elev = new_mesh_object('Elevator', v, f, M_BODY)
place_pivot(elev, (0, STAB_HINGE_Y, STAB_Z), (0, 0, 0))
shade_smooth_angle(elev, 45)
parent_keep(elev, root)

# ---- Fin + rudder
FIN_ROOT_Z = 0.40; FIN_TIP_Z = 1.80
def fin_le(z): return 4.20 + (5.12 - 4.20) * (z - FIN_ROOT_Z) / (FIN_TIP_Z - FIN_ROOT_Z)
def fin_hinge(z): return 5.55 + (5.50 - 5.55) * (z - FIN_ROOT_Z) / (FIN_TIP_Z - FIN_ROOT_Z)
def fin_te(z): return 5.95 + (5.80 - 5.95) * (z - FIN_ROOT_Z) / (FIN_TIP_Z - FIN_ROOT_Z)
def fin_ring(z, mode, scale=1.0, tscale=1.0, cshift=0.0):
    le, h, te = fin_le(z), fin_hinge(z), fin_te(z)
    c = te - le; cut = (h - le) / c
    sec = wing_section(1.0, cut, mode, '0009', n_main=16, n_aft=6)
    return [Vector((b*c*scale*tscale, le + a*c*scale + cshift, z)) for a, b in sec]
rings = []
for z in (0.40, 0.44, 0.47, 0.8, 1.2, 1.6, 1.78, 1.80, 1.82, 1.835):
    if z < 0.46: rings.append(fin_ring(z, 'full'))
    elif z > 1.83: rings.append(fin_ring(z, 'full', 0.45, 0.35, 0.2))
    elif z > 1.81: rings.append(fin_ring(z, 'full', 0.8, 0.7, 0.07))
    elif z > 1.79: rings.append(fin_ring(z, 'full'))
    else: rings.append(fin_ring(z, 'cut'))
v, f = loft(rings, cap_start='ngon', cap_end=Vector((0, fin_le(1.84) + 0.3, 1.845)))
fin = new_mesh_object('_Fin', v, f, M_BODY)
shade_smooth_angle(fin, 50)

rings = []
for z in (0.46, 0.8, 1.2, 1.6, 1.78):
    le, h, te = fin_le(z), fin_hinge(z), fin_te(z)
    c = te - le; cut = (h - le) / c
    sec = control_section(1.0, cut, '0009', n_surf=10, n_nose=8)
    rings.append([Vector((b*c, h + a*c, z)) for a, b in sec])
v, f = loft(rings, cap_start='ngon', cap_end='ngon')
rud = new_mesh_object('Rudder', v, f, M_BODY)
tilt = math.atan2(fin_hinge(1.80) - fin_hinge(0.40), 1.40)   # dy/dz
place_pivot(rud, (0, fin_hinge(FIN_ROOT_Z), FIN_ROOT_Z), (-tilt, 0, 0))
shade_smooth_angle(rud, 45)
parent_keep(rud, root)

# ---- dorsal fillet
def cone_top(y):
    # approx top line of tail cone (from station table)
    pts = [(1.55, 0.95), (2.20, 0.83), (3.0, 0.69), (3.8, 0.59), (4.6, 0.54), (5.4, 0.52)]
    for i in range(len(pts)-1):
        if pts[i][0] <= y <= pts[i+1][0]:
            f = (y - pts[i][0]) / (pts[i+1][0] - pts[i][0]); return pts[i][1] + f*(pts[i+1][1]-pts[i][1])
    return pts[-1][1]
rings = []
for y in (3.05, 3.3, 3.6, 3.9, 4.2, 4.5):
    zt = cone_top(y); top = 0.69 + (y - 3.0)/1.5*0.11
    h = max(0.0, top - zt); w = 0.005 + 0.045 * (y - 3.05) / 1.45
    rings.append([Vector((w, y, zt - 0.06)), Vector((w*0.95, y, zt + h*0.55)), Vector((0, y, zt + h)), Vector((-w*0.95, y, zt + h*0.55)), Vector((-w, y, zt - 0.06))])
v, f = loft(rings, close=False)
fillet = new_mesh_object('_Fillet', v, f, M_BODY)
shade_smooth_angle(fillet, 50)

# ---- wing struts (streamlined tube)
def strut(name, sign):
    p0 = Vector((sign*0.52, 0.42, -0.20)); p1 = Vector((sign*3.02, 0.02, 1.02))
    d = (p1 - p0).normalized()
    # section ellipse: chord along Y (0.13), thickness across (0.05); local frame: u = Y-ish perpendicular to d, w = cross
    u = Vector((0, 1, 0)); u = (u - d * u.dot(d)).normalized(); w = d.cross(u)
    ring = lambda p: [p + u*0.065*math.cos(t) + w*0.024*math.sin(t) for t in [2*math.pi*i/14 for i in range(14)]]
    v, f = loft([ring(p0 - d*0.05), ring(p0 + d*0.2), ring(p1 - d*0.2), ring(p1 + d*0.03)], cap_start='ngon', cap_end='ngon')
    ob = new_mesh_object(name, v, f, M_BODY); shade_smooth_angle(ob, 40); return ob
sR = strut('_StrutR', 1); sL = strut('_StrutL', -1)

# ---- static wicks (join into control surfaces)
def wick(p, d, L=0.14, r=0.003):
    d = Vector(d).normalized(); u = Vector((0,0,1)); u = (u - d*u.dot(d)).normalized(); w = d.cross(u)
    ring = lambda q: [q + u*r*math.cos(t) + w*r*math.sin(t) for t in [2*math.pi*i/6 for i in range(6)]]
    return loft([ring(p), ring(p + d*L)], cap_start='ngon', cap_end='ngon')
def add_wicks(ob, pts, d):
    import bmesh
    for p in pts:
        v, f = wick(Vector(p), d)
        tmp = new_mesh_object('_wick', v, f, M_METAL)
        bpy.ops.object.select_all(action='DESELECT')
        tmp.select_set(True); ob.select_set(True); bpy.context.view_layer.objects.active = ob
        bpy.ops.object.join()
for sign, ob in ((1, ailR), (-1, ailL)):
    pts = []
    for x in (3.6, 4.4, 5.1):
        c = chord_at(x); pts.append((sign*x, LE_Y + c - 0.01, wing_z(x) + 0.0))
    add_wicks(ob, pts, (0, 1, 0))
add_wicks(elev, [(x, STAB_HINGE_Y + (1-STAB_CUT)*stab_chord(x) - 0.01, STAB_Z) for x in (-1.5, -0.8, 0.8, 1.5)], (0, 1, 0))
add_wicks(rud, [(0, fin_te(z) - 0.01, z) for z in (1.0, 1.5)], (0, 1, 0))

# ---- tail tie-down ring
import bmesh
bm = bmesh.new(); bmesh.ops.create_torus if False else None
tie = new_mesh_object('_Tie', [], [], M_METAL)
bm = bmesh.new()
# small ring: torus major 0.03 minor 0.006 at (0,5.55,0.19), in XZ plane
maj, mn = 0.028, 0.006
rings = []
for i in range(12):
    a = 2*math.pi*i/12
    cen = Vector((maj*math.cos(a), 0, maj*math.sin(a)))
    n = cen.normalized()
    rings.append([Vector((0,5.55,0.20)) + cen + n*mn*math.cos(t) + Vector((0,1,0))*mn*math.sin(t) for t in [2*math.pi*k/6 for k in range(6)]])
rings.append(rings[0])
v, f = loft(rings)
tie = new_mesh_object('_Tie', v, f, M_METAL)

print('wings', len(wings.data.polygons), 'stab', len(stab.data.polygons), 'fin', len(fin.data.polygons))
