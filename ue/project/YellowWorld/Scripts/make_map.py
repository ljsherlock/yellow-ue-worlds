"""Generate the spike level headlessly.

Run inside the dev-5.7 container via the editor commandlet (no GUI):

    UnrealEditor-Cmd YellowWorld.uproject \
        -run=pythonscript -script="Scripts/make_map.py" \
        -unattended -nullrhi

It builds /Game/Maps/Spike with: a ground plane, a sun (DirectionalLight), a
SkyAtmosphere + SkyLight so the sky renders, an AWorldDirector (the brain's
control surface), and a PlayerStart. Idempotent — re-running recreates the map.
"""

import unreal

LEVEL_PACKAGE = "/Game/Maps/Spike"


def _spawn(actor_subsystem, actor_class, location, rotation=None):
    rotation = rotation or unreal.Rotator(0.0, 0.0, 0.0)
    return actor_subsystem.spawn_actor_from_class(actor_class, location, rotation)


def main():
    level_subsystem = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    actor_subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)

    # Idempotent: drop any previous Spike level so new_level doesn't fail with
    # "An asset already exists at this location".
    if unreal.EditorAssetLibrary.does_asset_exist(LEVEL_PACKAGE):
        unreal.EditorAssetLibrary.delete_asset(LEVEL_PACKAGE)

    # Fresh, empty level.
    if not level_subsystem.new_level(LEVEL_PACKAGE):
        raise RuntimeError("new_level failed for " + LEVEL_PACKAGE)

    # Ground plane (scaled up engine primitive).
    floor = _spawn(actor_subsystem, unreal.StaticMeshActor, unreal.Vector(0, 0, 0))
    plane = unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/Plane")
    if plane:
        floor.static_mesh_component.set_static_mesh(plane)
        floor.set_actor_scale3d(unreal.Vector(50.0, 50.0, 1.0))

    # Sun. MOVABLE so it lights dynamically (no lightmap bake) and so
    # WorldDirector.SetSkyState can rotate it at runtime and have lighting
    # actually update (Static lights wouldn't change without a rebuild).
    sun = _spawn(actor_subsystem, unreal.DirectionalLight,
                 unreal.Vector(0, 0, 1000), unreal.Rotator(-35.0, 0.0, 0.0))
    sun.root_component.set_editor_property("mobility", unreal.ComponentMobility.MOVABLE)

    # Sky so the stream shows something recognisable.
    _spawn(actor_subsystem, unreal.SkyAtmosphere, unreal.Vector(0, 0, 0))

    # Movable sky light with real-time capture so it picks up the atmosphere
    # dynamically (Lumen handles GI; nothing needs baking).
    skylight = _spawn(actor_subsystem, unreal.SkyLight, unreal.Vector(0, 0, 500))
    skylight.root_component.set_editor_property("mobility", unreal.ComponentMobility.MOVABLE)
    skylight.root_component.set_editor_property("real_time_capture", True)

    # The brain's control surface.
    _spawn(actor_subsystem, unreal.WorldDirector, unreal.Vector(0, 0, 200))

    # Somewhere for the streamed view to spawn.
    _spawn(actor_subsystem, unreal.PlayerStart,
           unreal.Vector(-800, 0, 300), unreal.Rotator(-15.0, 0.0, 0.0))

    if not level_subsystem.save_current_level():
        raise RuntimeError("save_current_level failed for " + LEVEL_PACKAGE)
    unreal.log("[make_map] saved " + LEVEL_PACKAGE)


if __name__ == "__main__":
    main()
