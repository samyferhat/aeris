#!/usr/bin/env python3
"""Tiny client for the blender-mcp addon socket (port 9876).
Usage: python3 tools/blender_rpc.py script.py   -> runs the file inside Blender via execute_code
       python3 tools/blender_rpc.py --cmd get_scene_info
"""
import json, socket, sys

def call(cmd_type, params=None, timeout=600):
    s = socket.create_connection(('localhost', 9876), timeout=timeout)
    s.sendall(json.dumps({"type": cmd_type, "params": params or {}}).encode())
    buf = b''
    while True:
        chunk = s.recv(65536)
        if not chunk: break
        buf += chunk
        try: return json.loads(buf.decode())
        except json.JSONDecodeError: continue
    return json.loads(buf.decode())

if __name__ == '__main__':
    if sys.argv[1] == '--cmd':
        print(json.dumps(call(sys.argv[2], json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}), indent=1)[:4000])
    else:
        code = open(sys.argv[1]).read()
        r = call('execute_code', {'code': code})
        if r.get('status') != 'success': print('BLENDER_ERROR:', r.get('message')); sys.exit(1)
        print(r['result'].get('result', '') or r['result'])
