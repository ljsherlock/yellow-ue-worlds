"""Generate the spike level headlessly.

Run inside the dev-5.7 container via the editor commandlet (no GUI):

    UnrealEditor-Cmd YellowWorld.uproject \
        -run=pythonscript -script="Scripts/make_map.py" \
        -unattended -nullrhi

Stage Megascans ground textures first (on your Mac):

    bash Scripts/stage_quarry_ground.sh

It builds /Game/Maps/Spike with the full Tier-1 control surface:
  - a ground plane with Megascans South African Slate Quarry surface (uddmcgbia)
    when ThirdParty/ is present, else procedural sand,
  - a sun (DirectionalLight) + SkyAtmosphere + SkyLight,
  - ExponentialHeightFog, VolumetricCloud, WindDirectionalSource,
  - an unbound PostProcessVolume (global colour grade),
  - a CameraActor for framing,
  - an AWorldDirector (the brain's control surface),
  - a PlayerStart.
Every actor is spawned movable so AWorldDirector can drive it at runtime.
Idempotent — re-running recreates the map and material.
"""

import glob
import os

import unreal

LEVEL_PACKAGE = "/Game/Maps/Spike"
GROUND_MATERIAL = "/Game/Materials/M_Ground"
TEXTURE_DEST = "/Game/Textures/Quarry"
# Megascans surface uddmcgbia (South African Slate Quarry) — textures only, tilable.
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


def _spawn(actor_subsystem, actor_class, location, rotation=None):
    rotation = rotation or unreal.Rotator(0.0, 0.0, 0.0)
    return actor_subsystem.spawn_actor_from_class(actor_class, location, rotation)


def _quarry_enabled():
    """Set YELLOW_QUARRY_GROUND=0 to skip Megascans import (procedural sand only)."""
    return os.environ.get("YELLOW_QUARRY_GROUND", "1").strip().lower() not in (
        "0",
        "false",
        "no",
    )


def _load_quarry_textures():
    """Load quarry uassets created by import_quarry_textures.py (build step 2a).

    Do NOT call ImportAssetTasks here — -nullrhi has no Slate and crashes with
    CurrentApplication.IsValid() during import.
    """
    if not _quarry_enabled():
        unreal.log("[make_map] quarry: disabled (YELLOW_QUARRY_GROUND=0)")
        return None

    textures = {}
    for map_name in ("Basecolor", "Normal", "Roughness", "AO"):
        asset_path = f"{TEXTURE_DEST}/uddmcgbia_{map_name}"
        if not unreal.EditorAssetLibrary.does_asset_exist(asset_path):
            continue
        tex = unreal.EditorAssetLibrary.load_asset(asset_path)
        if tex:
            textures[map_name] = tex

    for required in ("Basecolor", "Normal", "Roughness"):
        if required not in textures:
            unreal.log_warning(
                "[make_map] quarry: missing uasset "
                + TEXTURE_DEST
                + "/uddmcgbia_"
                + required
                + " — need build step [2a] import (xvfb); using procedural sand"
            )
            return None

    unreal.log("[make_map] quarry: loaded " + str(len(textures)) + " texture uassets")
    return textures


def _make_ground_material_procedural():
    """Flat sand fallback when Megascans textures are not staged."""
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
    unreal.log("[make_map] ground: procedural sand (no quarry textures)")
    return mat


def _make_ground_material_from_quarry(textures):
    """PBR ground from Megascans South African Slate Quarry surface (uddmcgbia)."""
    if unreal.EditorAssetLibrary.does_asset_exist(GROUND_MATERIAL):
        unreal.EditorAssetLibrary.delete_asset(GROUND_MATERIAL)

    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    mat = asset_tools.create_asset(
        "M_Ground", "/Game/Materials", unreal.Material, unreal.MaterialFactoryNew()
    )
    mel = unreal.MaterialEditingLibrary

    # Tile across the large ground plane (80×80 engine units).
    tex_coord = mel.create_material_expression(
        mat, unreal.MaterialExpressionTextureCoordinate, -1200, -200
    )
    tex_coord.set_editor_property("utiling", 12.0)
    tex_coord.set_editor_property("vtiling", 12.0)

    def _sample(tex, sampler_type, x, y):
        node = mel.create_material_expression(
            mat, unreal.MaterialExpressionTextureSample, x, y
        )
        node.set_editor_property("texture", tex)
        try:
            node.set_editor_property("sampler_type", sampler_type)
        except Exception:  # noqa: BLE001 - property name varies by UE version
            pass
        mel.connect_material_expressions(tex_coord, "", node, "UVs")
        return node

    albedo_sample = _sample(
        textures["Basecolor"], unreal.MaterialSamplerType.SAMPLERTYPE_COLOR, -900, 0
    )
    normal_sample = _sample(
        textures["Normal"], unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL, -900, 280
    )
    rough_sample = _sample(
        textures["Roughness"], unreal.MaterialSamplerType.SAMPLERTYPE_COLOR, -900, 560
    )

    # Tint multiply — same parameter name as AWorldDirector::SetGroundColor.
    tint = mel.create_material_expression(
        mat, unreal.MaterialExpressionVectorParameter, -600, 0
    )
    tint.set_editor_property("parameter_name", "BaseColor")
    tint.set_editor_property("default_value", unreal.LinearColor(1.0, 1.0, 1.0, 1.0))

    tinted = mel.create_material_expression(
        mat, unreal.MaterialExpressionMultiply, -400, 0
    )
    mel.connect_material_expressions(albedo_sample, "", tinted, "A")
    mel.connect_material_expressions(tint, "", tinted, "B")
    mel.connect_material_property(tinted, "", unreal.MaterialProperty.MP_BASE_COLOR)

    mel.connect_material_property(normal_sample, "", unreal.MaterialProperty.MP_NORMAL)
    mel.connect_material_property(rough_sample, "", unreal.MaterialProperty.MP_ROUGHNESS)

    mel.recompile_material(mat)
    unreal.EditorAssetLibrary.save_asset(GROUND_MATERIAL)
    unreal.log("[make_map] ground: Megascans south_african_slate_quarry / uddmcgbia")
    return mat


