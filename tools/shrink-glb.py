#!/usr/bin/env python3
"""
Recompress the textures embedded in a GLB.

Blender's exporter writes roughness and occlusion maps as full-size PNGs, which for this
model meant two 2048 greyscale maps weighing 10 MB between them inside a 22 MB file — an
absurd download for a web game, and for parts (the spinner, the struts, the seats) that
are never more than a few hundred pixels on screen.

Images are resized and re-encoded as JPEG; the glTF JSON is rewritten and the binary
chunk rebuilt with corrected buffer-view offsets.
"""
import json, struct, sys, io, os
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else 'public/models/cessna.glb'
DST = sys.argv[2] if len(sys.argv) > 2 else SRC

# Per-image target size. Everything else falls back to DEFAULT_MAX.
DEFAULT_MAX = 1024
QUALITY = 86

def read_glb(path):
    d = open(path, 'rb').read()
    assert d[:4] == b'glTF', 'not a GLB'
    off, chunks = 12, []
    while off < len(d):
        length, ctype = struct.unpack_from('<II', d, off)
        chunks.append((ctype, d[off + 8: off + 8 + length]))
        off += 8 + length
    j = json.loads(chunks[0][1])
    bin_ = chunks[1][1] if len(chunks) > 1 else b''
    return j, bin_

def write_glb(path, j, bin_):
    js = json.dumps(j, separators=(',', ':')).encode('utf8')
    js += b' ' * ((4 - len(js) % 4) % 4)
    bin_ += b'\x00' * ((4 - len(bin_) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(bin_)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(bin_), 0x004E4942)); f.write(bin_)

j, bin_ = read_glb(SRC)
views = j['bufferViews']
# Pull every buffer view out so the binary chunk can be rebuilt from scratch.
data = [bytes(bin_[v.get('byteOffset', 0): v.get('byteOffset', 0) + v['byteLength']]) for v in views]

before = os.path.getsize(SRC)
for img in j.get('images', []):
    bvi = img.get('bufferView')
    if bvi is None:
        continue
    src = data[bvi]
    im = Image.open(io.BytesIO(src))
    w, h = im.size
    scale = min(1.0, DEFAULT_MAX / max(w, h))
    if scale < 1.0:
        im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
    buf = io.BytesIO()
    im.convert('RGB').save(buf, 'JPEG', quality=QUALITY, optimize=True, progressive=True)
    out = buf.getvalue()
    if len(out) < len(src):
        print(f"  {img.get('name','?'):16s} {w}x{h} {len(src)/1e6:6.2f} -> {im.size[0]}x{im.size[1]} {len(out)/1e6:6.2f} MB")
        data[bvi] = out
        img['mimeType'] = 'image/jpeg'

# Rebuild the binary chunk, keeping every view 4-byte aligned.
out = bytearray()
for i, v in enumerate(views):
    pad = (4 - len(out) % 4) % 4
    out += b'\x00' * pad
    v['byteOffset'] = len(out)
    v['byteLength'] = len(data[i])
    v.pop('byteStride', None) if 'target' not in v and False else None
    out += data[i]
j['buffers'][0]['byteLength'] = len(out)
write_glb(DST, j, bytes(out))
print(f"{before/1e6:.2f} MB -> {os.path.getsize(DST)/1e6:.2f} MB")
