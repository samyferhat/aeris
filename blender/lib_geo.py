"""Geometry helpers for the Cessna build (imported inside Blender)."""
import bpy, bmesh, math
from mathutils import Vector, Matrix

# ---------------------------------------------------------------- basics
def clear_object(name):
    o = bpy.data.objects.get(name)
    if o:
        me = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if me and hasattr(me, 'users') and me.users == 0:
            try: bpy.data.meshes.remove(me)
            except Exception: pass

def new_mesh_object(name, verts, faces, mat=None, uvs=None):
    clear_object(name)
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if mat is not None:
        me.materials.append(mat)
    return ob

def get_mat(name, color=(0.8, 0.8, 0.8, 1), rough=0.5, metal=0.0):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = color
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = metal
    return m

def set_smooth(ob, angle_deg=35):
    me = ob.data
    for p in me.polygons: p.use_smooth = True
    # smooth-by-angle modifier (Blender 4.1+)
    if 'SmoothByAngle' not in ob.modifiers:
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        try:
            bpy.ops.object.modifier_add_node_group(asset_library_type='ESSENTIALS',
                asset_library_identifier="", relative_asset_identifier="geometry_nodes/smooth_by_angle.blend/NodeTree/Smooth by Angle")
            md = ob.modifiers[-1]
            md.name = 'SmoothByAngle'
            md['Input_1'] = math.radians(angle_deg)
        except Exception as e:
            print('smooth by angle failed', e)

def shade_smooth_angle(ob, angle_deg=35):
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.selected_objects: o.select_set(False)
    ob.select_set(True)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle_deg))
    ob.select_set(False)

def add_subsurf(ob, levels=1, render_levels=None):
    md = ob.modifiers.new('Subdiv', 'SUBSURF')
    md.levels = levels
    md.render_levels = render_levels if render_levels is not None else levels
    md.quality = 3
    return md

def add_bevel(ob, width=0.01, segments=2, angle=40):
    md = ob.modifiers.new('Bevel', 'BEVEL')
    md.width = width; md.segments = segments
    md.limit_method = 'ANGLE'; md.angle_limit = math.radians(angle)
    md.harden_normals = False
    return md

def apply_all_modifiers(ob):
    bpy.context.view_layer.objects.active = ob
    for md in list(ob.modifiers):
        try:
            bpy.ops.object.modifier_apply(modifier=md.name)
        except Exception as e:
            print('apply failed', ob.name, md.name, e)
            ob.modifiers.remove(md)

def parent_keep(child, parent):
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()

def new_empty(name, loc, parent=None, size=0.15):
    clear_object(name)
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = 'PLAIN_AXES'; e.empty_display_size = size
    e.location = loc
    bpy.context.scene.collection.objects.link(e)
    if parent is not None:
        parent_keep(e, parent)
    return e

# ---------------------------------------------------------------- curves
def catmull_rom_closed(pts, counts, alpha=0.5):
    """pts: list of (a,b) key points (closed). counts[i] = samples on segment i->i+1.
    Returns list of points (excluding duplicates of key points at segment ends)."""
    n = len(pts)
    P = [Vector((p[0], p[1])) for p in pts]
    out = []
    for i in range(n):
        p0, p1, p2, p3 = P[(i-1) % n], P[i], P[(i+1) % n], P[(i+2) % n]
        def tj(ti, pi, pj):
            return ((pj - pi).length ** alpha) + ti
        t0 = 0.0; t1 = tj(t0, p0, p1); t2 = tj(t1, p1, p2); t3 = tj(t2, p2, p3)
        if t1 == t0: t1 = t0 + 1e-6
        if t2 == t1: t2 = t1 + 1e-6
        if t3 == t2: t3 = t2 + 1e-6
        c = counts[i]
        for k in range(c):
            t = t1 + (t2 - t1) * k / c
            A1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1
            A2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
            A3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
            B1 = (t2 - t) / (t2 - t0) * A1 + (t - t0) / (t2 - t0) * A2
            B2 = (t3 - t) / (t3 - t1) * A2 + (t - t1) / (t3 - t1) * A3
            C = (t2 - t) / (t2 - t1) * B1 + (t - t1) / (t2 - t1) * B2
            out.append((C.x, C.y))
    return out

