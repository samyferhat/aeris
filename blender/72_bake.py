import bpy, numpy as np, os, time
OUT = '/Users/samy/Documents/dev/code/aeris/blender/textures'
BODY = ['Fuselage','Wings','Aileron_L','Aileron_R','Flap_L','Flap_R','Elevator','Rudder','Gear_L','Gear_R','Gear_Nose']
SIZE = int(globals().get('BAKE_SIZE', 2048))
AO_SAMPLES = int(globals().get('AO_SAMPLES', 64))
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices: d.use = True
    sc.cycles.device = 'GPU'
    print('cycles device: GPU/METAL')
except Exception as _e:
    sc.cycles.device = 'CPU'; print('cycles device: CPU fallback', _e)
sc.cycles.samples = 1
sc.cycles.use_denoising = False
sc.render.bake.margin = 6
sc.render.bake.use_clear = True
sc.render.bake.use_selected_to_active = False
hidden = []
for n in ('_Ground', 'Prop_Disc', 'Canopy_Glass'):
    o = bpy.data.objects.get(n)
    if o: hidden.append((o, o.hide_render)); o.hide_render = True
for i, n in enumerate(BODY): bpy.data.objects[n].pass_index = i + 1

# bake material
bm = bpy.data.materials.get('_Bake') or bpy.data.materials.new('_Bake')
bm.use_nodes = True; nt = bm.node_tree; nt.nodes.clear()
out = nt.nodes.new('ShaderNodeOutputMaterial'); em = nt.nodes.new('ShaderNodeEmission')
geo = nt.nodes.new('ShaderNodeNewGeometry'); oi = nt.nodes.new('ShaderNodeObjectInfo')
mathn = nt.nodes.new('ShaderNodeMath'); mathn.operation = 'DIVIDE'; mathn.inputs[1].default_value = 255.0
nt.links.new(oi.outputs['Object Index'], mathn.inputs[0])
tex = nt.nodes.new('ShaderNodeTexImage'); nt.nodes.active = tex; tex.select = True
nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
def make_img(name):
    old = bpy.data.images.get(name)
    if old: bpy.data.images.remove(old)
    img = bpy.data.images.new(name, SIZE, SIZE, alpha=True, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    img.generated_color = (0, 0, 0, 0)
    return img
# swap materials
saved = {}
for n in BODY:
    o = bpy.data.objects[n]; saved[n] = [s.material for s in o.material_slots]
    for s in o.material_slots: s.material = bm
def select_body():
    for o in bpy.data.objects: o.select_set(False)
    for n in BODY: bpy.data.objects[n].select_set(True)
    bpy.context.view_layer.objects.active = bpy.data.objects[BODY[0]]
def to_np(img):
    a = np.empty(SIZE*SIZE*4, dtype=np.float32); img.pixels.foreach_get(a); return a.reshape(SIZE, SIZE, 4)
results = {}
t0 = time.time()
for kind, src in (('pos', geo.outputs['Position']), ('nrm', geo.outputs['Normal']), ('idm', mathn.outputs[0])):
    for l in list(em.inputs['Color'].links): nt.links.remove(l)
    nt.links.new(src, em.inputs['Color'])
    img = make_img('_bake_' + kind); tex.image = img
    select_body()
    sc.cycles.samples = 1
    bpy.ops.object.bake(type='EMIT', use_clear=True, margin=6)
    results[kind] = to_np(img)
    print(kind, 'baked', time.time() - t0)
# AO
img = make_img('_bake_ao'); tex.image = img
sc.cycles.samples = AO_SAMPLES
sc.world.light_settings.distance = 1.2
select_body()
bpy.ops.object.bake(type='AO', use_clear=True, margin=6)
results['ao'] = to_np(img)
print('ao baked', time.time() - t0)
# restore
for n in BODY:
    o = bpy.data.objects[n]
    for s, m in zip(o.material_slots, saved[n]): s.material = m
for o, h in hidden: o.hide_render = h
for _e in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
    try:
        sc.render.engine = _e; break
    except Exception: pass
np.savez_compressed(os.path.join(OUT, 'bake_%d.npz' % SIZE), **results)
cov = float((results['pos'][..., 3] > 0.5).mean())
print('saved; coverage %.3f' % cov)
