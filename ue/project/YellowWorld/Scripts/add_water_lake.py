"""Add a still Water Body Lake (watering hole) to an imported map, headless.

Runs as a pre-cook step in the dev-5.7 container (no GUI):

    MAP=/Game/<pack>/<...>/Map \
    WATER_X=140000 WATER_Y=150000 WATER_Z=-9500 WATER_R=70000 \
    UnrealEditor-Cmd YellowWorld.uproject \
        -run=pythonscript -script=Scripts/add_water_lake.py \
        -unattended -nullrhi -nosplash -nopause -stdout

The imported pack ships no water. We place:
  * an AWaterZone covering the landscape (required in UE 5.7 for any water body
    to render; spawning a lake alone shows nothing), and
  * an AWaterBodyLake: a closed circular spline at (WATER_X, WATER_Y) with the
    water surface at WATER_Z. A lake is single-height, so its whole surface sits
    at WATER_Z and fills wherever the terrain dips below it (the existing basin).
    bAffectsLandscape is enabled so it also carves a clean shoreline IF the
    landscape has Edit Layers (otherwise it just fills the existing depression).

Idempotent: removes any prior lake/zone we added before re-adding. Single
monolithic .umap (no World Partition), so load -> edit -> save works headless.
All water steps are guarded; a missing/!cooked Water plugin degrades to a
warning rather than failing the whole build.
"""

import math
import os

import unreal

LAKE_TAG = "yellow_water_lake"
ZONE_TAG = "yellow_water_zone"
SPLINE_POINTS = 16

# Default water bodies (world cm: x, y, surface_z, radius). Overridable via the
# LAKES env ("x,y,z,r;x,y,z,r") or, for a single lake, the WATER_* envs. Tuned
# from a terrain scan of Landscape_1:
#   * primary watering hole in the SW valley. Surface -8700: was lowered to
#     -9500 for the "reduce ~45%" pass, then raised ~20% (area 178->213 cells,
#     centre depth ~12 m) because -9500 looked too shallow.
#   * second bowl in the high-X/high-Y interior basin. Surface -6000, radius
#     ~1.3 km: enlarged from 700 m so it follows the low channel and fills the
#     surrounding dark (low) spots (~77 -> ~143 wet cells).
DEFAULT_LAKES = [
    (120000.0, 160000.0, -8700.0, 160000.0),
    (479552.0, 625856.0, -6000.0, 130000.0),
]


def _f(name, default):
    try:
        return float(os.environ.get(name, "").strip() or default)
    except ValueError:
        return float(default)


def _first_class(*names):
    for n in names:
        c = getattr(unreal, n, None)
        if c is not None:
            return c, n
    return None, None


def _spawn(actsub, cls, loc):
    return actsub.spawn_actor_from_class(cls, loc, unreal.Rotator(0, 0, 0))


def _set_fly_gamemode():
    """Force this map's World Settings GameMode Override to AFlyGameMode so the
    fast fly camera (150 m/s + Shift turbo) applies. The imported Savannah map
    ships a GameMode override that beats the project's GlobalDefaultGameMode,
    which is why movement was stuck on the stock 12 m/s DefaultPawn. Opt out with
    SET_FLY_GM=0."""
    if os.environ.get("SET_FLY_GM", "1").strip() != "1":
        return
    gm_cls = None
    try:
        gm_cls = unreal.FlyGameMode.static_class()
    except Exception:
        try:
            gm_cls = unreal.load_class(None, "/Script/YellowWorld.FlyGameMode")
        except Exception as exc:
            unreal.log_warning("[water] could not resolve FlyGameMode: %s" % exc)
            return
    try:
        w = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
        ws = w.get_world_settings()
        ws.set_editor_property("default_game_mode", gm_cls)
        unreal.log_warning("[water] set World Settings GameModeOverride=FlyGameMode")
    except Exception as exc:
        unreal.log_warning("[water] failed to set GameModeOverride: %s" % exc)


def _remove_tagged(actsub, actors, tag):
    n = 0
    for a in actors:
        try:
            tags = [str(t) for t in a.get_editor_property("tags")]
        except Exception:
            tags = []
        if tag in tags:
            actsub.destroy_actor(a)
            n += 1
    return n


