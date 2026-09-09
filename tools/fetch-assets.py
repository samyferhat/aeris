#!/usr/bin/env python3
"""Download CC0 PBR textures + HDRIs from Poly Haven (2k) into public/."""
import json, os, urllib.request
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')
UA = {"User-Agent": "aeris-fetch/1.0"}
TEX = {
  'aerial_grass_rock': 'grass', 'aerial_rocks_02': 'cliff', 'aerial_beach_01': 'sand',
  'forest_ground_04': 'forest', 'aerial_asphalt_01': 'runway', 'brown_leather': 'leather',
  'metal_plate': 'metal', 'bark_brown_02': 'bark', 'rocky_terrain_02': 'rocky',
}
MAPS = {'Diffuse': 'diff', 'nor_gl': 'nor', 'Rough': 'rough', 'AO': 'ao', 'Displacement': 'disp'}
HDRI = ['kloofendal_48d_partly_cloudy_puresky', 'belfast_sunset_puresky', 'kloppenheim_02', 'kiara_1_dawn']

def api(path):
    return json.load(urllib.request.urlopen(urllib.request.Request(f'https://api.polyhaven.com/{path}', headers=UA)))

def get(url, dst):
    if os.path.exists(dst): return
    print('  ->', os.path.relpath(dst, ROOT))
    open(dst, 'wb').write(urllib.request.urlopen(urllib.request.Request(url, headers=UA)).read())

for asset, short in TEX.items():
    files = api(f'files/{asset}')
    d = os.path.join(ROOT, 'textures', short); os.makedirs(d, exist_ok=True)
    for key, suffix in MAPS.items():
        try: url = files[key]['2k']['jpg']['url']
        except KeyError: continue
        get(url, os.path.join(d, f'{suffix}.jpg'))
for h in HDRI:
    files = api(f'files/{h}')
    get(files['hdri']['2k']['hdr']['url'], os.path.join(ROOT, 'hdri', f'{h}.hdr'))
print('ASSETS_DONE')
