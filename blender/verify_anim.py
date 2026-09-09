"""Re-import public/models/cessna.glb into a clean scene and measure, empirically,
the hinge axis and positive-rotation direction of every animated part, plus the
glTF-space positions of the marker empties.

Run as:
  /Applications/Blender.app/Contents/MacOS/Blender --background \
      --factory-startup --python blender/verify_anim.py
"""
import bpy, math, sys, os
from mathutils import Vector, Matrix

GLB = '/Users/samy/Documents/dev/code/aeris/public/models/cessna.glb'

# glTF is Y-up / -Z forward. Blender's importer converts back to Z-up, so to
# report glTF-space numbers we convert every measured Blender vector with:
#   gltf = (bx, bz, -by)
def to_gltf(v):
    return Vector((v.x, v.z, -v.y))


AXIS_NAMES = ['X', 'Y', 'Z']

# parts whose motion we care about, and the point on the part we watch
ANIMATED = ['Aileron_L', 'Aileron_R', 'Flap_L', 'Flap_R', 'Elevator', 'Rudder',
            'Propeller', 'Prop_Disc', 'Wheel_L', 'Wheel_R', 'Wheel_Nose', 'Yoke_L']

MARKERS = ['Camera_Pilot', 'Contact_Nose', 'Contact_L', 'Contact_R',
           'Wingtip_L', 'Wingtip_R', 'Exhaust', 'Nav_L', 'Nav_R', 'Beacon', 'Strobe_Tail']


def clean():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def local_extents(ob):
    """Bounding box of the mesh in the object's own local space."""
    if ob.type != 'MESH' or not ob.data.vertices:
        return None
    xs = [v.co for v in ob.data.vertices]
    lo = Vector((min(c.x for c in xs), min(c.y for c in xs), min(c.z for c in xs)))
    hi = Vector((max(c.x for c in xs), max(c.y for c in xs), max(c.z for c in xs)))
    return lo, hi


def main():
    clean()
    bpy.ops.import_scene.gltf(filepath=GLB)
    names = sorted(o.name for o in bpy.data.objects)
    print('IMPORT_OK objects=%d' % len(names))
    print('NODES:', names)

    tris = 0
    for o in bpy.data.objects:
        if o.type == 'MESH':
            o.data.calc_loop_triangles()
            tris += len(o.data.loop_triangles)
    print('TRIS_REIMPORT %d' % tris)

    print('\n--- marker positions (glTF space, metres) ---')
    for n in MARKERS:
        o = bpy.data.objects.get(n)
        if not o:
            print('  %-14s MISSING' % n)
            continue
        g = to_gltf(o.matrix_world.translation)
        print('  %-14s (%.3f, %.3f, %.3f)' % (n, g.x, g.y, g.z))

    print('\n--- hinge axes (local axis, glTF world direction, effect of +angle) ---')
    for n in ANIMATED:
        o = bpy.data.objects.get(n)
        if not o:
            print('  %-12s MISSING' % n)
            continue
        ext = local_extents(o)
        if ext is None:
            print('  %-12s (no mesh)' % n)
            continue
        lo, hi = ext
        size = hi - lo
        # hinge axis = the local axis the part is longest along
        ai = max(range(3), key=lambda i: size[i])
        axis = Vector((0, 0, 0)); axis[ai] = 1.0

        # world direction of that local axis, in glTF space
        wdir = (o.matrix_world.to_3x3() @ axis).normalized()
        gdir = to_gltf(wdir)

        # watch the vertex farthest from the hinge axis (the trailing edge / blade tip)
        best, bestd = None, -1
        for v in o.data.vertices:
            perp = v.co - axis * v.co.dot(axis)
            if perp.length > bestd:
                bestd, best = perp.length, v.co.copy()

        R = Matrix.Rotation(math.radians(10.0), 4, axis)
        moved = o.matrix_world @ (R @ best)
        before = o.matrix_world @ best
        d = to_gltf(moved - before)

        # describe the dominant motion in glTF terms (+X right, +Y up, -Z forward)
        comps = [('right(+X)', d.x), ('up(+Y)', d.y), ('aft(+Z)', d.z)]
        comps.sort(key=lambda c: -abs(c[1]))
        lead = comps[0]
        word = lead[0] if lead[1] > 0 else lead[0].replace('right(+X)', 'left(-X)').replace('up(+Y)', 'down(-Y)').replace('aft(+Z)', 'fwd(-Z)')
        print('  %-12s local %s | glTF axis (%+.2f, %+.2f, %+.2f) | +10deg moves tip %s (%.3f m)'
              % (n, AXIS_NAMES[ai], gdir.x, gdir.y, gdir.z, word, abs(lead[1])))

    print('\nVERIFY_OK')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        import traceback
        print('VERIFY_TRACEBACK:\n' + traceback.format_exc())
        sys.exit(1)
