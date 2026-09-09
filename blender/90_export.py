import bpy, os
GLB = '/Users/samy/Documents/dev/code/aeris/public/models/cessna.glb'
for o in bpy.data.objects: o.select_set(not o.name.startswith('_'))
for o in bpy.data.objects:
    if not o.name.startswith('_'): o.hide_render = False; o.hide_viewport = False; o.hide_set(False)
bpy.ops.export_scene.gltf(filepath=GLB, export_format='GLB', export_yup=True, export_apply=True, export_texcoords=True, export_normals=True,
    export_materials='EXPORT', export_image_format='AUTO', export_animations=False, use_selection=True, export_cameras=False, export_lights=False,
    export_extras=False, export_jpeg_quality=88, export_image_quality=88)
print('exported', os.path.getsize(GLB) / 1e6, 'MB')
