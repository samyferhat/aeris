#!/bin/bash
# usage: tools/run_bl.sh blender/script.py  -> runs with traceback capture
cat > /tmp/_bl_wrap.py <<PY
import traceback, sys
try:
    exec(compile(open('$PWD/$1').read(), '$1', 'exec'), {'__name__': '__main__'})
except Exception:
    print('TRACEBACK:\n' + traceback.format_exc())
PY
python3 tools/blender_rpc.py /tmp/_bl_wrap.py
