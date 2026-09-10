import bpy, os
from mathutils import Vector
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SHOTS = os.path.join(HERE, 'shots'); os.makedirs(SHOTS, exist_ok=True)
HDRI = os.path.join(ROOT, 'public', 'hdri', 'kloppenheim_02.hdr')
sc = bpy.context.scene
try: sc.render.engine = 'BLENDER_EEVEE_NEXT'
except TypeError: sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x, sc.render.resolution_y = 1600, 700
try: sc.view_settings.view_transform = 'AgX'
except Exception: pass
w = bpy.data.worlds.new('W') if not bpy.data.worlds else bpy.data.worlds[0]
sc.world = w; w.use_nodes = True
nt = w.node_tree
for n in list(nt.nodes): nt.nodes.remove(n)
bg = nt.nodes.new('ShaderNodeBackground'); env = nt.nodes.new('ShaderNodeTexEnvironment')
out = nt.nodes.new('ShaderNodeOutputWorld')
env.image = bpy.data.images.load(HDRI)
nt.links.new(env.outputs['Color'], bg.inputs['Color']); nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
bg.inputs['Strength'].default_value = 1.1
if '_G' not in bpy.data.objects:
    bpy.ops.mesh.primitive_plane_add(size=600, location=(0, 0, 0)); g = bpy.context.object; g.name = '_G'
    m = bpy.data.materials.new('_g'); m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.14, 0.13, 0.10, 1)
    m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.95
    g.data.materials.append(m)
cam = bpy.data.objects.get('_Cam')
if cam is None:
    cam = bpy.data.objects.new('_Cam', bpy.data.cameras.new('_Cam')); bpy.context.collection.objects.link(cam)
sc.camera = cam
def shot(name, pos, target, lens=50):
    cam.data.lens = lens; cam.location = pos
    cam.rotation_euler = (Vector(target) - Vector(pos)).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(SHOTS, name + '.png'); bpy.ops.render.render(write_still=True); print('SHOT', name)
xs = [o.location.x for o in bpy.data.objects if o.type == 'MESH' and not o.name.startswith('_')]
cx = (min(xs) + max(xs)) / 2
shot('all', (cx, -105.0, 34.0), (cx, 0, 3.0), 46)
shot('near', (18.0, -22.0, 8.0), (12.0, 0, 1.6), 45)
print('DONE')