def _ensure_water_zone(actsub, actors, lo, hi):
    zone_cls, zname = _first_class("WaterZone")
    if zone_cls is None:
        unreal.log_warning("[water] no WaterZone class - Water plugin missing? skipping zone")
        return None
    existing = [a for a in actors if isinstance(a, zone_cls)]
    if existing:
        unreal.log_warning("[water] reusing existing WaterZone (%d found)" % len(existing))
        return existing[0]
    cx = (lo.x + hi.x) * 0.5
    cy = (lo.y + hi.y) * 0.5
    zone = _spawn(actsub, zone_cls, unreal.Vector(cx, cy, 0.0))
    try:
        zone.set_editor_property("tags", [ZONE_TAG])
    except Exception:
        pass
    # Size the zone to cover the whole landscape (X/Y extent in cm). CRITICAL:
    # UE 5.7's AWaterZone.ZoneExtent is a Vector2D. Passing a 3D unreal.Vector
    # (as we used to) makes set_editor_property throw, which we swallowed -> the
    # zone silently kept its tiny ~512 m default box at map centre, so a lake
    # placed anywhere else rendered NO surface (you could swim in it but never
    # see the top). Try the 2D type first, fall back to 3D for older engines, and
    # shout if neither sticks.
    w_ext, h_ext = (hi.x - lo.x), (hi.y - lo.y)
    candidates = []
    try:
        candidates.append(unreal.Vector2D(w_ext, h_ext))
    except Exception:
        pass
    candidates.append(unreal.Vector(w_ext, h_ext, 100000.0))
    ext_set = False
    for prop in ("zone_extent", "ZoneExtent"):
        for ev in candidates:
            try:
                zone.set_editor_property(prop, ev)
                unreal.log_warning("[water] set WaterZone %s=%s" % (prop, str(ev)))
                ext_set = True
                break
            except Exception:
                continue
        if ext_set:
            break
    if not ext_set:
        unreal.log_warning("[water] ERROR could not set WaterZone extent — "
                           "lake surface will NOT render. Check AWaterZone API.")
    unreal.log_warning("[water] spawned WaterZone '%s' at (%.0f,%.0f)" % (zname, cx, cy))
    return zone


def _union_bounds(actors):
    lo = hi = None
    for a in actors:
        try:
            o, e = a.get_actor_bounds(False)
        except Exception:
            continue
        if e.x <= 0 and e.y <= 0 and e.z <= 0:
            continue
        amin = unreal.Vector(o.x - e.x, o.y - e.y, o.z - e.z)
        amax = unreal.Vector(o.x + e.x, o.y + e.y, o.z + e.z)
        if lo is None:
            lo, hi = amin, amax
        else:
            lo = unreal.Vector(min(lo.x, amin.x), min(lo.y, amin.y), min(lo.z, amin.z))
            hi = unreal.Vector(max(hi.x, amax.x), max(hi.y, amax.y), max(hi.z, amax.z))
    return lo, hi


def _set_lake_spline(lake, radius):
    """Shape the lake's water spline into a closed circle of `radius` (local space)."""
    spline = None
    getter = getattr(lake, "get_water_spline", None)
    if callable(getter):
        try:
            spline = getter()
        except Exception:
            spline = None
    if spline is None:
        try:
            spline = lake.get_component_by_class(unreal.SplineComponent)
        except Exception:
            spline = None
    if spline is None:
        unreal.log_warning("[water] no spline on lake; keeping default shape")
        return False
    pts = [unreal.Vector(radius * math.cos(t), radius * math.sin(t), 0.0)
           for t in [i * (2.0 * math.pi / SPLINE_POINTS) for i in range(SPLINE_POINTS)]]
    spline.set_spline_points(pts, unreal.SplineCoordinateSpace.LOCAL, True)
    try:
        spline.set_closed_loop(True, True)
    except Exception:
        pass
    unreal.log_warning("[water] set %d-pt circular spline r=%.0f" % (SPLINE_POINTS, radius))
    return True


def _parse_lakes():
    """Resolve the list of (x, y, z, r) lakes to author. LAKES env wins, then a
    single WATER_* env, then the baked DEFAULT_LAKES."""
    env = os.environ.get("LAKES", "").strip()
    if env:
        specs = []
        for part in env.split(";"):
            part = part.strip()
            if not part:
                continue
            try:
                v = [float(t) for t in part.split(",")]
            except ValueError:
                continue
            if len(v) >= 4:
                specs.append((v[0], v[1], v[2], v[3]))
        if specs:
            return specs
    if any(os.environ.get(k, "").strip() for k in ("WATER_X", "WATER_Y", "WATER_Z", "WATER_R")):
        return [(_f("WATER_X", 120000), _f("WATER_Y", 160000),
                 _f("WATER_Z", -9500), _f("WATER_R", 160000))]
    return list(DEFAULT_LAKES)


def _make_lake(actsub, lake_cls, lname, x, y, z, r, carve):
    """Spawn one WaterBodyLake: circular spline of `radius`, fill (or carve) the
    terrain depression. Tagged so re-runs replace it idempotently."""
    lake = _spawn(actsub, lake_cls, unreal.Vector(x, y, z))
    try:
        lake.set_editor_property("tags", [LAKE_TAG])
    except Exception:
        pass
    unreal.log_warning("[water] spawned %s at (%.0f,%.0f,%.0f) r=%.0f" % (lname, x, y, z, r))
    _set_lake_spline(lake, r)
    comp = None
    for getter in ("get_water_body_component", "water_body_component"):
        obj = getattr(lake, getter, None)
        if obj is not None:
            try:
                comp = obj() if callable(obj) else obj
            except Exception:
                comp = None
        if comp is not None:
            break
    if comp is None:
        try:
            comp = lake.get_component_by_class(unreal.WaterBodyComponent)
        except Exception:
            comp = None
    if comp is not None:
        for prop in ("affects_landscape", "b_affects_landscape"):
            try:
                comp.set_editor_property(prop, carve)
                unreal.log_warning("[water] set %s=%s" % (prop, carve))
                break
            except Exception:
                continue
    else:
        unreal.log_warning("[water] could not resolve WaterBodyComponent (affects_landscape skipped)")
    return lake


