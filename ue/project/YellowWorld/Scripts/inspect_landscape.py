"""Read-only landscape diagnostic. Loads the savanna map, measures terrain
relief via a coarse grid of vertical line-traces, and lists the landscape's
edit layers. NEVER saves — safe to run against a damaged map to confirm state
and recoverability (a separate base sculpt layer => the water carve is
non-destructive and the hills can be restored by clearing the water layer).

Run headless like the author pass:
  UnrealEditor YellowWorld.uproject -ExecCmds='py .../inspect_landscape.py' ...
"""
import re
import unreal

MAP = "/Game/8KSavannahLandscapePack/Scenes/Landscapes/Landscape_1"


def _world():
    return unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()


def _trace_z(w, x, y, top, bot):
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


def main():
    try:
        unreal.EditorLoadingAndSavingUtils.load_map(MAP)
    except Exception as e:
        unreal.log_warning("[inspect] load_map failed: %s" % e)

    actsub = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    actors = actsub.get_all_level_actors()
    lands = [a for a in actors
             if a.get_class().get_name() in ("Landscape", "LandscapeStreamingProxy", "LandscapeProxy")]
    unreal.log_warning("[inspect] landscape actors=%d" % len(lands))

    lo = hi = None
    for a in lands:
        try:
            o, e = a.get_actor_bounds(False)
        except Exception:
            continue
        amin = unreal.Vector(o.x - e.x, o.y - e.y, o.z - e.z)
        amax = unreal.Vector(o.x + e.x, o.y + e.y, o.z + e.z)
        unreal.log_warning("[inspect] %s class=%s boundsZ=[%.0f..%.0f] Zextent=%.0f cm (~%.1f m)"
                           % (a.get_actor_label(), a.get_class().get_name(),
                              amin.z, amax.z, 2 * e.z, (2 * e.z) / 100.0))
        if lo is None:
            lo, hi = amin, amax
        else:
            lo = unreal.Vector(min(lo.x, amin.x), min(lo.y, amin.y), min(lo.z, amin.z))
            hi = unreal.Vector(max(hi.x, amax.x), max(hi.y, amax.y), max(hi.z, amax.z))
        for prop in ("edit_layers", "layers", "landscape_edit_layers"):
            try:
                ls = a.get_editor_property(prop)
            except Exception:
                ls = None
            if ls:
                names = []
                for x in ls:
                    try:
                        names.append(str(x.get_editor_property("name")))
                    except Exception:
                        names.append(str(x))
                unreal.log_warning("[inspect] %s.%s (%d): %s"
                                   % (a.get_actor_label(), prop, len(ls), names))

    if lo is None:
        lo, hi = unreal.Vector(0, 0, -20000), unreal.Vector(800000, 800000, 40000)

    w = _world()
    zs = []
    n = 20
    for i in range(n + 1):
        for j in range(n + 1):
            z = _trace_z(w,
                         lo.x + (hi.x - lo.x) * i / n,
                         lo.y + (hi.y - lo.y) * j / n,
                         hi.z, lo.z)
            if z is not None:
                zs.append(z)
    if zs:
        zs.sort()
        unreal.log_warning(
            "[inspect] terrain probe n=%d zmin=%.0f zmax=%.0f relief=%.0f cm (~%.1f m) median=%.0f"
            % (len(zs), zs[0], zs[-1], zs[-1] - zs[0], (zs[-1] - zs[0]) / 100.0, zs[len(zs) // 2]))
    else:
        unreal.log_warning("[inspect] terrain probe: no hits")

    unreal.log_warning("[inspect] DONE (no save)")
    try:
        unreal.SystemLibrary.execute_console_command(w, "QUIT_EDITOR")
    except Exception:
        pass


main()
