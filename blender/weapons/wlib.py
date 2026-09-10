"""Helpers for building air-to-air and air-to-ground stores.

Same design frame as the aircraft (see blender/mig/mlib.py): X is left, S is the
station in metres measured aft, Z is up. Each store is modelled about S0 so its
Blender origin sits at mid-length, which is what the engine hangs off a pylon.
"""
import bpy, math, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'mig'))
from mlib import MB, P, S0, TAU, new_obj, finish, make_mat, empty, cr_chain  # noqa: E402


def ring(cx, cz, s, r, seg=16):
    return [P(cx + r * math.cos(TAU * i / seg), s, cz + r * math.sin(TAU * i / seg))
            for i in range(seg)]


def ogive(mb, s_tip, s_base, r, n=9, seg=16, mat=0, blunt=0.0):
    """A tangent ogive nose: the shape every missile radome and bomb nose actually
    is, and the one thing that stops a store reading as a length of pipe."""
    rings = []
    for i in range(n):
        t = i / (n - 1)
        # tangent-ogive radius profile, softened at the very tip so the cap is not
        # a needle: real seekers and fuzes are rounded off.
        rr = r * math.sqrt(max(0.0, t * (2.0 - t)))
        rr = max(rr, blunt * r) if t > 0 else blunt * r
        rings.append(ring(0, 0, s_tip + (s_base - s_tip) * t, max(rr, 1e-4), seg))
    mb._loft_world(rings, True, blunt > 0.0, False, mat)
    return rings


def tube(mb, s0, s1, r0, r1, seg=16, cap0=False, cap1=False, mat=0):
    mb._loft_world([ring(0, 0, s0, r0, seg), ring(0, 0, s1, r1, seg)],
                   True, cap0, cap1, mat)


def fin(mb, roll, s_le_root, s_te_root, s_le_tip, s_te_tip,
        r_root, r_tip, thick, mat=0, bevel_tip=True):
    """One flat trapezoidal fin lying in a plane through the body axis.

    roll is measured about the axis, 0 = straight up. Fins are the whole silhouette
    of a missile at any distance where you can still see it, so they get real sweep
    and taper rather than a rectangle.
    """
    c, s_ = math.cos(roll), math.sin(roll)
    rd = (s_, c)          # radial direction in (X, Z)
    pd = (c, -s_)         # thickness direction
    def pt(r, st, t):
        return P(rd[0] * r + pd[0] * t, st, rd[1] * r + pd[1] * t)
    h = thick * 0.5
    tt = thick * (0.35 if bevel_tip else 1.0) * 0.5
    v = [pt(r_root, s_le_root, -h), pt(r_root, s_te_root, -h),
         pt(r_tip, s_te_tip, -tt), pt(r_tip, s_le_tip, -tt),
         pt(r_root, s_le_root, h), pt(r_root, s_te_root, h),
         pt(r_tip, s_te_tip, tt), pt(r_tip, s_le_tip, tt)]
    f = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4],
         [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
    mb.add(v, f, mat)


def fin_set(mb, n, roll0, *args, **kw):
    for i in range(n):
        fin(mb, roll0 + TAU * i / n, *args, **kw)


def clear_scene():
    for c in (bpy.data.objects, bpy.data.meshes, bpy.data.materials,
              bpy.data.cameras, bpy.data.lights):
        for it in list(c):
            c.remove(it)
