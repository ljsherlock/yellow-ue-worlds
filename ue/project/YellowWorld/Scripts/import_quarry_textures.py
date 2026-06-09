"""Import Megascans quarry JPGs into /Game/Textures/Quarry.

Must NOT run with -nullrhi: AssetTools.ImportAssetTasks needs Slate
(CurrentApplication). The build runs this under xvfb-run without -nullrhi,
then make_map.py (nullrhi) only loads the saved .uassets.

  xvfb-run -a UnrealEditor-Cmd YellowWorld.uproject \\
      -run=pythonscript -script=Scripts/import_quarry_textures.py \\
      -unattended -nosplash -nopause
"""

import glob
import os

import unreal

TEXTURE_DEST = "/Game/Textures/Quarry"
QUARRY_DIR = os.path.normpath(
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "ThirdParty",
        "Megascans",
        "south_african_slate_quarry",
        "uddmcgbia",
    )
)


def _find_map(directory, map_name):
    for pattern in (
        os.path.join(directory, f"*_{map_name}.jpg"),
        os.path.join(directory, f"*_{map_name}.png"),
    ):
        hits = sorted(glob.glob(pattern))
        if hits:
            return hits[0]
    return None


def _import_file(file_path, asset_name):
    dest = f"{TEXTURE_DEST}/{asset_name}"
    if unreal.EditorAssetLibrary.does_asset_exist(dest):
        unreal.EditorAssetLibrary.delete_asset(dest)

    task = unreal.AssetImportTask()
    task.filename = file_path
    task.destination_path = TEXTURE_DEST
    task.destination_name = asset_name
    task.automated = True
    task.save = True
    task.replace_existing = True
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    return unreal.EditorAssetLibrary.load_asset(dest)


def _configure_texture(tex, map_name):
    if tex is None:
        return
    if map_name == "Normal":
        tex.set_editor_property(
            "compression_settings", unreal.TextureCompressionSettings.TC_NORMALMAP
        )
        tex.set_editor_property("srgb", False)
    elif map_name in ("Roughness", "AO"):
        tex.set_editor_property("srgb", False)
    else:
        tex.set_editor_property("srgb", True)
    unreal.EditorAssetLibrary.save_asset(tex.get_path_name())


def main():
    if not os.path.isdir(QUARRY_DIR):
        unreal.log("[import_quarry] no ThirdParty dir — nothing to import")
        return

    required = ("Basecolor", "Normal", "Roughness")
    paths = {}
    for map_name in list(required) + ["AO"]:
        path = _find_map(QUARRY_DIR, map_name)
        if path:
            paths[map_name] = path

    for req in required:
        if req not in paths:
            unreal.log_error("[import_quarry] missing " + req)
            raise RuntimeError("missing quarry map: " + req)

    for map_name, path in paths.items():
        tex = _import_file(path, "uddmcgbia_" + map_name)
        _configure_texture(tex, map_name)
        unreal.log("[import_quarry] imported " + map_name + " from " + path)

    unreal.log("[import_quarry] done — uassets under " + TEXTURE_DEST)


if __name__ == "__main__":
    main()
