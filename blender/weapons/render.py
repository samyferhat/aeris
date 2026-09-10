import bpy, os, math
from mathutils import Vector
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SHOTS = os.path.join(HERE, 'shots'); os.makedirs(SHOTS, exist_ok=True)
HDRI = os.path.join(ROOT, 'public', 'hdri', 'kloppenheim_02.hdr')
sc = bpy.context.scene
try: sc.render.engine = 'BLENDER_EEVEE_NEXT'
except TypeError: sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x, sc.render.resolution_y = 1600, 900
try: sc.view_settings.view_transform = 'AgX'
except Exception: pass
w = bpy.data.worlds.new('W') if not bpy.data.worlds else bpy.data.worlds[0]
sc.world = w; w.use_nodes = True
nt = w.node_tree
for n in list(nt.nodes): nt.nodes.remove(n)
bg = nt.nodes.new('ShaderNodeBackground'); env = nt.nodes.new('ShaderNodeTexEnvironment')
out = nt.nodes.new('ShaderNodeOutputWorld')
env.image = bpy.data.images.load(HDRI)
nt.links.new(env.outputs['Color'], bg.inputs['Color'])
nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
bg.inputs['Strength'].default_value = 1.1
cam = bpy.data.objects.get('_Cam')
if cam is None:
    cam = bpy.data.objects.new('_Cam', bpy.data.cameras.new('_Cam'))
    bpy.context.collection.objects.link(cam)
sc.camera = cam

def shot(name, pos, target, lens=50):
    cam.data.lens = lens; cam.location = pos
    cam.rotation_euler = (Vector(target) - Vector(pos)).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(SHOTS, name + '.png')
    bpy.ops.render.render(write_still=True); print('SHOT', name)

names = [o.name for o in bpy.data.objects if o.type == 'MESH' and not o.name.startswith('_')]
xs = [o.location.x for o in bpy.data.objects if o.type == 'MESH' and not o.name.startswith('_')]
cx = (min(xs) + max(xs)) / 2 if xs else 0
shot('rack', (cx, -13.0, 4.2), (cx, 0.0, 0.0), 52)
shot('rack_top', (cx, 0.0, 11.0), (cx, 0.0, 0.0), 50)
for nm, d in (('R73', 2.2), ('R27', 3.0), ('B8M1', 2.0), ('FAB500', 2.2)):
    o = bpy.data.objects.get(nm)
    if o: shot('detail_' + nm, (o.location.x + d * 0.55, -d, d * 0.42), (o.location.x, 0, 0), 60)
print('DONE')
