import bpy
tot = 0; rows = []
for o in bpy.data.objects:
    if o.type != 'MESH' or o.name.startswith('_'): continue
    t = sum(max(0, len(p.vertices) - 2) for p in o.data.polygons)
    tot += t; rows.append((t, o.name))
rows.sort(reverse=True)
print('TOTAL tris', tot)
for t, n in rows: print('  %6d %s' % (t, n))
