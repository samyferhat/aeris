import bpy, os, sys, math
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SHOTS = os.path.join(HERE, 'shots')
os.makedirs(SHOTS, exist_ok=True)
HDRI = os.path.join(ROOT, 'public', 'hdri', 'kloppenheim_02.hdr')

sc = bpy.context.scene
eng = [e for e in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE')
       if e in bpy.types.RenderEngine.__subclasses__.__doc__ if False]
try:
    sc.render.engine = 'BLENDER_EEVEE_NEXT'
except TypeError:
    sc.render.engine = 'BLENDER_EEVEE'
print('ENGINE', sc.render.engine)
sc.render.resolution_x = 1280
sc.render.resolution_y = 720
sc.render.film_transparent = False
try:
    sc.eevee.taa_render_samples = 32
except Exception:
    pass
try:
    sc.view_settings.view_transform = 'AgX'
except Exception:
    pass

# world
w = bpy.data.worlds.new('W') if not bpy.data.worlds else bpy.data.worlds[0]
sc.world = w
w.use_nodes = True
nt = w.node_tree
for n in list(nt.nodes):
    nt.nodes.remove(n)
bg = nt.nodes.new('ShaderNodeBackground')
env = nt.nodes.new('ShaderNodeTexEnvironment')
mp = nt.nodes.new('ShaderNodeMapping')
tc = nt.nodes.new('ShaderNodeTexCoord')
out = nt.nodes.new('ShaderNodeOutputWorld')
env.image = bpy.data.images.load(HDRI)
nt.links.new(tc.outputs['Generated'], mp.inputs['Vector'])
nt.links.new(mp.outputs['Vector'], env.inputs['Vector'])
nt.links.new(env.outputs['Color'], bg.inputs['Color'])
nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
bg.inputs['Strength'].default_value = 1.0

# ground plane
if '_Ground' not in bpy.data.objects:
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -1.9))
    g = bpy.context.object
    g.name = '_Ground'
    m = bpy.data.materials.new('_gnd')
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.22, 0.21, 0.20, 1)
    m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
    g.data.materials.append(m)

cam = bpy.data.objects.get('_Cam')
if cam is None:
    cd = bpy.data.cameras.new('_Cam')
    cam = bpy.data.objects.new('_Cam', cd)
    bpy.context.collection.objects.link(cam)
sc.camera = cam


def look(pos, target, lens=50):
    cam.data.lens = lens
    cam.location = pos
    d = Vector(target) - Vector(pos)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def shot(name, pos, target, lens=50, hide=()):
    hidden = []
    for h in hide:
        o = bpy.data.objects.get(h)
        if o:
            o.hide_render = True
            hidden.append(o)
    look(pos, target, lens)
    sc.render.filepath = os.path.join(SHOTS, name + '.png')
    bpy.ops.render.render(write_still=True)
    for o in hidden:
        o.hide_render = False
    print('SHOT', name)


which = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ALL = {
    'front34': ((11.0, -13.0, 4.6), (0.2, 0.4, -0.35), 55),
    'side':    ((0.6, 0.0, 0.0), (0.6, 0.0, 0.0), 55),
    'rear34':  ((8.5, 13.5, 3.4), (-0.4, 3.0, -0.55), 55),
    'top':     ((0.0, 0.6, 26.0), (0.0, 0.6, -0.4), 55),
    'front':   ((0.0, -22.0, 0.6), (0.0, 0.0, 0.0), 70),
    'low34':   ((9.0, -10.0, -1.2), (0.0, 0.5, -0.5), 50),
    'pilot':   ((0.0, 0.0, 0.0), (0.0, 0.0, 0.0), 22),
    'tail':    ((2.6, 11.5, 1.2), (0.6, 4.5, 0.1), 40),
    'nose':    ((3.2, -8.0, 1.4), (0.0, -3.5, -0.1), 55),
}
if not which:
    which = list(ALL.keys())

for k in which:
    if k == 'side':
        shot('side', (16.0, 0.6, 0.0), (0.0, 0.6, 0.0), 120)
    elif k == 'pilot':
        e = bpy.data.objects['Camera_Pilot']
        p = e.matrix_world.translation
        look((p.x, p.y, p.z), (p.x, p.y - 6.0, p.z - 0.62), 20)
        sc.render.filepath = os.path.join(SHOTS, 'pilot.png')
        bpy.ops.render.render(write_still=True)
        print('SHOT pilot')
    else:
        pos, tgt, lens = ALL[k]
        shot(k, pos, tgt, lens)
print('DONE')
