import bpy, sys, math, importlib
sys.path.insert(0, '/Users/samy/Documents/dev/code/aeris/blender')
import lib_geo; importlib.reload(lib_geo)
from lib_geo import *

# wipe scene
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures, bpy.data.curves, bpy.data.images, bpy.data.cameras, bpy.data.lights, bpy.data.node_groups):
    for d in list(coll):
        try: coll.remove(d)
        except Exception: pass
sc = bpy.context.scene
sc.unit_settings.system = 'METRIC'; sc.unit_settings.scale_length = 1.0

# root
root = new_empty('Cessna', (0,0,0), size=0.5)
cock = new_empty('Cockpit', (0,0,0), parent=root, size=0.2)

# materials
get_mat('Paint_Body', (0.92,0.92,0.92,1), 0.35, 0.0)
get_mat('Metal_Worn', (0.75,0.75,0.75,1), 0.35, 1.0)
get_mat('Rubber_Tire', (0.02,0.02,0.02,1), 0.9, 0.0)
g = get_mat('Glass', (0.85,0.92,1.0,1), 0.05, 0.0)
g.blend_method = 'BLEND'
b = g.node_tree.nodes['Principled BSDF']; b.inputs['Transmission Weight'].default_value = 1.0; b.inputs['Alpha'].default_value = 0.25; b.inputs['IOR'].default_value = 1.45
get_mat('Cockpit_Plastic', (0.05,0.05,0.055,1), 0.7, 0.0)
get_mat('Cockpit_Metal_Worn', (0.12,0.12,0.13,1), 0.5, 0.6)
get_mat('Leather_Seat', (0.45,0.28,0.15,1), 0.6, 0.0)
get_mat('Gauge_Faces', (0.05,0.05,0.05,1), 0.4, 0.0)
pb = get_mat('PropBlur', (0.12,0.12,0.12,1), 0.5, 0.0)
pb.blend_method = 'BLEND'; pb.node_tree.nodes['Principled BSDF'].inputs['Alpha'].default_value = 0.3
get_mat('Prop_Blade', (0.03,0.03,0.03,1), 0.45, 0.0)
get_mat('Cowl_Dark', (0.02,0.02,0.02,1), 0.8, 0.0)

# world HDRI
w = bpy.data.worlds.get('World') or bpy.data.worlds.new('World')
sc.world = w; w.use_nodes = True
nt = w.node_tree; nt.nodes.clear()
env = nt.nodes.new('ShaderNodeTexEnvironment')
env.image = bpy.data.images.load('/Users/samy/Documents/dev/code/aeris/public/hdri/kloofendal_48d_partly_cloudy_puresky.hdr')
bg = nt.nodes.new('ShaderNodeBackground'); bg.inputs['Strength'].default_value = 1.0
out = nt.nodes.new('ShaderNodeOutputWorld')
nt.links.new(env.outputs['Color'], bg.inputs['Color']); nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
mapn = nt.nodes.new('ShaderNodeMapping'); tc = nt.nodes.new('ShaderNodeTexCoord')
nt.links.new(tc.outputs['Generated'], mapn.inputs['Vector']); nt.links.new(mapn.outputs['Vector'], env.inputs['Vector'])
mapn.inputs['Rotation'].default_value[2] = math.radians(140)

# ground plane for renders (not exported: excluded later)
gp = new_mesh_object('_Ground', [(-60,-60,-0.9),(60,-60,-0.9),(60,60,-0.9),(-60,60,-0.9)], [(0,1,2,3)], get_mat('_GroundMat', (0.18,0.19,0.17,1), 0.9))

# camera
cam_d = bpy.data.cameras.new('RenderCam'); cam = bpy.data.objects.new('_RenderCam', cam_d)
sc.collection.objects.link(cam); sc.camera = cam; cam_d.lens = 35
sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x = 1280; sc.render.resolution_y = 720; sc.render.resolution_percentage = 100
sc.render.image_settings.file_format = 'PNG'
try:
    sc.eevee.taa_render_samples = 32
except Exception: pass
sc.view_settings.view_transform = 'AgX'
result = 'setup ok: objects=%d mats=%d' % (len(bpy.data.objects), len(bpy.data.materials))
