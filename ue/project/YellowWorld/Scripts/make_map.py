"""Generate the spike level headlessly.

Run inside the dev-5.7 container via the editor commandlet (no GUI):

    UnrealEditor-Cmd YellowWorld.uproject \
        -run=pythonscript -script="Scripts/make_map.py" \
        -unattended -nullrhi

It builds /Game/Maps/Spike with the full Tier-1 control surface:
  - a ground plane with a procedural sand material (no imported assets),
  - a sun (DirectionalLight) + SkyAtmosphere + SkyLight,
  - ExponentialHeightFog, VolumetricCloud, WindDirectionalSource,
  - an unbound PostProcessVolume (global colour grade),
  - a CameraActor for framing,
  - an AWorldDirector (the brain's control surface),
  - a PlayerStart.
Every actor is spawned movable so AWorldDirector can drive it at runtime.
Idempotent — re-running recreates the map and material.
"""

import unreal

LEVEL_PACKAGE = "/Game/Maps/Spike"
GROUND_MATERIAL = "/Game/Materials/M_Ground"


def _spawn(actor_subsystem, actor_class, location, rotation=None):
    rotation = rotation or unreal.Rotator(0.0, 0.0, 0.0)
    return actor_subsystem.spawn_actor_from_class(actor_class, location, rotation)


def _make_ground_material():
    """Procedural sand material with a 'BaseColor' VectorParameter.

    The parameter name matches AWorldDirector::SetGroundColor, which recolours
    the ground at runtime via a dynamic material instance. No texture assets
    required — this is a flat PBR sand we can tint dry/green on demand.
    """
    if unreal.EditorAssetLibrary.does_asset_exist(GROUND_MATERIAL):
        unreal.EditorAssetLibrary.delete_asset(GROUND_MATERIAL)

    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    mat = asset_tools.create_asset(
        "M_Ground", "/Game/Materials", unreal.Material, unreal.MaterialFactoryNew()
    )
    mel = unreal.MaterialEditingLibrary

    base_color = mel.create_material_expression(
        mat, unreal.MaterialExpressionVectorParameter, -600, 0
    )
    base_color.set_editor_property("parameter_name", "BaseColor")
    # Warm dry savanna sand.
    base_color.set_editor_property(
        "default_value", unreal.LinearColor(0.52, 0.42, 0.26, 1.0)
    )
    mel.connect_material_property(
        base_color, "", unreal.MaterialProperty.MP_BASE_COLOR
    )

    roughness = mel.create_material_expression(
        mat, unreal.MaterialExpressionScalarParameter, -600, 220
    )
    roughness.set_editor_property("parameter_name", "Roughness")
    roughness.set_editor_property("default_value", 0.92)
    mel.connect_material_property(
        roughness, "", unreal.MaterialProperty.MP_ROUGHNESS
    )

    mel.recompile_material(mat)
    unreal.EditorAssetLibrary.save_asset(GROUND_MATERIAL)
    return mat


def main():
    level_subsystem = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    actor_subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)

    # Idempotent: drop any previous Spike level so new_level doesn't fail with
    # "An asset already exists at this location".
    if unreal.EditorAssetLibrary.does_asset_exist(LEVEL_PACKAGE):
        unreal.EditorAssetLibrary.delete_asset(LEVEL_PACKAGE)

    # Build the ground material before we need it.
    ground_material = _make_ground_material()

    # Fresh, empty level.
    if not level_subsystem.new_level(LEVEL_PACKAGE):
        raise RuntimeError("new_level failed for " + LEVEL_PACKAGE)

    # Ground plane (scaled up engine primitive) with the procedural sand material.
    # Tagged "ground" so AWorldDirector can find it and recolour it at runtime.
    floor = _spawn(actor_subsystem, unreal.StaticMeshActor, unreal.Vector(0, 0, 0))
    plane = unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/Plane")
    if plane:
        floor.static_mesh_component.set_static_mesh(plane)
        floor.set_actor_scale3d(unreal.Vector(80.0, 80.0, 1.0))
    if ground_material:
        floor.static_mesh_component.set_material(0, ground_material)
    floor.set_editor_property("tags", ["ground"])

    # Sun. MOVABLE so it lights dynamically (no lightmap bake) and so the
    # WorldDirector sun/time verbs update lighting live.
    sun = _spawn(actor_subsystem, unreal.DirectionalLight,
                 unreal.Vector(0, 0, 1000), unreal.Rotator(-35.0, -45.0, 0.0))
    sun.root_component.set_editor_property("mobility", unreal.ComponentMobility.MOVABLE)

    # Sky so the stream shows something recognisable.
    _spawn(actor_subsystem, unreal.SkyAtmosphere, unreal.Vector(0, 0, 0))

    # Movable sky light with real-time capture so it picks up the atmosphere
    # dynamically (Lumen handles GI; nothing needs baking).
    skylight = _spawn(actor_subsystem, unreal.SkyLight, unreal.Vector(0, 0, 500))
    skylight.root_component.set_editor_property("mobility", unreal.ComponentMobility.MOVABLE)
    skylight.root_component.set_editor_property("real_time_capture", True)

    # Height fog — driven by SetFog / SetFogColor / SetVolumetricFog.
    _spawn(actor_subsystem, unreal.ExponentialHeightFog, unreal.Vector(0, 0, 200))

    # Volumetric clouds (uses the engine default cloud material) — toggled by
    # SetCloudiness.
    _spawn(actor_subsystem, unreal.VolumetricCloud, unreal.Vector(0, 0, 5000))

    # Wind source — driven by SetWind (foliage/cloth react to it later).
    _spawn(actor_subsystem, unreal.WindDirectionalSource, unreal.Vector(0, 0, 1500))

    # Global (unbound) post-process volume — driven by SetExposure / SetColorGrade.
    ppv = _spawn(actor_subsystem, unreal.PostProcessVolume, unreal.Vector(0, 0, 0))
    ppv.set_editor_property("unbound", True)

    # Framing camera — driven by SetCameraView / SetCameraFOV.
    _spawn(actor_subsystem, unreal.CameraActor,
           unreal.Vector(-1200, 0, 400), unreal.Rotator(-10.0, 0.0, 0.0))

    # The brain's control surface. Log its object path so we can confirm the
    # Remote Control target (rc-bridge defaults to ...PersistentLevel.WorldDirector_0).
    world_director = _spawn(actor_subsystem, unreal.WorldDirector, unreal.Vector(0, 0, 200))
    unreal.log("[make_map] WorldDirector name=" + world_director.get_name()
               + " path=" + world_director.get_path_name())

    # Somewhere for the streamed view to spawn.
    _spawn(actor_subsystem, unreal.PlayerStart,
           unreal.Vector(-800, 0, 300), unreal.Rotator(-15.0, 0.0, 0.0))

    if not level_subsystem.save_current_level():
        raise RuntimeError("save_current_level failed for " + LEVEL_PACKAGE)
    unreal.log("[make_map] saved " + LEVEL_PACKAGE)


if __name__ == "__main__":
    main()
