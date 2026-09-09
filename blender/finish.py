"""Headless finish pass: detail textures -> materials -> GLB export -> renders.

Run as:
  /Applications/Blender.app/Contents/MacOS/Blender --background \
      blender/aircraft.blend --python blender/finish.py

Long operations are kept out of the MCP socket on purpose (see blender/bake.py).
"""
import bpy, os, sys, time

ROOT = '/Users/samy/Documents/dev/code/aeris'
sys.path.insert(0, os.path.join(ROOT, 'blender'))
BAKE_SIZE = int(os.environ.get('BAKE_SIZE', 2048))
SHOTS = os.environ.get('SNAP_VIEWS', 'front34,rear34,side,front,top,low34,pilot,cockpit,closeup,tail')


def run(name, extra=None):
    t = time.time()
    g = {'__name__': '__main__', 'BAKE_SIZE': BAKE_SIZE}
    g.update(extra or {})
    src = open(os.path.join(ROOT, 'blender', name)).read()
    exec(compile(src, name, 'exec'), g)
    print('--- %s ok in %.1fs' % (name, time.time() - t))
    return g


def main():
    vl = bpy.context.view_layer
    for o in bpy.data.objects:
        o.hide_viewport = False
        o.hide_select = False
        try:
            o.hide_set(False, view_layer=vl)
        except Exception:
            pass

    run('74_textures.py')
    run('76_materials.py')

    # save the textured scene before exporting so the .blend stays the source of truth
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, 'blender', 'aircraft.blend'))
    print('--- blend saved')

    run('90_export.py')

    views = [v for v in SHOTS.split(',') if v]
    run('snap.py', {'SNAP_VIEWS': views, 'SNAP_RES': (1280, 720)})
    print('FINISH_OK')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        import traceback
        print('FINISH_TRACEBACK:\n' + traceback.format_exc())
        sys.exit(1)