def catmull_rom_open(pts, samples, alpha=0.5):
    """Open centripetal Catmull-Rom through pts, sampled with 'samples' points total."""
    P = [Vector(p) for p in pts]
    if len(P) < 2: return [tuple(p) for p in P]
    P = [P[0] + (P[0] - P[1])] + P + [P[-1] + (P[-1] - P[-2])]
    nseg = len(P) - 3
    out = []
    for s in range(samples):
        u = s / (samples - 1) * nseg
        i = min(int(u), nseg - 1); f = u - i
        p0, p1, p2, p3 = P[i], P[i+1], P[i+2], P[i+3]
        # uniform CR (simpler for open)
        t = f
        C = 0.5 * ((2*p1) + (-p0 + p2)*t + (2*p0 - 5*p1 + 4*p2 - p3)*t*t + (-p0 + 3*p1 - 3*p2 + p3)*t*t*t)
        out.append(tuple(C))
    return out

# ---------------------------------------------------------------- loft
def loft(rings, cap_start=None, cap_end=None, close=True, flip=False):
    """rings: list of lists of Vector/tuple (equal length). Returns (verts, faces).
    cap_start/cap_end: None | 'fan' | 'ngon' | Vector (fan to given point)."""
    n = len(rings[0])
    verts = []; faces = []
    for r in rings:
        assert len(r) == n, (len(r), n)
        verts.extend([tuple(v) for v in r])
    R = len(rings)
    for i in range(R - 1):
        for j in range(n):
            if j == n - 1 and not close: break
            a = i*n + j; b = i*n + (j+1) % n
            c = (i+1)*n + (j+1) % n; d = (i+1)*n + j
            faces.append((a, b, c, d) if not flip else (d, c, b, a))
    def cap(ring_index, mode, front):
        base = ring_index * n
        idx = list(range(base, base + n))
        if isinstance(mode, str) and mode == 'ngon':
            f = tuple(idx) if front else tuple(reversed(idx))
            faces.append(f if not flip else tuple(reversed(f)))
        else:
            if isinstance(mode, str):  # fan to centroid
                c = Vector((0,0,0))
                for k in idx: c += Vector(verts[k])
                c /= n
            else:
                c = Vector(mode)
            ci = len(verts); verts.append(tuple(c))
            for j in range(n):
                a = base + j; b = base + (j+1) % n
                f = (ci, b, a) if front else (ci, a, b)
                faces.append(f if not flip else tuple(reversed(f)))
    if cap_start is not None: cap(0, cap_start, True)
    if cap_end is not None: cap(R - 1, cap_end, False)
    return verts, faces

# ---------------------------------------------------------------- airfoils
def naca4(code='2412', n=40, closed_te=True):
    """Returns upper and lower surfaces as lists of (x, y) with x in [0,1] (cosine spaced), from LE to TE."""
    m = int(code[0]) / 100.0; p = int(code[1]) / 10.0; t = int(code[2:]) / 100.0
    up = []; lo = []
    a4 = -0.1036 if closed_te else -0.1015
    for i in range(n + 1):
        b = math.pi * i / n
        x = 0.5 * (1 - math.cos(b))
        yt = 5*t*(0.2969*math.sqrt(x) - 0.1260*x - 0.3516*x*x + 0.2843*x**3 + a4*x**4)
        if m > 0 and p > 0:
            if x < p:
                yc = m/(p*p)*(2*p*x - x*x); dyc = 2*m/(p*p)*(p - x)
            else:
                yc = m/((1-p)**2)*((1-2*p) + 2*p*x - x*x); dyc = 2*m/((1-p)**2)*(p - x)
        else:
            yc = 0.0; dyc = 0.0
        th = math.atan(dyc)
        up.append((x - yt*math.sin(th), yc + yt*math.cos(th)))
        lo.append((x + yt*math.sin(th), yc - yt*math.cos(th)))
    return up, lo

def _resample(poly, n):
    """Resample a polyline (list of 2D tuples) to n points evenly by arc length."""
    P = [Vector(p) for p in poly]
    L = [0.0]
    for i in range(1, len(P)): L.append(L[-1] + (P[i] - P[i-1]).length)
    tot = L[-1]
    out = []
    j = 0
    for k in range(n):
        s = tot * k / (n - 1)
        while j < len(L) - 2 and L[j+1] < s: j += 1
        seg = L[j+1] - L[j]
        f = 0 if seg == 0 else (s - L[j]) / seg
        out.append(tuple(P[j].lerp(P[j+1], f)))
    return out

