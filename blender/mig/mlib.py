"""Shared helpers for the MiG-29 build.

Design frame used throughout:
    X = LEFT  (positive to the aircraft's left wing)
    S = station, metres aft of the radome tip
    Z = up
Blender coords = (X, S - S0, Z)  with S0 = 9.80 (the CG station).
That maps, on glTF export with +Y up, to: glTF X = left, glTF Y = up,
glTF Z = forward (nose).
"""
import bpy, bmesh, math
from mathutils import Vector, Matrix

S0 = 9.80
TAU = math.pi * 2.0


# ----------------------------------------------------------------- math ----
def P(x, s, z):
    """design -> blender"""
    return (x, s - S0, z)


def _cr(p0, p1, p2, p3, t):
    t2 = t * t
    t3 = t2 * t
    return tuple(
        0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2
               + (-a + 3 * b - 3 * c + d) * t3)
        for a, b, c, d in zip(p0, p1, p2, p3))


def cr_chain(pts, n):
    """Catmull-Rom through `pts` (tuples of equal length), sampled n times."""
    pts = [tuple(p) for p in pts]
    ext = [pts[0]] + pts + [pts[-1]]
    segs = len(pts) - 1
    out = []
    for i in range(n):
        u = (i / (n - 1)) * segs if n > 1 else 0.0
        k = min(int(u), segs - 1)
        out.append(_cr(ext[k], ext[k + 1], ext[k + 2], ext[k + 3], u - k))
    return out


def lerp(a, b, t):
    return a + (b - a) * t


def sample_table(sx, sy, x):
    """piecewise-linear lookup"""
    if x <= sx[0]:
        return sy[0]
    if x >= sx[-1]:
        return sy[-1]
    for i in range(len(sx) - 1):
        if sx[i] <= x <= sx[i + 1]:
            t = (x - sx[i]) / (sx[i + 1] - sx[i])
            return lerp(sy[i], sy[i + 1], t)
    return sy[-1]


def naca_half(t, u):
    """symmetric NACA 4-digit half-thickness at chord fraction u (0..1)"""
    u = max(0.0, min(1.0, u))
    return 5.0 * t * (0.2969 * math.sqrt(u) - 0.1260 * u - 0.3516 * u * u
                      + 0.2843 * u ** 3 - 0.1036 * u ** 4)


def airfoil_slice(c0, c1, tc, n=16):
    """Closed 2D loop (u = chord fraction, v = half-thickness fraction) for the
    slab of an airfoil between chord fractions c0 and c1."""
    us = [c0 + (c1 - c0) * (0.5 - 0.5 * math.cos(math.pi * i / (n - 1)))
          for i in range(n)]
    up = [(u, naca_half(tc, u)) for u in us]
    lo = [(u, -naca_half(tc, u)) for u in us]
    loop = up + list(reversed(lo))
    out = []
    for p in loop:
        if out and abs(p[0] - out[-1][0]) < 1e-7 and abs(p[1] - out[-1][1]) < 1e-7:
            continue
        out.append(p)
    while len(out) > 3 and abs(out[0][0] - out[-1][0]) < 1e-7 and abs(out[0][1] - out[-1][1]) < 1e-7:
        out.pop()
    return out


