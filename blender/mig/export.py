import bpy, os
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'public', 'models', 'mig29.glb')
os.makedirs(os.path.dirname(OUT), exist_ok=True)
for o in list(bpy.data.objects):
    if o.name.startswith('_'):
        bpy.data.objects.remove(o)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True,
                          export_apply=True, export_texcoords=True,
                          export_normals=True, export_materials='EXPORT',
                          export_animations=False, use_selection=False)
print('EXPORTED', OUT, os.path.getsize(OUT))
