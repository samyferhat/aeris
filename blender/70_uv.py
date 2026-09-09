import bpy, math
BODY = ['Fuselage','Wings','Aileron_L','Aileron_R','Flap_L','Flap_R','Elevator','Rudder','Gear_L','Gear_R','Gear_Nose']
def ctx_override():
    win = bpy.context.window_manager.windows[0]
    for area in win.screen.areas:
        if area.type == 'VIEW_3D':
            region = [r for r in area.regions if r.type == 'WINDOW'][0]
            return dict(window=win, area=area, region=region)
    return dict(window=win)
def deselect():
    for o in bpy.data.objects: o.select_set(False)
def smart_uv(objs, margin=0.003, only_unmapped_mat=None):
    deselect()
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    with bpy.context.temp_override(**ctx_override()):
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        if only_unmapped_mat is not None:
            # deselect faces of the given material (they have hand-made UVs)
            bpy.ops.mesh.select_all(action='DESELECT')
            bpy.ops.object.mode_set(mode='OBJECT')
            for o in objs:
                for p in o.data.polygons:
                    p.select = o.data.materials[p.material_index].name != only_unmapped_mat
            bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=margin, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
        try:
            bpy.ops.uv.pack_islands(udim_source='CLOSEST_UDIM', rotate=True, margin_method='FRACTION', margin=margin)
        except Exception as e:
            print('pack failed', e)
        bpy.ops.object.mode_set(mode='OBJECT')
    deselect()
# body atlas (shared)
smart_uv([bpy.data.objects[n] for n in BODY], 0.004)
# individual objects
for n in ['Propeller', 'Canopy_Glass', 'Prop_Disc', 'Yoke_L', 'Seat_L', 'Seat_R', 'Cockpit_Floor', 'Cockpit_Walls', 'Rudder_Pedals', 'Throttle']:
    smart_uv([bpy.data.objects[n]], 0.01)
smart_uv([bpy.data.objects['Panel']], 0.01, only_unmapped_mat='Gauge_Faces')
print('uv done')
