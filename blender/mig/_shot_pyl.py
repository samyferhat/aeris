import bpy, os, sys
HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)))
sys.argv = ['blender', '--', 'low34', 'front']
exec(compile(open(os.path.join(HERE, 'render.py')).read(), 'render.py', 'exec'),
     {'__name__': '__main__', '__file__': os.path.join(HERE, 'render.py')})
