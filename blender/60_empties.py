import bpy, sys, importlib
sys.path.insert(0, '/Users/samy/Documents/dev/code/aeris/blender')
import lib_geo; importlib.reload(lib_geo)
from lib_geo import *
root = bpy.data.objects['Cessna']
E = {
 'Camera_Pilot': (-0.25, 0.05, 0.68),
 'Exhaust': (0.21, -1.40, -0.41),
 'Wingtip_L': (-5.50, 0.10, 1.166), 'Wingtip_R': (5.50, 0.10, 1.166),
 'Contact_Nose': (0, -1.25, -0.90), 'Contact_L': (-1.25, 0.55, -0.90), 'Contact_R': (1.25, 0.55, -0.90),
 'Nav_L': (-5.52, 0.06, 1.15), 'Nav_R': (5.52, 0.06, 1.15),
 'Beacon': (0, 5.32, 1.86), 'Strobe_Tail': (0, 5.95, 0.36),
}
for n, loc in E.items():
    new_empty(n, loc, parent=root, size=0.12)
print('empties ok')
