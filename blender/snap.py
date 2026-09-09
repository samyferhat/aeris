# usage: exec with SNAP_VIEWS defined, or defaults. Renders EEVEE views to blender/shots/<name>.png
import bpy, math, os
from mathutils import Vector
OUT = '/Users/samy/Documents/dev/code/aeris/blender/shots'
os.makedirs(OUT, exist_ok=True)
sc = bpy.context.scene
cam = bpy.data.objects['_RenderCam']
def look_at(cam, pos, target, lens=35):
    cam.location = Vector(pos)
    d = Vector(target) - Vector(pos)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = lens
VIEWS = {
 'front34': ((-9.0, -9.5, 2.6), (0, 0.8, 0.2), 40),
 'rear34':  ((8.5, 9.0, 3.0), (0, 1.0, 0.3), 40),
 'side':    ((-12.0, 1.5, 0.6), (0, 1.5, 0.4), 45),
 'front':   ((0, -13, 1.0), (0, 0, 0.3), 45),
 'top':     ((0.2, 1.5, 14), (0, 1.5, 0), 40),
 'low34':   ((7.0, -8.0, -0.5), (0, 0.5, 0.0), 40),
 'pilot':   ((-0.25, 0.0, 0.68), (-0.25, -6.0, 0.35), 20),
 'pilot_r': ((-0.25, 0.0, 0.68), (5.0, -2.0, 0.3), 20),
 'cockpit': ((0.35, 1.3, 0.75), (-0.2, -0.9, 0.2), 22),
}
views = globals().get('SNAP_VIEWS', ['front34', 'rear34', 'side', 'pilot'])
res = globals().get('SNAP_RES', (1280, 720))
sc.render.resolution_x, sc.render.resolution_y = res
paths = []
for v in views:
    pos, tgt, lens = VIEWS[v]
    look_at(cam, pos, tgt, lens)
    sc.render.filepath = os.path.join(OUT, v + '.png')
    bpy.ops.render.render(write_still=True)
    paths.append(sc.render.filepath)
result = 'rendered: ' + ', '.join(paths)