def main():
    map_path = os.environ.get("MAP", "").strip()
    if not map_path:
        raise RuntimeError("MAP env not set")
    # Lakes are resolved by _parse_lakes(): LAKES env, else single WATER_* env,
    # else the baked DEFAULT_LAKES (tuned from the terrain scan).
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    actsub = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    if not les.load_level(map_path):
        raise RuntimeError("load_level failed for " + map_path)
    actors = actsub.get_all_level_actors()

    # Idempotent: remove anything we added previously.
    removed = _remove_tagged(actsub, actors, LAKE_TAG) + _remove_tagged(actsub, actors, ZONE_TAG)
    if removed:
        actors = actsub.get_all_level_actors()
        unreal.log_warning("[water] removed %d previously-added water actors" % removed)

    lands = [a for a in actors if a.get_class().get_name() == "Landscape"]
    lo, hi = _union_bounds(lands or actors)
    if lo is None:
        lo, hi = unreal.Vector(0, 0, -20000), unreal.Vector(800000, 800000, 40000)

    _ensure_water_zone(actsub, actors, lo, hi)

    lake_cls, lname = _first_class("WaterBodyLake", "WaterBodyLakeActor")
    if lake_cls is None:
        unreal.log_warning("[water] no WaterBodyLake class - Water plugin missing/!cooked. ABORT add.")
        # Still save (zone may have been added); but really nothing to do.
        les.save_current_level()
        return

    # Carving the landscape (affects_landscape) needs Edit Layers and is riskier
    # headless; the basins already exist in the heightmap, so by default we just
    # fill them (surface at z; terrain pokes through to form the shoreline). Set
    # WATER_CARVE=1 to opt into carving.
    carve = (os.environ.get("WATER_CARVE", "0").strip() == "1")
    specs = _parse_lakes()
    for (lx, ly, lz, lr) in specs:
        _make_lake(actsub, lake_cls, lname, lx, ly, lz, lr, carve)
    unreal.log_warning("[water] authored %d lake(s)" % len(specs))

    # Spawn the player above the first (primary) lake.
    px, py, pz, _pr = specs[0]
    _reposition_player_start(actsub, px, py, pz)

    _set_fly_gamemode()

    if not les.save_current_level():
        raise RuntimeError("save_current_level failed for " + map_path)
    unreal.log_warning("[water] saved %s" % map_path)


def _reposition_player_start(actsub, cx, cy, surface_z):
    """Put the PlayerStart high above the lake centre, pitched down, so the
    streamed view starts looking straight at the new water. The map centre is
    high ground far from this basin, so without this you'd spawn nowhere near
    the lake. Opt out with SPAWN_OVER_LAKE=0 (keeps whatever PlayerStart exists)."""
    if os.environ.get("SPAWN_OVER_LAKE", "1").strip() != "1":
        return
    height = _f("SPAWN_HEIGHT", 60000)   # cm above the water surface (above all terrain)
    pitch = _f("SPAWN_PITCH", -40)       # look down at the lake
    removed = 0
    for a in actsub.get_all_level_actors():
        if a.get_class().get_name() == "PlayerStart":
            actsub.destroy_actor(a)
            removed += 1
    loc = unreal.Vector(cx, cy, surface_z + height)
    rot = unreal.Rotator(pitch, 0.0, 0.0)  # (pitch, yaw, roll)
    ps = actsub.spawn_actor_from_class(unreal.PlayerStart, loc, rot)
    if ps is None:
        unreal.log_warning("[water] PlayerStart spawn returned None")
        return
    unreal.log_warning("[water] PlayerStart over lake at (%.0f,%.0f,%.0f) pitch=%.0f, removed %d"
                       % (loc.x, loc.y, loc.z, pitch, removed))


def _quit():
    # We run inside the FULL editor (needs Slate for WaterBodyLake spawn). Quit on
    # the first tick right after saving, before the headless GPU renders enough
    # frames to risk VK_ERROR_DEVICE_LOST.
    try:
        w = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
        unreal.SystemLibrary.execute_console_command(w, "QUIT_EDITOR")
    except Exception as exc:
        unreal.log_warning("[water] QUIT_EDITOR failed: %s" % exc)


if __name__ == "__main__":
    try:
        main()
    finally:
        _quit()
