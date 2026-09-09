"""Headless Cycles bake entry point.

Run as:
  /Applications/Blender.app/Contents/MacOS/Blender --background \
      blender/aircraft.blend --python blender/bake.py

Never run this through the MCP socket: a long Cycles bake blocks the socket
and hangs the connection. Writes blender/textures/bake_<SIZE>.npz.
"""
import bpy, os, sys, time

ROOT = '/Users/samy/Documents/dev/code/aeris'
sys.path.insert(0, os.path.join(ROOT, 'blender'))

BAKE_SIZE = int(os.environ.get('BAKE_SIZE', 2048))
AO_SAMPLES = int(os.environ.get('AO_SAMPLES', 64))


def prep():
    """Background mode has no window; make sure every bake target is
    visible in the view layer and selectable, or object.bake() errors out."""
    vl = bpy.context.view_layer
    for o in bpy.data.objects:
        o.hide_viewport = False
        o.hide_select = False
        try:
            o.hide_set(False, view_layer=vl)
        except Exception:
            pass
    # make sure there is an active object so ops have a context
    for o in bpy.data.objects:
        if o.type == 'MESH':
            vl.objects.active = o
            break


def main():
    t0 = time.time()
    prep()
    g = {'__name__': '__main__', 'BAKE_SIZE': BAKE_SIZE, 'AO_SAMPLES': AO_SAMPLES}
    src = open(os.path.join(ROOT, 'blender', '72_bake.py')).read()
    exec(compile(src, '72_bake.py', 'exec'), g)
    print('BAKE_OK in %.1fs' % (time.time() - t0))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        import traceback
        print('BAKE_TRACEBACK:\n' + traceback.format_exc())
        sys.exit(1)
