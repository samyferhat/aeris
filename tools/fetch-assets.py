#!/usr/bin/env python3
"""
Fetch and prepare the CC0 assets the game needs, from Poly Haven.

Only what is actually used is downloaded, and the terrain sets are packed two-per-set
straight away — the raw four-map sets are inputs to the packing step, never shipped.

  albedo.webp = diffuse x AO^0.6   (sRGB)
  nrm.webp    = normal.rgb + roughness in alpha

Run from the project root:  python3 tools/fetch-assets.py
"""
import io, json, os, urllib.request
from PIL import Image, ImageChops

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')
UA = {'User-Agent': 'aeris-fetch/1.0'}

# Terrain layers: downloaded, packed, then the sources are discarded.
PACKED = {
    'aerial_grass_rock': 'grass',
    'forest_ground_04': 'forest',
    'rock_face_03': 'rockface',
    'aerial_beach_01': 'sand',
    'aerial_rocks_04': 'scree',
}
# The runway keeps separate maps because its material uses three.js' standard slots.
RAW = {'aerial_asphalt_01': 'runway'}
# Night sky: stars, milky way and moon, used both as a backdrop and as the night IBL.
HDRI = ['kloppenheim_02']

MAPS = {'Diffuse': 'diff', 'nor_gl': 'nor', 'Rough': 'rough', 'AO': 'ao'}
SIZE = 2048          # working resolution before packing
RUNWAY_SIZE = 1024   # shipped resolution for the runway maps


def api(path):
    return json.load(urllib.request.urlopen(urllib.request.Request(f'https://api.polyhaven.com/{path}', headers=UA)))


def fetch(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA)).read()


def maps_for(asset):
    files = api(f'files/{asset}')
    out = {}
    for key, short in MAPS.items():
        try:
            url = files[key]['2k']['jpg']['url']
        except KeyError:
            continue
        out[short] = Image.open(io.BytesIO(fetch(url)))
    return out


def main():
    for asset, name in PACKED.items():
        d = os.path.join(ROOT, 'textures', name)
        os.makedirs(d, exist_ok=True)
        if os.path.exists(os.path.join(d, 'albedo.webp')) and os.path.exists(os.path.join(d, 'nrm.webp')):
            print(f'{name}: already packed'); continue
        print(f'{name}: downloading')
        m = maps_for(asset)
        diff = m['diff'].convert('RGB')
        ao = m['ao'].convert('L').point(lambda v: int(255 * (v / 255) ** 0.6)) if 'ao' in m else None
        albedo = ImageChops.multiply(diff, Image.merge('RGB', (ao, ao, ao))) if ao else diff
        albedo.save(os.path.join(d, 'albedo.webp'), quality=88, method=4)
        nor = m['nor'].convert('RGB')
        rough = m['rough'].convert('L') if 'rough' in m else Image.new('L', nor.size, 200)
        Image.merge('RGBA', (*nor.split(), rough)).save(os.path.join(d, 'nrm.webp'), quality=90, method=4)
        print(f'  packed {name}')

    for asset, name in RAW.items():
        d = os.path.join(ROOT, 'textures', name)
        os.makedirs(d, exist_ok=True)
        if os.path.exists(os.path.join(d, 'diff.jpg')):
            print(f'{name}: already present'); continue
        print(f'{name}: downloading')
        for short, im in maps_for(asset).items():
            im = im.convert('RGB').resize((RUNWAY_SIZE, RUNWAY_SIZE), Image.LANCZOS)
            im.save(os.path.join(d, f'{short}.jpg'), quality=86, optimize=True, progressive=True)

    os.makedirs(os.path.join(ROOT, 'hdri'), exist_ok=True)
    for h in HDRI:
        dst = os.path.join(ROOT, 'hdri', f'{h}.hdr')
        if os.path.exists(dst):
            print(f'{h}: already present'); continue
        print(f'{h}: downloading')
        open(dst, 'wb').write(fetch(api(f'files/{h}')['hdri']['2k']['hdr']['url']))

    print('assets ready')


if __name__ == '__main__':
    main()
