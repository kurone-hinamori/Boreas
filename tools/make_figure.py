# MPFB2(MakeHuman)で人物の素体を作り、骨格つきの glb に書き出す。
# アプリには出来上がった public/figures/*.glb だけを入れる(利用者の PC に Blender は要らない)。
#
# 使い方(Blender 5.2 と MPFB2 の拡張機能が入った PC で):
#   blender -b --python tools/make_figure.py -- <出力.glb> <gender> <age> <height> <weight> <muscle>
#   blender -b --python tools/make_figure.py -- --all public/figures
# 値はどれも 0〜1(MakeHuman のマクロの値)。身長はアプリで拡大・縮小するので、height は体の比率にだけ効く。
#
# 注意:create_human の detailed_helpers を False にすると、関節を決める補助頂点がなくなり、
#       骨格が体から 1m ほどずれる(ポーズを付けると手足が伸びる)。外さないこと。
import os
import sys

import bpy
from bl_ext.blender_org.mpfb.services.humanservice import HumanService
from bl_ext.blender_org.mpfb.services.targetservice import TargetService

# アプリで選べる素体の種類。id は public/figures/<id>.glb と src/lib/figures.ts の FIGURES に合わせる
TYPES = {
    "female_slim": (0.0, 0.4, 0.5, 0.25, 0.35),
    "female_standard": (0.0, 0.4, 0.5, 0.45, 0.45),
    "female_stocky": (0.0, 0.4, 0.5, 0.72, 0.65),
    "male_slim": (1.0, 0.4, 0.5, 0.25, 0.4),
    "male_standard": (1.0, 0.4, 0.5, 0.45, 0.55),
    "male_stocky": (1.0, 0.4, 0.5, 0.72, 0.8),
}


def make(out, gender, age, height, weight, muscle):
    # 空のシーンから始める
    bpy.ops.wm.read_factory_settings(use_empty=True)

    macro = TargetService.get_default_macro_info_dict()
    macro.update({"gender": gender, "age": age, "height": height, "weight": weight, "muscle": muscle, "proportions": 1.0})
    macro["race"] = {"asian": 0.8, "caucasian": 0.2, "african": 0.0}
    basemesh = HumanService.create_human(
        mask_helpers=True,
        detailed_helpers=True,
        extra_vertex_groups=True,
        feet_on_ground=True,
        scale=0.1,
        macro_detail_dict=macro,
    )
    TargetService.bake_targets(basemesh)
    # 指まである骨格(53本)
    rig = HumanService.add_builtin_rig(basemesh, "game_engine")

    mat = bpy.data.materials.new("figure")
    mat.diffuse_color = (0.75, 0.75, 0.75, 1)
    basemesh.data.materials.clear()
    basemesh.data.materials.append(mat)
    for p in basemesh.data.polygons:
        p.use_smooth = True

    bpy.ops.object.select_all(action="DESELECT")
    basemesh.select_set(True)
    rig.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_skins=True,
        export_animations=False,
        export_morph=False,
        export_texcoords=False,
        export_materials="EXPORT",
    )
    print("FIGURE", out, "height", round(basemesh.dimensions.z, 3))


args = sys.argv[sys.argv.index("--") + 1 :]
if args[0] == "--all":
    for name, values in TYPES.items():
        make(os.path.abspath(os.path.join(args[1], f"{name}.glb")), *values)
else:
    make(args[0], *map(float, args[1:6]))
