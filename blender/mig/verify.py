import json, struct, sys, os
p = sys.argv[1] if len(sys.argv) > 1 else 'public/models/mig29.glb'
b = open(p, 'rb').read()
magic, ver, length = struct.unpack('<III', b[:12])
off = 12
chunks = []
while off < length:
    cl, ct = struct.unpack('<II', b[off:off + 8])
    chunks.append((ct, b[off + 8:off + 8 + cl]))
    off += 8 + cl
g = json.loads(chunks[0][1])
nodes = g['nodes']
names = [n.get('name') for n in nodes]
tris = 0
for m in g['meshes']:
    for pr in m['primitives']:
        if pr.get('mode', 4) != 4:
            continue
        acc = pr['indices'] if 'indices' in pr else pr['attributes']['POSITION']
        tris += g['accessors'][acc]['count'] // 3
print('file %.2f MB  nodes %d  meshes %d  materials %d  images %d  TRIANGLES %d'
      % (len(b) / 1e6, len(nodes), len(g['meshes']), len(g.get('materials', [])),
         len(g.get('images', [])), tris))
print('materials:', sorted(m['name'] for m in g.get('materials', [])))

REQ = ['Mig29', 'Fuselage', 'Wing_L', 'Wing_R', 'Aileron_L', 'Aileron_R',
       'Flap_L', 'Flap_R', 'Slat_L', 'Slat_R', 'Stabilator_L', 'Stabilator_R',
       'Rudder_L', 'Rudder_R', 'Airbrake', 'Fin_L', 'Fin_R', 'Nozzle_L',
       'Nozzle_R', 'Canopy_Glass', 'Canopy_Frame', 'Gear_Nose', 'Gear_L',
       'Gear_R', 'Wheel_Nose', 'Wheel_L', 'Wheel_R', 'GearDoor_Nose',
       'GearDoor_L', 'GearDoor_R', 'IntakeGrille_L', 'IntakeGrille_R',
       'Cockpit', 'Panel', 'HUD_Glass', 'Console_L', 'Console_R', 'Stick',
       'Throttles', 'Seat', 'Rudder_Pedals', 'Cockpit_Tub', 'Camera_Pilot',
       'Nozzle_Exit_L', 'Nozzle_Exit_R', 'Wingtip_L', 'Wingtip_R', 'LERX_L',
       'LERX_R', 'Contact_Nose', 'Contact_L', 'Contact_R', 'Nav_L', 'Nav_R',
       'Beacon', 'Strobe_Tail']
missing = [r for r in REQ if r not in names]
print('MISSING:', missing if missing else 'none')
extra = [n for n in names if n not in REQ]
print('extra nodes:', extra)

children = {}
for i, n in enumerate(nodes):
    for c in n.get('children', []):
        children[c] = i


def path(i):
    out = [names[i]]
    while i in children:
        i = children[i]
        out.append(names[i])
    return '/'.join(reversed(out))


def world(i):
    t = [0.0, 0.0, 0.0]
    while True:
        tr = nodes[i].get('translation', [0, 0, 0])
        t = [a + b for a, b in zip(t, tr)]
        if i in children:
            i = children[i]
        else:
            return t


print('\n--- hierarchy (glTF space: +X left, +Y up, +Z nose) ---')
for i, n in enumerate(nodes):
    w = world(i)
    print('  %-42s world=(%7.3f,%7.3f,%7.3f)  mesh=%s'
          % (path(i), w[0], w[1], w[2], 'y' if 'mesh' in n else '-'))

# bounding box from POSITION accessor min/max, in glTF space
lo = [1e9] * 3
hi = [-1e9] * 3
for i, n in enumerate(nodes):
    if 'mesh' not in n:
        continue
    w = world(i)
    for pr in g['meshes'][n['mesh']]['primitives']:
        a = g['accessors'][pr['attributes']['POSITION']]
        for k in range(3):
            lo[k] = min(lo[k], a['min'][k] + w[k])
            hi[k] = max(hi[k], a['max'][k] + w[k])
print('\nbbox lo=%s hi=%s  size=(L%.2f  H%.2f  span%.2f)'
      % ([round(v, 3) for v in lo], [round(v, 3) for v in hi],
         hi[2] - lo[2], hi[1] - lo[1], hi[0] - lo[0]))
