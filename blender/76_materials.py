import bpy, os
TX = '/Users/samy/Documents/dev/code/aeris/blender/textures'
PUB = '/Users/samy/Documents/dev/code/aeris/public/textures'
def load(path, noncolor):
    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = 'Non-Color' if noncolor else 'sRGB'
    return img
def gltf_group():
    ng = bpy.data.node_groups.get('glTF Material Output')
    if ng is None:
        ng = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
        ng.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
        ng.nodes.new('NodeGroupInput')
    return ng
def setup(name, base=None, base_img=None, rough=0.5, rough_img=None, metal=0.0, metal_img=None, normal_img=None, normal_strength=1.0,
          orm_img=None, alpha=1.0, blend=False, emission=None, coat=0.0):
    m = bpy.data.materials[name]; m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); out.location = (600, 0)
    b = nt.nodes.new('ShaderNodeBsdfPrincipled'); b.location = (250, 0)
    nt.links.new(b.outputs['BSDF'], out.inputs['Surface'])
    if base is not None: b.inputs['Base Color'].default_value = (*base, 1)
    b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    b.inputs['Alpha'].default_value = alpha
    if coat > 0: b.inputs['Coat Weight'].default_value = coat; b.inputs['Coat Roughness'].default_value = 0.03
    if emission is not None:
        b.inputs['Emission Color'].default_value = (*emission, 1); b.inputs['Emission Strength'].default_value = 2.0
    y = 300
    def tex(img):
        nonlocal y
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = img; t.location = (-400, y); y -= 300; return t
    if base_img: nt.links.new(tex(base_img).outputs['Color'], b.inputs['Base Color'])
    if orm_img:
        t = tex(orm_img); sep = nt.nodes.new('ShaderNodeSeparateColor'); sep.location = (-100, t.location.y)
        nt.links.new(t.outputs['Color'], sep.inputs['Color'])
        nt.links.new(sep.outputs['Green'], b.inputs['Roughness']); nt.links.new(sep.outputs['Blue'], b.inputs['Metallic'])
        g = nt.nodes.new('ShaderNodeGroup'); g.node_tree = gltf_group(); g.location = (250, -500)
        nt.links.new(sep.outputs['Red'], g.inputs['Occlusion'])
    if rough_img: nt.links.new(tex(rough_img).outputs['Color'], b.inputs['Roughness'])
    if metal_img: nt.links.new(tex(metal_img).outputs['Color'], b.inputs['Metallic'])
    if normal_img:
        t = tex(normal_img); nm = nt.nodes.new('ShaderNodeNormalMap'); nm.location = (-100, t.location.y); nm.inputs['Strength'].default_value = normal_strength
        nt.links.new(t.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    m.blend_method = 'BLEND' if blend else 'OPAQUE'
    try: m.surface_render_method = 'BLENDED' if blend else 'DITHERED'
    except Exception: pass
    m.use_backface_culling = False
    return m
setup('Paint_Body', base_img=load(TX + '/body_albedo.png', False), orm_img=load(TX + '/body_orm.png', True), normal_img=load(TX + '/body_normal.png', True), coat=0.5)
setup('Metal_Worn', base_img=load(PUB + '/metal/diff.jpg', False), rough_img=load(PUB + '/metal/rough.jpg', True), metal=1.0, normal_img=load(PUB + '/metal/nor.jpg', True), normal_strength=0.6)
setup('Rubber_Tire', base=(0.02, 0.02, 0.02), rough=0.9, normal_img=load(TX + '/tire_normal.png', True), normal_strength=1.0)
setup('Leather_Seat', base_img=load(PUB + '/leather/diff.jpg', False), rough_img=load(PUB + '/leather/rough.jpg', True), normal_img=load(PUB + '/leather/nor.jpg', True), normal_strength=0.8)
setup('Cockpit_Metal_Worn', base_img=load(TX + '/cockpit_metal.png', False), rough=0.5, metal=0.7, normal_img=load(PUB + '/metal/nor.jpg', True), normal_strength=0.4)
setup('Gauge_Faces', base_img=load(TX + '/gauges.png', False), rough=0.35)
setup('Cockpit_Plastic', base=(0.05, 0.05, 0.055), rough=0.7)
setup('Glass', base=(0.75, 0.85, 0.95), rough=0.05, alpha=0.25, blend=True)
setup('PropBlur', base=(0.12, 0.12, 0.12), rough=0.5, alpha=0.3, blend=True)
setup('Prop_Blade', base=(0.03, 0.03, 0.03), rough=0.45)
setup('Prop_Tip', base=(0.95, 0.75, 0.05), rough=0.45)
setup('Cowl_Dark', base=(0.02, 0.02, 0.02), rough=0.8)
setup('Lens', base=(0.9, 0.9, 0.9), rough=0.1, metal=0.8)
setup('Cockpit_Trim', base=(0.42, 0.40, 0.36), rough=0.85)
setup('Cockpit_Carpet', base=(0.12, 0.11, 0.10), rough=0.95)
setup('Light_Red', base=(0.9, 0.05, 0.05), rough=0.2, emission=(1, 0.05, 0.05))
setup('Light_Green', base=(0.05, 0.9, 0.2), rough=0.2, emission=(0.05, 1, 0.2))
setup('Light_White', base=(1, 1, 1), rough=0.2, emission=(1, 1, 1))
print('materials done')
