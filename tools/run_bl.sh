#!/bin/bash
# usage: tools/run_bl.sh blender/script.py  -> runs it inside Blender with a traceback
# The script is executed, not imported, so __file__ has to be supplied by hand: the
# build scripts use it to find their sibling helper modules.
cat > /tmp/_bl_wrap.py <<PY
import traceback
g = {'__name__': '__main__', '__file__': '$PWD/$1'}
try:
    exec(compile(open('$PWD/$1').read(), '$PWD/$1', 'exec'), g)
except Exception:
    print('TRACEBACK:\n' + traceback.format_exc())
PY
python3 tools/blender_rpc.py /tmp/_bl_wrap.py
