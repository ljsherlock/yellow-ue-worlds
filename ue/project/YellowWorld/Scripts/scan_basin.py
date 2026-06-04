"""Read-only: find distinct low basins (watering-hole candidates) across the map.

Greedy spatial separation so we don't report 8 samples from the same pan:
pick the lowest sample, exclude everything within EXCLUDE_R, repeat. Reports
each basin's world XY, floor Z, nearby rim, and which map quadrant it's in
(to cross-reference the listing image). No mutation.
"""

import os
import re

import unreal

MARGIN = 0.08         # skip this fraction of each edge
GRID = 56             # (GRID+1)^2 samples
EXCLUDE_R = 70000.0   # cm: min separation between reported basins (~700 m)
RIM_R = 35000.0       # cm: ring radius to estimate the basin rim
N_BASINS = 8


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


def main():
    map_path = os.environ.get("MAP", "").strip()
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    actsub = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    les.load_level(map_path)
    actors = actsub.get_all_level_actors()
    lands = [a for a in actors if a.get_class().get_name() == "Landscape"]
    lo, hi = _union_bounds(lands or actors)
    if lo is None:
        unreal.log_warning("[basin] no bounds")
        return

    x0 = lo.x + (hi.x - lo.x) * MARGIN
    x1 = lo.x + (hi.x - lo.x) * (1 - MARGIN)
    y0 = lo.y + (hi.y - lo.y) * MARGIN
    y1 = lo.y + (hi.y - lo.y) * (1 - MARGIN)
    midx = (lo.x + hi.x) * 0.5
    midy = (lo.y + hi.y) * 0.5
    w = _world()

    pts = []
    for i in range(GRID + 1):
        for j in range(GRID + 1):
            x = x0 + (x1 - x0) * i / GRID
            y = y0 + (y1 - y0) * j / GRID
            z = _trace_z(w, x, y, hi.z, lo.z)
            if z is not None:
                pts.append((x, y, z))
    if not pts:
        unreal.log_warning("[basin] no hits")
        return

    unreal.log_warning("[basin] samples=%d  Zmin=%.0f Zmax=%.0f"
                       % (len(pts), min(p[2] for p in pts), max(p[2] for p in pts)))

    chosen = []
    remaining = sorted(pts, key=lambda p: p[2])
    while remaining and len(chosen) < N_BASINS:
        c = remaining[0]
        chosen.append(c)
        remaining = [p for p in remaining
                     if (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 > EXCLUDE_R ** 2]

    for idx, (x, y, z) in enumerate(chosen):
        rim = z
        for (px, py, pz) in pts:
            if (px - x) ** 2 + (py - y) ** 2 <= RIM_R ** 2 and pz > rim:
                rim = pz
        quad = ("%sX %sY" % ("low" if x < midx else "high",
                             "low" if y < midy else "high"))
        edge = "EDGE" if (x < x0 + (x1 - x0) * 0.1 or x > x1 - (x1 - x0) * 0.1 or
                          y < y0 + (y1 - y0) * 0.1 or y > y1 - (y1 - y0) * 0.1) else "interior"
        unreal.log_warning(
            "[basin] #%d (%.0f,%.0f) floor=%.0f rim~%.0f depth~%.0f %s %s"
            % (idx, x, y, z, rim, rim - z, quad, edge))


if __name__ == "__main__":
    main()
