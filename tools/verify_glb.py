import json, struct, sys
p = sys.argv[1] if len(sys.argv) > 1 else 'public/models/cessna.glb'
b = open(p, 'rb').read()
magic, ver, length = struct.unpack('<III', b[:12])
off = 12; chunks = []
while off < length:
    cl, ct = struct.unpack('<II', b[off:off+8]); chunks.append((ct, b[off+8:off+8+cl])); off += 8 + cl
g = json.loads(chunks[0][1])
bin_ = chunks[1][1]
nodes = g['nodes']; names = [n.get('name') for n in nodes]
tris = 0
for m in g['meshes']:
    for pr in m['primitives']:
        mode = pr.get('mode', 4)
        cnt = g['accessors'][pr['indices']]['count'] if 'indices' in pr else g['accessors'][pr['attributes']['POSITION']]['count']
        tris += cnt // 3 if mode == 4 else 0
print('file MB %.2f  nodes %d  meshes %d  materials %d  triangles %d' % (len(b)/1e6, len(nodes), len(g['meshes']), len(g['materials']), tris))
print('materials:', [m['name'] for m in g['materials']])
print('extensions:', g.get('extensionsUsed'))
imgs = g.get('images', [])
for i, im in enumerate(imgs):
    bv = g['bufferViews'][im['bufferView']]; print('  image %d %s %s %.2f MB' % (i, im.get('name'), im.get('mimeType'), bv['byteLength']/1e6))
req = ['Cessna','Fuselage','Aileron_L','Aileron_R','Flap_L','Flap_R','Elevator','Rudder','Propeller','Prop_Disc','Gear_Nose','Gear_L','Gear_R','Wheel_Nose','Wheel_L','Wheel_R','Canopy_Glass','Panel','Yoke_L','Seat_L','Seat_R','Cockpit_Floor','Cockpit_Walls','Rudder_Pedals','Throttle','Camera_Pilot','Exhaust','Wingtip_L','Wingtip_R','Contact_Nose','Contact_L','Contact_R','Nav_L','Nav_R','Beacon','Strobe_Tail']
missing = [r for r in req if r not in names]
print('missing:', missing, ' wings:', [n for n in names if n.startswith('Wing')])
# hierarchy + transforms
children = {}
for i, n in enumerate(nodes):
    for c in n.get('children', []): children[c] = i
def path(i):
    out = [names[i]]
    while i in children: i = children[i]; out.append(names[i])
    return '/'.join(reversed(out))
for i, n in enumerate(nodes):
    t = n.get('translation', [0,0,0]); r = n.get('rotation', [0,0,0,1])
    print('  %-45s t=(%.3f, %.3f, %.3f) q=(%.3f, %.3f, %.3f, %.3f) mesh=%s' % (path(i), *t, *r, n.get('mesh')))
for m in g['materials']:
    pbr = m.get('pbrMetallicRoughness', {})
    print('  mat %-20s base=%s baseTex=%s mrTex=%s normal=%s occl=%s alpha=%s ext=%s' % (m['name'], [round(v,2) for v in pbr.get('baseColorFactor', [1,1,1,1])], 'baseColorTexture' in pbr, 'metallicRoughnessTexture' in pbr, 'normalTexture' in m, 'occlusionTexture' in m, m.get('alphaMode', 'OPAQUE'), list(m.get('extensions', {}).keys())))
