import bpy
names = sorted(o.name for o in bpy.data.objects if o.name.startswith(('Pylon','Store_','Gun_','Flare_','GunPort')))
print('HARDPOINTS', names)
for n in names:
    o = bpy.data.objects[n]
    print(n, [round(v,3) for v in o.matrix_world.translation], o.parent.name if o.parent else None)
