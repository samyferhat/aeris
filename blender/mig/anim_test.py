"""Deflect every animated part by its documented axis/sign and render, to prove
the pivots and rotation conventions are right.
Blender axes:  X = left (= glTF X),  Y = aft (= glTF -Z),  Z = up (= glTF Y)
"""
import bpy, os, sys, math
from mathutils import Vector
R = math.radians
HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, 'render.py')).read().split('which = sys.argv')[0]
src = src.replace("HERE = os.path.dirname(os.path.abspath(__file__))", "HERE = %r" % HERE)
exec(src)

O = bpy.data.objects
mode = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'deflect'

if mode == 'deflect':
    # control surfaces: local X = lateral. +X rotation -> trailing edge UP
    O['Aileron_L'].rotation_euler.x = R(-20)     # TE down  -> roll right
    O['Aileron_R'].rotation_euler.x = R(20)      # TE up
    O['Flap_L'].rotation_euler.x = R(-25)
    O['Flap_R'].rotation_euler.x = R(-25)
    O['Slat_L'].rotation_euler.x = R(-18)
    O['Slat_R'].rotation_euler.x = R(-18)
    O['Stabilator_L'].rotation_euler.x = R(15)
    O['Stabilator_R'].rotation_euler.x = R(15)
    O['Airbrake'].rotation_euler.x = R(45)       # +X opens it up
    # rudders: local Z (Blender up) = glTF local Y
    O['Rudder_L'].rotation_euler.z = R(20)
    O['Rudder_R'].rotation_euler.z = R(20)
    # grilles: local X, swing shut
    O['IntakeGrille_L'].rotation_euler.x = R(-55)
    O['IntakeGrille_R'].rotation_euler.x = R(-55)
    O['Stick'].rotation_euler.x = R(-12)
    O['Throttles'].rotation_euler.x = R(-15)
elif mode == 'retract':
    # nose gear: Blender local X, -70 deg (forward+up)
    O['Gear_Nose'].rotation_euler.x = R(-70)
    O['GearDoor_Nose'].rotation_euler.y = 0.0
    # mains: Blender local Y (= glTF -Z).  glTF: Gear_L = -102 about +Z
    O['Gear_L'].rotation_euler.y = R(102)
    O['Gear_R'].rotation_euler.y = R(-102)
    O['GearDoor_L'].rotation_euler.y = 0.0
    O['GearDoor_R'].rotation_euler.y = 0.0
elif mode == 'spin':
    O['Wheel_L'].rotation_euler.x = R(35)
    O['Wheel_R'].rotation_euler.x = R(35)
    O['Wheel_Nose'].rotation_euler.x = R(35)

bpy.context.view_layer.update()
for nm, pos, tgt, lens in (
        ('anim_%s_34' % mode, (14.0, -24.0, 8.0), (0.0, 0.5, -0.40), 50),
        ('anim_%s_rear' % mode, (12.0, 24.0, 7.0), (0.0, 3.0, -0.50), 50),
        ('anim_%s_top' % mode, (0.0, 0.6, 34.0), (0.0, 0.6, -0.40), 55)):
    look(pos, tgt, lens)
    sc.render.filepath = os.path.join(HERE, 'shots', nm + '.png')
    bpy.ops.render.render(write_still=True)
    print('SHOT', nm)
print('DONE')