# ------------------------------------------------------------- builders ----
class MB:
    """Accumulates verts / faces / per-face material index."""

    def __init__(self):
        self.v = []
        self.f = []
        self.m = []

    def add(self, verts, faces, mat=0):
        base = len(self.v)
        self.v.extend(verts)
        for fc in faces:
            self.f.append([base + i for i in fc])
            self.m.append(mat)

    # ---- primitives (design coords) ----
    def loft(self, rings, closed=True, cap_start=False, cap_end=False, mat=0,
             flip=False):
        n = len(rings[0])
        verts = [v for r in rings for v in r]
        faces = []
        lim = n if closed else n - 1
        for i in range(len(rings) - 1):
            a = i * n
            b = (i + 1) * n
            for j in range(lim):
                j2 = (j + 1) % n
                faces.append([a + j, a + j2, b + j2, b + j])
        base_extra = []
        if cap_start:
            c = _centroid([verts[j] for j in range(n)])
            ci = len(verts) + len(base_extra)
            base_extra.append(c)
            for j in range(lim):
                faces.append([ci, (j + 1) % n, j])
        if cap_end:
            off = (len(rings) - 1) * n
            c = _centroid([verts[off + j] for j in range(n)])
            ci = len(verts) + len(base_extra)
            base_extra.append(c)
            for j in range(lim):
                faces.append([ci, off + j, off + (j + 1) % n])
        verts = verts + base_extra
        if flip:
            faces = [list(reversed(fc)) for fc in faces]
        self.add(verts, faces, mat)

    def box(self, x0, x1, s0, s1, z0, z1, mat=0):
        v = [P(x0, s0, z0), P(x1, s0, z0), P(x1, s1, z0), P(x0, s1, z0),
             P(x0, s0, z1), P(x1, s0, z1), P(x1, s1, z1), P(x0, s1, z1)]
        f = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4],
             [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
        self.add(v, f, mat)

    def box_open_bottom(self, x0, x1, s0, s1, z0, z1, mat=0):
        v = [P(x0, s0, z0), P(x1, s0, z0), P(x1, s1, z0), P(x0, s1, z0),
             P(x0, s0, z1), P(x1, s0, z1), P(x1, s1, z1), P(x0, s1, z1)]
        # inward facing (seen from below)
        f = [[4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2],
             [2, 6, 7, 3], [3, 7, 4, 0]]
        self.add(v, f, mat)

    def cyl(self, p0, p1, r0, r1, seg=16, caps=True, mat=0, up=(0, 0, 1)):
        """p0/p1 in design coords."""
        a = Vector(P(*p0))
        b = Vector(P(*p1))
        ax = (b - a)
        L = ax.length
        if L < 1e-9:
            return
        ax.normalize()
        ref = Vector(up)
        if abs(ref.dot(ax)) > 0.95:
            ref = Vector((1, 0, 0))
        u = ax.cross(ref).normalized()
        w = ax.cross(u)
        rings = []
        for (c, r) in ((a, r0), (b, r1)):
            rings.append([tuple(c + u * (r * math.cos(TAU * i / seg))
                                + w * (r * math.sin(TAU * i / seg)))
                          for i in range(seg)])
        self._loft_world(rings, True, caps, caps, mat)

    def _loft_world(self, rings, closed=True, cap_start=False, cap_end=False,
                    mat=0, flip=False):
        n = len(rings[0])
        verts = [v for r in rings for v in r]
        faces = []
        lim = n if closed else n - 1
        for i in range(len(rings) - 1):
            a = i * n
            b = (i + 1) * n
            for j in range(lim):
                j2 = (j + 1) % n
                faces.append([a + j, a + j2, b + j2, b + j])
        extra = []
        if cap_start:
            c = _centroid([verts[j] for j in range(n)])
            ci = len(verts) + len(extra)
            extra.append(c)
            for j in range(lim):
                faces.append([ci, (j + 1) % n, j])
        if cap_end:
            off = (len(rings) - 1) * n
            c = _centroid([verts[off + j] for j in range(n)])
            ci = len(verts) + len(extra)
            extra.append(c)
            for j in range(lim):
                faces.append([ci, off + j, off + (j + 1) % n])
        verts = verts + extra
        if flip:
            faces = [list(reversed(fc)) for fc in faces]
        self.add(verts, faces, mat)


def _centroid(pts):
    n = len(pts)
    return (sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n,
            sum(p[2] for p in pts) / n)


# --------------------------------------------------------------- scene -----
def new_obj(name, mb, mats):
    me = bpy.data.meshes.new(name)
    me.from_pydata(mb.v, [], mb.f)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    for m in mats:
        ob.data.materials.append(m)
    if len(mats) > 1:
        for i, p in enumerate(me.polygons):
            p.material_index = min(mb.m[i], len(mats) - 1)
    clean(ob)
    return ob


def _island_volume(faces):
    v = 0.0
    for f in faces:
        vs = f.verts[:]
        a = vs[0].co
        for i in range(1, len(vs) - 1):
            b = vs[i].co
            c = vs[i + 1].co
            v += a.dot(b.cross(c)) / 6.0
    return v


def fix_orientation(bm):
    """recalc_face_normals gets confused by overlapping shells; re-check each
    connected island by signed volume and flip the ones that came out inside-out."""
    bm.faces.ensure_lookup_table()
    seen = set()
    for f0 in bm.faces:
        if f0.index in seen:
            continue
        stack = [f0]
        seen.add(f0.index)
        isl = []
        nman = 0
        etot = 0
        while stack:
            cf = stack.pop()
            isl.append(cf)
            for e in cf.edges:
                etot += 1
                if len(e.link_faces) != 2:
                    nman += 1
                for nf in e.link_faces:
                    if nf.index not in seen:
                        seen.add(nf.index)
                        stack.append(nf)
        if etot == 0 or nman / float(etot) > 0.10:
            continue                      # open / messy shell: leave alone
        vol = _island_volume(isl)
        if vol < -1e-6:
            bmesh.ops.reverse_faces(bm, faces=isl)


def clean(ob, dist=0.0006):
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
    # kill degenerate faces
    bmesh.ops.dissolve_degenerate(bm, dist=1e-5, edges=bm.edges)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    fix_orientation(bm)
    bm.to_mesh(me)
    bm.free()
    me.update()


def cut_faces(ob, x0, x1, s0, s1, z0, z1, nz=None, nx=None):
    """Delete faces whose centroid falls in the design-space box, optionally
    filtered by normal direction."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    dead = []
    for f in bm.faces:
        c = f.calc_center_median()
        s = c.y + S0
        if x0 <= c.x <= x1 and s0 <= s <= s1 and z0 <= c.z <= z1:
            n = f.normal
            if nz is not None and n.z * nz < 0.20:
                continue
            if nx is not None and n.x * nx < 0.20:
                continue
            dead.append(f)
    bmesh.ops.delete(bm, geom=dead, context='FACES')
    bm.to_mesh(me)
    bm.free()
    me.update()


def set_origin(ob, x, s, z):
    loc = Vector(P(x, s, z))
    ob.data.transform(Matrix.Translation(-loc))
    ob.location = loc


def finish(ob, bevel=0.008, seg=2, angle=math.radians(34), smooth=True):
    for p in ob.data.polygons:
        p.use_smooth = smooth
    if bevel:
        m = ob.modifiers.new('bev', 'BEVEL')
        m.width = bevel
        m.segments = seg
        m.limit_method = 'ANGLE'
        m.angle_limit = math.radians(38)
        m.harden_normals = False
        m.miter_outer = 'MITER_ARC'
        m.use_clamp_overlap = True
    if smooth:
        m = ob.modifiers.new('es', 'EDGE_SPLIT')
        m.split_angle = angle
        m.use_edge_sharp = False


def mirror_object(ob, name):
    """Duplicate + mirror across X=0. Origin mirrors too."""
    new = ob.copy()
    new.data = ob.data.copy()
    new.name = name
    new.data.name = name
    bpy.context.collection.objects.link(new)
    new.data.transform(Matrix.Diagonal((-1, 1, 1, 1)))
    bm = bmesh.new()
    bm.from_mesh(new.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(new.data)
    bm.free()
    new.location = (-ob.location.x, ob.location.y, ob.location.z)
    return new


def empty(name, x, s, z, size=0.15):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = 'PLAIN_AXES'
    e.empty_display_size = size
    e.location = P(x, s, z)
    bpy.context.collection.objects.link(e)
    return e


def parent_to(child, par):
    bpy.context.view_layer.update()
    child.parent = par
    child.matrix_parent_inverse = par.matrix_world.inverted()


def make_mat(name, base, rough=0.5, metal=0.0, alpha=1.0, ior=1.45):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (base[0], base[1], base[2], 1.0)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if 'IOR' in b.inputs:
        b.inputs['IOR'].default_value = ior
    if alpha < 1.0:
        b.inputs['Alpha'].default_value = alpha
        try:
            m.blend_method = 'BLEND'
        except Exception:
            pass
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            pass
        try:
            m.show_transparent_back = False
        except Exception:
            pass
    return m
