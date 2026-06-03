"""Place a single PlayerStart at the centre of an imported map, then save it.

Runs as a pre-cook step inside the dev-5.7 container (no GUI):

    MAP=/Game/<pack>/<...>/Map \
    UnrealEditor-Cmd YellowWorld.uproject \
        -run=pythonscript -script=Scripts/center_player_start.py \
        -unattended -nullrhi -nosplash -nopause

Imported packs (e.g. the 8K Savannah landscape) either have no PlayerStart, or
one tucked in a corner, so the streamed pawn spawns at the map edge / origin.
This makes the view start in the middle of the terrain instead. We:

  * load the target level (MAP env, the same /Game path we cook),
  * union the landscape bounds (fallback: static meshes, then all actors) to
    find the map centre in X/Y,
  * line-trace straight down at the centre to find the ground height, so we
    spawn at a natural eye height standing on the terrain (falls back to
    top-of-bounds + margin if the trace can't run under -nullrhi),
  * delete any existing PlayerStarts so the GameMode can't pick a stale one,
  * spawn one PlayerStart at the centre and save the level for the cook.

These maps are monolithic .umaps (no World Partition / external actors), so a
straight load -> edit -> save works headlessly.
"""

import os
import re

import unreal

EYE_HEIGHT = 180.0       # ~standing eye height above the ground hit (cm)
FALLBACK_MARGIN = 300.0  # above top-of-bounds when no trace hit is available


def _editor_world():
    try:
        ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
        return ues.get_editor_world()
    except Exception as exc:  # noqa: BLE001 - tolerate API differences
        unreal.log_warning("[center] could not get editor world: " + str(exc))
        return None


def _union_bounds(actors):
    """Axis-aligned union of get_actor_bounds() over actors -> (min, max)."""
    box_min = None
    box_max = None
    for a in actors:
        try:
            origin, extent = a.get_actor_bounds(False)
        except Exception:
            continue
        if extent.x <= 0.0 and extent.y <= 0.0 and extent.z <= 0.0:
            continue
        lo = unreal.Vector(origin.x - extent.x, origin.y - extent.y, origin.z - extent.z)
        hi = unreal.Vector(origin.x + extent.x, origin.y + extent.y, origin.z + extent.z)
        if box_min is None:
            box_min, box_max = lo, hi
        else:
            box_min = unreal.Vector(min(box_min.x, lo.x), min(box_min.y, lo.y), min(box_min.z, lo.z))
            box_max = unreal.Vector(max(box_max.x, hi.x), max(box_max.y, hi.y), max(box_max.z, hi.z))
    return box_min, box_max


def _pick_bounds_actors(all_actors):
    """Prefer landscape actors, then static meshes, then everything."""
    landscapes = [a for a in all_actors if "Landscape" in a.get_class().get_name()]
    if landscapes:
        unreal.log("[center] using %d landscape actor(s) for bounds" % len(landscapes))
        return landscapes
    meshes = [a for a in all_actors if isinstance(a, unreal.StaticMeshActor)]
    if meshes:
        unreal.log("[center] no landscape; using %d static-mesh actor(s)" % len(meshes))
        return meshes
    unreal.log_warning("[center] no landscape/static meshes; using all actors")
    return all_actors


def _ground_z(world, cx, cy, top_z, bot_z):
    """Trace down the centre column for the terrain height; None if it can't."""
    if world is None:
        return None
    start = unreal.Vector(cx, cy, top_z + 10000.0)
    end = unreal.Vector(cx, cy, bot_z - 10000.0)
    try:
        hit = unreal.SystemLibrary.line_trace_single(
            world, start, end,
            unreal.TraceTypeQuery.TRACE_TYPE_QUERY1,
            True, [], unreal.DrawDebugTrace.NONE, True)
    except Exception as exc:  # noqa: BLE001 - nullrhi/collision may not support it
        unreal.log_warning("[center] line trace failed: " + str(exc))
        return None
    if not hit:
        unreal.log("[center] ground trace found nothing at centre")
        return None
    # FHitResult's vector members are protected in UE 5.7 Python (can't read via
    # attribute or get_editor_property). export_text() serialises them as named
    # fields, so parse the Z of the impact point (fall back to Location).
    try:
        text = hit.export_text()
    except Exception as exc:  # noqa: BLE001 - tolerate struct accessor differences
        unreal.log_warning("[center] hit.export_text failed: " + str(exc))
        return None
    for field in ("ImpactPoint", "Location"):
        m = re.search(field + r"=\(X=[-0-9.eE]+,Y=[-0-9.eE]+,Z=([-0-9.eE]+)\)", text)
        if m:
            z = float(m.group(1))
            unreal.log_warning("[center] ground %s z=%.1f" % (field, z))
            return z
    unreal.log_warning("[center] could not parse hit point from: " + text[:240])
    return None


def main():
    map_path = os.environ.get("MAP", "").strip()
    if not map_path:
        raise RuntimeError("MAP env not set - nothing to centre")

    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    actor_sub = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)

    if not les.load_level(map_path):
        raise RuntimeError("load_level failed for " + map_path)

    all_actors = actor_sub.get_all_level_actors()
    unreal.log("[center] level has %d actors" % len(all_actors))

    box_min, box_max = _union_bounds(_pick_bounds_actors(all_actors))
    if box_min is None:
        unreal.log_warning("[center] no usable bounds; defaulting centre to origin")
        cx = cy = 0.0
        top_z, bot_z = 1000.0, -1000.0
    else:
        cx = (box_min.x + box_max.x) * 0.5
        cy = (box_min.y + box_max.y) * 0.5
        top_z, bot_z = box_max.z, box_min.z
    unreal.log("[center] map centre x=%.1f y=%.1f (z range %.1f..%.1f)" % (cx, cy, bot_z, top_z))

    gz = _ground_z(_editor_world(), cx, cy, top_z, bot_z)
    if gz is None:
        spawn_z = top_z + FALLBACK_MARGIN
        unreal.log("[center] no trace; spawning above top-of-bounds z=%.1f" % spawn_z)
    else:
        spawn_z = gz + EYE_HEIGHT

    location = unreal.Vector(cx, cy, spawn_z)
    rotation = unreal.Rotator(-5.0, 0.0, 0.0)  # (pitch, yaw, roll): look forward, slightly down

    removed = 0
    for a in all_actors:
        if isinstance(a, unreal.PlayerStart):
            unreal.log("[center] removing existing PlayerStart at " + str(a.get_actor_location()))
            actor_sub.destroy_actor(a)
            removed += 1

    ps = actor_sub.spawn_actor_from_class(unreal.PlayerStart, location, rotation)
    if ps is None:
        raise RuntimeError("spawn_actor_from_class(PlayerStart) returned None")
    unreal.log_warning("[center] spawned PlayerStart at (%.1f, %.1f, %.1f), removed %d old"
                       % (location.x, location.y, location.z, removed))

    if not les.save_current_level():
        raise RuntimeError("save_current_level failed for " + map_path)
    unreal.log("[center] saved " + map_path)


if __name__ == "__main__":
    main()