def _make_ground_material():
    textures = _load_quarry_textures()
    if textures:
        return _make_ground_material_from_quarry(textures)
    return _make_ground_material_procedural()


def _spawn_water_lake(actor_subsystem):
    """Spawn a Water Body Lake as the Option-A spike, fully guarded.

    What this proves (Option A): the Water plugin is enabled, cooks in the
    headless dev-5.7 container, and renders a water surface that streams over
    Pixel Streaming on the T4 without crashing. True shoreline carving needs a
    Landscape (Option B) — a flat static-mesh plane can't be carved by Water —
    so here we just float a lake surface so we can confirm it renders.

    Everything is wrapped: if the Water plugin classes aren't available (plugin
    missing or didn't cook), we log and return so the rest of the level still
    builds. The log lines are the spike's diagnostic output.
    """
    # The Water plugin actor class name has shifted across engine versions;
    # try the known candidates and use the first that resolves.
    lake_class = None
    for _name in ("WaterBodyLake", "WaterBodyLakeActor"):
        lake_class = getattr(unreal, _name, None)
        if lake_class is not None:
            unreal.log("[make_map] water: using actor class unreal." + _name)
            break
    if lake_class is None:
        unreal.log_warning(
            "[make_map] water: no WaterBodyLake class found — Water plugin not "
            "available/cooked. Skipping lake (rest of level still builds)."
        )
        return None

    try:
        lake = _spawn(actor_subsystem, lake_class, unreal.Vector(600, 0, 20))
    except Exception as exc:  # noqa: BLE001 - spike: never fail the whole build
        unreal.log_warning("[make_map] water: spawn failed: " + str(exc))
        return None

    if lake is None:
        unreal.log_warning("[make_map] water: spawn returned None")
        return None

    unreal.log("[make_map] water: spawned lake path=" + lake.get_path_name())

    # Try to shape the lake's spline into a ~700cm-radius circle so it reads as
    # a watering hole rather than the tiny default. The spline accessor differs
    # by version, so probe a few and bail quietly if none fit.
    try:
        import math

        spline = None
        for _getter in ("get_water_spline",):
            fn = getattr(lake, _getter, None)
            if callable(fn):
                spline = fn()
                break
        if spline is None:
            spline = lake.get_component_by_class(unreal.SplineComponent)

        if spline is not None:
            radius = 700.0
            points = [
                unreal.Vector(radius * math.cos(t), radius * math.sin(t), 0.0)
                for t in [i * (math.pi / 4.0) for i in range(8)]
            ]
            spline.set_spline_points(points, unreal.SplineCoordinateSpace.LOCAL, True)
            spline.set_closed_loop(True, True)
            unreal.log("[make_map] water: set 8-pt circular spline r=700")
        else:
            unreal.log_warning(
                "[make_map] water: no spline component found; lake keeps its "
                "default shape (still a valid render test)"
            )
    except Exception as exc:  # noqa: BLE001 - shaping is best-effort
        unreal.log_warning("[make_map] water: spline shaping skipped: " + str(exc))

    return lake


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

    # Ground plane (scaled up engine primitive) with quarry PBR or procedural sand.
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

    # Make this directional light THE atmosphere sun so the SkyAtmosphere tints
    # the sky to match the sun's height (warm horizon at dawn/dusk, dark at
    # night). Without this the sky stays a fixed daytime blue regardless of time.
    # Property name has differed across engine versions, so try both quietly.
    sun_comp = sun.get_component_by_class(unreal.DirectionalLightComponent)
    for _prop in ("atmosphere_sun_light", "used_as_atmosphere_sun_light"):
        try:
            sun_comp.set_editor_property(_prop, True)
            unreal.log("[make_map] sun set as atmosphere sun light via " + _prop)
            break
        except Exception as exc:  # noqa: BLE001 - tolerate version differences
            unreal.log_warning("[make_map] could not set " + _prop + ": " + str(exc))

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

    # --- Water spike (Option A) -------------------------------------------
    # Goal: prove the Water plugin cooks headless + renders + streams on the
    # T4, as "just a dip in the floor to hold water". A Water Body Lake spawns
    # its own flat water surface; we drop a wide, shallow dip in the ground
    # beneath it so the shoreline reads as a real watering hole rather than a
    # disc floating on the plane. Everything is guarded so a missing/!cooked
    # Water plugin degrades to "no lake" instead of failing the whole build.
    _spawn_water_lake(actor_subsystem)

    # Somewhere for the streamed view to spawn.
    _spawn(actor_subsystem, unreal.PlayerStart,
           unreal.Vector(-800, 0, 300), unreal.Rotator(-15.0, 0.0, 0.0))

    if not level_subsystem.save_current_level():
        raise RuntimeError("save_current_level failed for " + LEVEL_PACKAGE)
    unreal.log("[make_map] saved " + LEVEL_PACKAGE)


if __name__ == "__main__":
    main()
