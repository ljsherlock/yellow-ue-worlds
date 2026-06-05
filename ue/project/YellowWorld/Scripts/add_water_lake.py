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
import re

import unreal

LAKE_TAG = "yellow_water_lake"
ZONE_TAG = "yellow_water_zone"
SPLINE_POINTS = 28

# Default water bodies (world cm: x, y, surface_z, radius). Overridable via the
# LAKES env ("x,y,z,r;x,y,z,r") or, for a single lake, the WATER_* envs.
#   * SW valley watering hole at (120000,160000).
#   * interior basin at (479552,625856) — the original "large lake" (1.3 km r).
# Both lakes are sized to 20% of that original large lake's radius (130000 cm),
# i.e. 26000 cm radius (~520 m across), carved into the terrain and set to the
# local ground height (see SNAP_TO_GROUND). The baked surface_z values below are
# only fallbacks for when ground-snapping is disabled.
LARGE_LAKE_RADIUS = 130000.0          # cm; the original interior lake radius
LAKE_RADIUS = 0.20 * LARGE_LAKE_RADIUS  # 26000 cm = 20% of the large lake
DEFAULT_LAKES = [
    (120000.0, 160000.0, -8700.0, LAKE_RADIUS),   # SW watering hole
    (479552.0, 625856.0, -6000.0, LAKE_RADIUS),   # interior basin (primary target)
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


def _editor_world():
    return unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()


def _trace_z(w, x, y, top, bot):
    """Vertical line-trace down at (x,y); return the ground Z hit, or None."""
    try:
        hit = unreal.SystemLibrary.line_trace_single(
            w, unreal.Vector(x, y, top + 10000.0), unreal.Vector(x, y, bot - 10000.0),
            unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, True, [],
            unreal.DrawDebugTrace.NONE, True)
    except Exception:
        return None
    if not hit:
        return None
    m = re.search(r"ImpactPoint=\(X=[-0-9.eE]+,Y=[-0-9.eE]+,Z=([-0-9.eE]+)\)",
                  hit.export_text())
    return float(m.group(1)) if m else None


def _lowest_point(w, cx, cy, search_r, grid, top, bot):
    """Fine-trace a square grid (+/- search_r around cx,cy) and return the
    (x, y, z) of the lowest terrain hit, or None. Data-driven placement so the
    small pond lands at the true bottom of the basin rather than a guessed XY."""
    best = None
    n = max(int(grid), 2)
    for i in range(n + 1):
        for j in range(n + 1):
            x = cx - search_r + (2.0 * search_r) * i / n
            y = cy - search_r + (2.0 * search_r) * j / n
            z = _trace_z(w, x, y, top, bot)
            if z is None:
                continue
            if best is None or z < best[2]:
                best = (x, y, z)
    return best


def _rim_min(w, cx, cy, r, top, bot, n=24):
    """Trace a ring of `n` points at radius r around (cx,cy) and return the LOWEST
    terrain Z on that ring (the rim's low point). Used to cap the water surface so
    it stays below the rim and the lake is contained by real terrain, not a berm."""
    best = None
    for i in range(max(int(n), 6)):
        a = i * (2.0 * math.pi / max(int(n), 6))
        z = _trace_z(w, cx + r * math.cos(a), cy + r * math.sin(a), top, bot)
        if z is None:
            continue
        if best is None or z < best:
            best = z
    return best


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


def _set_lake_spline(lake, radius, seed=0.0):
    """Shape the lake's water spline into a closed ORGANIC loop (local space). A
    real waterhole isn't a perfect circle (see ref photo), so we modulate the
    per-point radius with a few low-frequency sine harmonics whose phases are
    derived from `seed` (the lake centre) — deterministic, but each lake differs.
    Amplitude via WATER_SHAPE_AMP (0 = perfect circle). With carving on, this
    irregular boundary is what gets dug into the terrain, giving a natural shore."""
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
    amp = _f("WATER_SHAPE_AMP", 0.22)        # overall irregularity (fraction of radius)
    # Phases from the seed so the two lakes get different (but stable) silhouettes.
    p2 = (seed * 0.0000131) % (2.0 * math.pi)
    p3 = (seed * 0.0000270) % (2.0 * math.pi)
    p5 = (seed * 0.0000071) % (2.0 * math.pi)
    pts = []
    for i in range(SPLINE_POINTS):
        t = i * (2.0 * math.pi / SPLINE_POINTS)
        # Harmonics 2/3/5 → an oval with a couple of soft lobes (kidney-ish).
        wob = (0.55 * math.sin(2.0 * t + p2)
               + 0.30 * math.sin(3.0 * t + p3)
               + 0.15 * math.sin(5.0 * t + p5))
        r = radius * max(0.5, 1.0 + amp * wob)
        pts.append(unreal.Vector(r * math.cos(t), r * math.sin(t), 0.0))
    spline.set_spline_points(pts, unreal.SplineCoordinateSpace.LOCAL, True)
    try:
        spline.set_closed_loop(True, True)
    except Exception:
        pass
    unreal.log_warning("[water] set %d-pt organic spline r=%.0f amp=%.2f" % (SPLINE_POINTS, radius, amp))
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
    _set_lake_spline(lake, r, seed=(x + y))
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
        if carve:
            _set_carve_falloff(comp)
    else:
        unreal.log_warning("[water] could not resolve WaterBodyComponent (affects_landscape skipped)")

    # Recolour the water to a clear, light, reflective lake (not deep-ocean blue).
    _apply_savannah_water(comp)

    # Calm the surface: a waterhole is near-still with only fine ripples, not the
    # default Gerstner chop.
    _calm_lake_waves(lake, comp)

    # Collision: force the Water plugin's "WaterBodyCollision" profile (QueryOnly,
    # Pawn=Overlap) on every primitive component of the lake. Without this the
    # spawned body kept a blocking default, so creatures/pawns STOOD ON the water
    # surface instead of passing through it (the shoreline logic stops the herd at
    # the edge). Profile is defined in Config/DefaultEngine.ini.
    _set_water_collision(lake)
    return lake


def _set_water_collision(lake):
    profile = "WaterBodyCollision"
    try:
        prims = lake.get_components_by_class(unreal.PrimitiveComponent)
    except Exception as exc:
        unreal.log_warning("[water] collision: could not list components: %s" % exc)
        return
    n = 0
    for pc in prims:
        try:
            pc.set_collision_profile_name(profile)
            n += 1
        except Exception:
            try:
                pc.set_editor_property("collision_profile_name", unreal.Name(profile))
                n += 1
            except Exception:
                continue
    unreal.log_warning("[water] set %s on %d/%d primitive component(s)"
                       % (profile, n, len(prims)))


# Cached so all lakes share ONE saved Material Instance (so a later live/RC tweak
# or re-tune touches every lake at once).
_SAV_WATER_MIC = None


def _savannah_water_mic(parent_mat):
    """Create (once) and return a saved MaterialInstanceConstant parented to the
    lake's default water material, retuned for a clear, light, reflective lake.
    We LOG every scalar/vector param (ground truth) and set known ones explicitly.
    Heavily guarded: a tint failure must never abort the lake build. Tune via the
    WATER_* env vars below."""
    global _SAV_WATER_MIC
    if _SAV_WATER_MIC is not None or parent_mat is None:
        return _SAV_WATER_MIC

    pkg = os.environ.get("WATER_MIC_DIR", "/Game/Water").strip()
    name = os.environ.get("WATER_MIC_NAME", "MI_SavannahWater").strip()
    full = pkg + "/" + name
    try:
        if unreal.EditorAssetLibrary.does_asset_exist(full):
            unreal.EditorAssetLibrary.delete_asset(full)
    except Exception:
        pass
    try:
        tools = unreal.AssetToolsHelpers.get_asset_tools()
        mic = tools.create_asset(name, pkg, unreal.MaterialInstanceConstant,
                                 unreal.MaterialInstanceConstantFactoryNew())
    except Exception as exc:
        unreal.log_warning("[water] could not create water MIC: %s" % exc)
        return None
    if mic is None:
        return None
    try:
        unreal.MaterialEditingLibrary.set_material_instance_parent(mic, parent_mat)
    except Exception:
        try:
            mic.set_editor_property("parent", parent_mat)
        except Exception:
            pass

    # Enumerate the base material's parameters (works for instances via base).
    base = parent_mat
    try:
        if isinstance(parent_mat, unreal.MaterialInstance):
            base = parent_mat.get_base_material()
    except Exception:
        base = parent_mat
    vec_names, scal_names = [], []
    try:
        vec_names = [str(n) for n in unreal.MaterialEditingLibrary.get_vector_parameter_names(base)]
    except Exception:
        pass
    try:
        scal_names = [str(n) for n in unreal.MaterialEditingLibrary.get_scalar_parameter_names(base)]
    except Exception:
        pass
    unreal.log_warning("[water] water material '%s' vectors=%s" % (base.get_name() if base else "?", vec_names))
    unreal.log_warning("[water] water material scalars=%s" % scal_names)

    # We now know the real Water_Material params (logged on the first run), so set
    # them EXPLICITLY for a CLEAR, LIGHT, REFLECTIVE lake (ref photo) — not the
    # murky/dark values that read as deep ocean. Per the UE Single Layer Water docs:
    #   * low Absorption       -> clear water (light penetrates, shallow reads light)
    #   * low + teal Scattering -> light turquoise tint without going milky/opaque
    #   * low Water Roughness   -> strong sky reflections (still water is mirror-like)
    # Overridable via WATER_SCATTER / WATER_ABSORB / WATER_ALBEDO ("r,g,b") and the
    # scalars WATER_ROUGHNESS / WATER_SPECULAR.
    # NOTE on darkness: LOW Scattering over a ~12 m basin reads as dark navy (you
    # see "into" deep water). A clear, LIGHT waterhole actually needs HIGHER teal
    # scattering (the bright turquoise body comes from scattering bouncing light
    # back up) plus low absorption. Earlier values (0.09,0.28,0.30) were too dark.
    targets_vec = {
        "Scattering": _color_env("WATER_SCATTER", 0.22, 0.52, 0.58),
        "Absorption": _color_env("WATER_ABSORB", 0.02, 0.04, 0.05),
        "Water Albedo": _color_env("WATER_ALBEDO", 0.36, 0.38, 0.34),
    }
    for n in vec_names:
        val = targets_vec.get(n)
        if val is None:
            continue
        try:
            unreal.MaterialEditingLibrary.set_material_instance_vector_parameter_value(mic, n, val)
            unreal.log_warning("[water] set vec %s=(%.2f,%.2f,%.2f)" % (n, val.r, val.g, val.b))
        except Exception:
            pass
    targets_scal = {
        "Water Roughness": _f("WATER_ROUGHNESS", 0.02),
        "Water Specular": _f("WATER_SPECULAR", 1.0),
    }
    for n in scal_names:
        if n not in targets_scal:
            continue
        try:
            unreal.MaterialEditingLibrary.set_material_instance_scalar_parameter_value(mic, n, targets_scal[n])
            unreal.log_warning("[water] set scalar %s=%.3f" % (n, targets_scal[n]))
        except Exception:
            pass
    # Calm the surface ripples. The lake's Gerstner wave asset is EMPTY (verified),
    # so there is no wave displacement to scale — the "small waves" come entirely
    # from the Water material's NORMAL maps. Scale the normal-strength scalars down
    # so a near-still waterhole shows only fine ripples (ref photo). We read each
    # base default and multiply by WATER_RIPPLE_SCALE so the look stays balanced.
    ripple_scale = _f("WATER_RIPPLE_SCALE", 0.25)
    ripple_params = ("Default Near Normal Strength",
                     "Default Distant Normal Strength",
                     "Default Distant Normal StrengthB")
    for n in scal_names:
        if n not in ripple_params:
            continue
        try:
            base_val = unreal.MaterialEditingLibrary.get_material_default_scalar_parameter_value(base, n)
        except Exception:
            base_val = None
        new_val = (base_val * ripple_scale) if isinstance(base_val, (int, float)) else ripple_scale
        try:
            unreal.MaterialEditingLibrary.set_material_instance_scalar_parameter_value(mic, n, new_val)
            unreal.log_warning("[water] ripple %s %s -> %.3f"
                               % (n, ("%.3f" % base_val) if base_val is not None else "?", new_val))
        except Exception:
            pass

    try:
        unreal.MaterialEditingLibrary.update_material_instance(mic)
        unreal.EditorAssetLibrary.save_loaded_asset(mic)
    except Exception:
        pass
    _SAV_WATER_MIC = mic
    return mic


def _color_env(name, r, g, b):
    raw = os.environ.get(name, "").strip()
    if raw:
        try:
            parts = [float(x) for x in raw.split(",")]
            if len(parts) >= 3:
                r, g, b = parts[0], parts[1], parts[2]
        except Exception:
            pass
    return unreal.LinearColor(r, g, b, 1.0)


def _apply_savannah_water(comp):
    if os.environ.get("WATER_TINT", "1").strip() != "1" or comp is None:
        return
    parent = None
    slots = ("water_material", "water_static_mesh_material", "water_lod_material")
    for p in slots:
        try:
            parent = comp.get_editor_property(p)
        except Exception:
            parent = None
        if parent is not None:
            break
    if parent is None:
        unreal.log_warning("[water] no water_material on component; skip tint")
        return
    mic = _savannah_water_mic(parent)
    if mic is None:
        return
    n = 0
    for p in slots:
        try:
            comp.set_editor_property(p, mic)
            n += 1
        except Exception:
            continue
    unreal.log_warning("[water] assigned savannah MIC to %d material slot(s)" % n)


def _set_carve_falloff(comp):
    """Shape the landscape carve (WaterBodyComponent.WaterHeightmapSettings) into a
    GENTLE, WIDE rim instead of the default steep 45-deg berm. The shoreline should
    be a smooth curve spread outward (ref photo). Lower FalloffAngle = gentler/wider
    slope; Width mode spreads over a fixed distance instead. Tunables:
    WATER_FALLOFF_MODE (angle|width), WATER_FALLOFF_ANGLE, WATER_FALLOFF_WIDTH,
    WATER_CARVE_ZOFFSET, WATER_CARVE_EDGE."""
    try:
        hs = comp.get_editor_property("water_heightmap_settings")
    except Exception as exc:
        unreal.log_warning("[water] no water_heightmap_settings (%s); carve falloff skipped" % exc)
        return
    if hs is None:
        return
    try:
        fs = hs.get_editor_property("falloff_settings")
    except Exception:
        fs = None
    if fs is None:
        unreal.log_warning("[water] no falloff_settings; carve falloff skipped")
        return

    # IMPORTANT: default to WIDTH mode, NOT angle. Angle-mode falloff is UNBOUNDED:
    # the brush slopes outward until it climbs back to the original terrain height,
    # so on tall/hilly terrain a shallow angle (e.g. 6 deg) flattens hundreds of
    # metres in every direction and wipes out the surrounding mountains. Width mode
    # blends over a FIXED lateral distance regardless of terrain height, so the carve
    # stays local to the lake. Keep the width modest (~40 m) for a gentle rim.
    mode_env = os.environ.get("WATER_FALLOFF_MODE", "width").strip().lower()
    angle = _f("WATER_FALLOFF_ANGLE", 30.0)       # deg; only used if mode=angle (kept steep/bounded-ish)
    width = _f("WATER_FALLOFF_WIDTH", 4000.0)     # cm; lateral blend distance in Width mode (~40 m)
    edge = _f("WATER_CARVE_EDGE", 256.0)
    zoff = _f("WATER_CARVE_ZOFFSET", 0.0)

    enum_cls = getattr(unreal, "WaterBrushFalloffMode", None)
    fm = getattr(enum_cls, "WIDTH" if mode_env == "width" else "ANGLE", None) if enum_cls else None
    try:
        if fm is not None:
            fs.set_editor_property("falloff_mode", fm)
        fs.set_editor_property("falloff_angle", angle)
        fs.set_editor_property("falloff_width", width)
        fs.set_editor_property("edge_offset", edge)
        fs.set_editor_property("z_offset", zoff)
    except Exception as exc:
        unreal.log_warning("[water] falloff field set failed: %s" % exc)

    blend_cls = getattr(unreal, "WaterBrushBlendType", None)
    ab = getattr(blend_cls, "ALPHA_BLEND", None) if blend_cls else None
    if ab is not None:
        try:
            hs.set_editor_property("blend_mode", ab)
        except Exception:
            pass

    # UE Python returns structs by value: write the nested struct back up the chain.
    try:
        hs.set_editor_property("falloff_settings", fs)
        comp.set_editor_property("water_heightmap_settings", hs)
        unreal.log_warning("[water] carve falloff mode=%s angle=%.1f width=%.0f edge=%.0f zoff=%.0f"
                           % (mode_env, angle, width, edge, zoff))
    except Exception as exc:
        unreal.log_warning("[water] could not write heightmap settings: %s" % exc)


def _calm_lake_waves(lake, comp):
    """A waterhole is near-still (ref photo) — only fine ripples, not the default
    Gerstner chop the Water plugin ships. We scale the wave generator amplitude
    way down (WATER_WAVE_SCALE, fraction of default). Exact API differs across
    versions, so we resolve the waves object defensively, LOG its class + any
    amplitude-ish props we find, and scale them. WATER_CALM=0 to leave default."""
    if os.environ.get("WATER_CALM", "1").strip() != "1" or comp is None:
        return
    scale = _f("WATER_WAVE_SCALE", 0.12)

    waves = None
    for src in (comp, lake):
        if src is None:
            continue
        fn = getattr(src, "get_water_waves", None)
        if callable(fn):
            try:
                waves = fn()
            except Exception:
                waves = None
        if waves is None:
            try:
                waves = src.get_editor_property("water_waves")
            except Exception:
                waves = None
        if waves is not None:
            break
    if waves is None:
        unreal.log_warning("[water] no water_waves object; cannot calm waves")
        return

    # Resolve down to the concrete UGerstnerWaterWaves:
    #   UWaterWavesAssetReference -> water_waves_asset -> UWaterWavesAsset
    #   UWaterWavesAsset          -> water_waves       -> UGerstnerWaterWaves
    obj = waves
    for prop in ("water_waves_asset", "water_waves"):
        try:
            inner = obj.get_editor_property(prop)
        except Exception:
            inner = None
        if inner is not None:
            obj = inner
    try:
        unreal.log_warning("[water] resolved waves class=%s" % obj.get_class().get_name())
    except Exception:
        pass

    scaled = 0

    # 1) Scale the Simple/Spectrum generator's amplitude range (used if regenerated).
    try:
        gen = obj.get_editor_property("gerstner_wave_generator")
    except Exception:
        gen = None
    if gen is not None:
        for prop in ("min_amplitude", "max_amplitude"):
            try:
                cur = gen.get_editor_property(prop)
            except Exception:
                continue
            if isinstance(cur, (int, float)) and cur:
                try:
                    gen.set_editor_property(prop, cur * scale)
                    unreal.log_warning("[water] generator %s %.2f -> %.2f"
                                       % (prop, cur, cur * scale))
                    scaled += 1
                except Exception:
                    pass

    # 2) Scale the BAKED FGerstnerWave array (this is what the runtime actually uses).
    try:
        arr = obj.get_editor_property("gerstner_waves")
    except Exception:
        arr = None
    if arr:
        new_arr = []
        for w in arr:
            try:
                amp = w.get_editor_property("amplitude")
                if isinstance(amp, (int, float)) and amp:
                    w.set_editor_property("amplitude", amp * scale)
                    scaled += 1
            except Exception:
                pass
            new_arr.append(w)
        try:
            obj.set_editor_property("gerstner_waves", new_arr)
            unreal.log_warning("[water] scaled %d baked Gerstner wave amplitudes x%.2f"
                               % (len(new_arr), scale))
        except Exception as exc:
            unreal.log_warning("[water] could not write gerstner_waves: %s" % exc)

    if scaled == 0:
        unreal.log_warning("[water] no scalable wave amplitude found (left default)")


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

    # Carving (UE "Affects Landscape") is OPT-IN (WATER_CARVE=1). It is OFF by default
    # because an unbounded angle-mode falloff once flattened the entire landscape (the
    # mountains) into a tent — and there is no pristine backup of the .umap. With carve
    # off the lake simply pools in the existing natural basin (mountains preserved).
    # When re-enabled, _set_carve_falloff() now uses BOUNDED Width-mode falloff so the
    # carve stays local to the lake. See _set_carve_falloff() for details.
    carve = (os.environ.get("WATER_CARVE", "0").strip() == "1")
    specs = _parse_lakes()

    # Fill each lake's NATURAL basin so the water is actually visible. We keep the
    # user's XY centre, sample the terrain within the lake's own radius to find the
    # basin FLOOR (lowest ground under the disc), and set the water surface a fixed
    # depth above it. This fills the existing depression (the original large lake
    # sat in this same basin) and does NOT rely on landscape carving, which is
    # unreliable headless. A flush "set into the ground" look comes from the natural
    # rim. Tune: WATER_DEPTH (cm above floor), BASIN_GRID. Opt out: SNAP_TO_GROUND=0.
    if os.environ.get("SNAP_TO_GROUND", "1").strip() == "1":
        depth = _f("WATER_DEPTH", 1200.0)     # cm of water above the basin floor (~12 m)
        grid = int(_f("BASIN_GRID", 28))      # (grid+1)^2 traces inside each disc
        margin = _f("RIM_MARGIN", 150.0)      # keep surface this far below the lowest rim
        w = _editor_world()
        snapped = []
        for (lx, ly, lz, lr) in specs:
            found = _lowest_point(w, lx, ly, lr, grid, hi.z, lo.z)
            if found:
                floor = found[2]
                surface = floor + depth
                # Cap the surface below the LOWEST point on the rim so the water is
                # contained by real terrain (flush shoreline, no berm) and never
                # spills past the lip. With carving off this is what shapes the lake.
                rim = _rim_min(w, lx, ly, lr, hi.z, lo.z)
                if rim is not None and (rim - margin) < surface:
                    surface = max(floor + 200.0, rim - margin)
                unreal.log_warning(
                    "[water] lake (%.0f,%.0f) floor=%.0f rim=%s -> surface=%.0f r=%.0f"
                    % (lx, ly, floor, ("%.0f" % rim) if rim is not None else "?", surface, lr))
                snapped.append((lx, ly, surface, lr))
            else:
                unreal.log_warning("[water] no terrain under (%.0f,%.0f); keeping baked z=%.0f"
                                   % (lx, ly, lz))
                snapped.append((lx, ly, lz, lr))
        specs = snapped

    for (lx, ly, lz, lr) in specs:
        _make_lake(actsub, lake_cls, lname, lx, ly, lz, lr, carve)
    unreal.log_warning("[water] authored %d lake(s)" % len(specs))

    # Spawn the player above the interior target lake (last spec) by default so the
    # streamed view starts looking at the primary watering hole. SPAWN_LAKE_INDEX overrides.
    spawn_idx = int(_f("SPAWN_LAKE_INDEX", float(len(specs) - 1)))
    spawn_idx = max(0, min(spawn_idx, len(specs) - 1))
    px, py, pz, _pr = specs[spawn_idx]
    _reposition_player_start(actsub, px, py, pz)

    _set_fly_gamemode()

    # Diagnostic probe: trace a coarse grid of terrain heights so the author log
    # reports the landscape's height relief WITHOUT needing a full cook to eyeball
    # it. After a bad carve flattened everything, a small range here means the
    # hills are still gone; a large range (hundreds of m) means they're back.
    try:
        pw = _editor_world()
        zs = []
        pn = 16
        for pi in range(pn + 1):
            for pj in range(pn + 1):
                tz = _trace_z(pw,
                              lo.x + (hi.x - lo.x) * pi / pn,
                              lo.y + (hi.y - lo.y) * pj / pn,
                              hi.z, lo.z)
                if tz is not None:
                    zs.append(tz)
        if zs:
            unreal.log_warning(
                "[water] terrain probe: n=%d zmin=%.0f zmax=%.0f relief=%.0f cm (~%.1f m)"
                % (len(zs), min(zs), max(zs), max(zs) - min(zs), (max(zs) - min(zs)) / 100.0))
        else:
            unreal.log_warning("[water] terrain probe: no hits")
    except Exception as _probe_exc:
        unreal.log_warning("[water] terrain probe failed: %s" % _probe_exc)

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
    height = _f("SPAWN_HEIGHT", 40000)   # cm above the water surface; framed for a ~520 m lake
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