def _camber_thickness_at(up, lo, xf):
    """Interpolate upper/lower y at chordwise fraction xf."""
    def interp(surf):
        for i in range(len(surf) - 1):
            if surf[i][0] <= xf <= surf[i+1][0]:
                f = (xf - surf[i][0]) / max(1e-9, surf[i+1][0] - surf[i][0])
                return surf[i][1] + f * (surf[i+1][1] - surf[i][1])
        return surf[-1][1]
    yu = interp(up); yl = interp(lo)
    return (yu + yl) / 2, (yu - yl)

def wing_section(chord, cut, mode, code='2412', n_main=22, n_aft=6, nose_scale=1.0):
    """Closed section (list of (c, t) = chordwise, thickness coords, from LE at c=0).
    mode 'full': full airfoil.  mode 'cut': airfoil truncated at 'cut' with a concave cove.
    Point order: upper surface from cut point -> LE, lower from LE -> cut point, then aft part.
    Total points = 2*n_main + n_aft (constant for all modes)."""
    up, lo = naca4(code, 60)
    up_c = [(x, y) for x, y in up if x <= cut]
    lo_c = [(x, y) for x, y in lo if x <= cut]
    yc, th = _camber_thickness_at(up, lo, cut)
    up_c.append((cut, yc + th/2)); lo_c.append((cut, yc - th/2))
    up_r = _resample(list(reversed(up_c)), n_main + 1)   # cut -> LE
    lo_r = _resample(lo_c, n_main + 1)                    # LE -> cut
    pts = up_r[:-1] + lo_r[:-1]   # drop LE dup and last lower point (aft part starts with it)
    aft = []
    if mode == 'full':
        up_a = [(x, y) for x, y in up if x > cut]; lo_a = [(x, y) for x, y in lo if x > cut]
        poly = [lo_r[-1]] + lo_a + list(reversed(up_a)) + [up_r[0]]
        aft = _resample(poly, n_aft + 2)[:-1]     # from lower cut point to just before upper cut point
    else:
        r = th / 2 * nose_scale
        cx, cy = cut, yc
        # concave cove: go from lower cut point forward around hinge to upper cut point
        for k in range(n_aft + 1):
            a = -math.pi/2 - math.pi * k / (n_aft + 1)
            aft.append((cx + r*math.cos(a), cy + r*math.sin(a)))
    # NOTE: pts already contains lo_r[-2]; aft starts at lower cut point
    sec = pts + aft
    return [(c*chord, t*chord) for c, t in sec]

def control_section(chord, cut, code='2412', n_surf=12, n_nose=8, nose_scale=0.85):
    """Control surface section relative to the hinge point (c=cut, t=camber at cut).
    Returns list of (c, t) with hinge at (0,0). Upper from nose top -> TE, lower TE -> nose bottom, then nose arc."""
    up, lo = naca4(code, 60)
    yc, th = _camber_thickness_at(up, lo, cut)
    r = th / 2 * nose_scale
    up_a = [(cut + r*0.15, yc + r*0.985)] + [(x, y) for x, y in up if x > cut + r*0.2]
    lo_a = [(cut + r*0.15, yc - r*0.985)] + [(x, y) for x, y in lo if x > cut + r*0.2]
    up_r = _resample(up_a, n_surf + 1)
    lo_r = _resample(lo_a, n_surf + 1)
    pts = up_r + list(reversed(lo_r))[1:-1]  # upper nose->TE (TE dup once), lower TE->nose (excluding endpoints)
    pts.append(lo_r[0])
    nose = []
    for k in range(1, n_nose):
        a = -math.pi/2 - math.pi * k / n_nose
        nose.append((cut + r*math.cos(a), yc + r*math.sin(a)))
    sec = pts + nose
    return [((c - cut)*chord, (t - yc)*chord) for c, t in sec]

def section_to_ring(sec, span_pos, plane='wing', shift=(0.0, 0.0), scale_t=1.0):
    """Map 2D section (c,t) to 3D. plane 'wing': c->+Y (aft), t->+Z, span->X.
    plane 'fin': c->+Y, t->+X (thickness sideways), span->Z. shift added to (c,t) before mapping."""
    out = []
    for c, t in sec:
        c2 = c + shift[0]; t2 = t*scale_t + shift[1]
        if plane == 'wing':
            out.append(Vector((span_pos, c2, t2)))
        else:
            out.append(Vector((t2, c2, span_pos)))
    return out
