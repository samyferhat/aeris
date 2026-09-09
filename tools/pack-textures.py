#!/usr/bin/env python3
"""Pack terrain PBR sets into 2 textures each to stay under 16 sampler units:
   albedo.webp = diffuse * ao^0.6 ;  nrm.webp = normal.rgb + roughness in alpha."""
import os, sys
from PIL import Image, ImageChops
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'textures')
for name in sys.argv[1:] or ['grass', 'forest', 'cliff', 'sand']:
    d = os.path.join(ROOT, name)
    diff = Image.open(f'{d}/diff.jpg').convert('RGB')
    ao = Image.open(f'{d}/ao.jpg').convert('L').point(lambda v: int(255 * (v / 255) ** 0.6))
    nor = Image.open(f'{d}/nor.jpg').convert('RGB')
    rough = Image.open(f'{d}/rough.jpg').convert('L')
    albedo = ImageChops.multiply(diff, Image.merge('RGB', (ao, ao, ao)))
    albedo.save(f'{d}/albedo.webp', quality=88, method=4)
    nr = Image.merge('RGBA', (*nor.split(), rough))
    nr.save(f'{d}/nrm.webp', quality=90, method=4, lossless=False)
    print(name, os.path.getsize(f'{d}/albedo.webp') // 1024, 'KB', os.path.getsize(f'{d}/nrm.webp') // 1024, 'KB')
