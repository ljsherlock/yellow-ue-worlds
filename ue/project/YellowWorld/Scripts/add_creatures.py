"""Author an ACreatureDirector into an imported map, headless.

Runs as a pre-cook step in the dev-5.7 container (no GUI, -nullrhi is fine — a
plain AActor needs no Slate, unlike WaterBodyLake):

    MAP=/Game/<pack>/<...>/Map \
    UnrealEditor-Cmd YellowWorld.uproject \
        -run=pythonscript -script=Scripts/add_creatures.py \
        -unattended -nullrhi -nosplash -nopause -stdout

The director is the single RC entry point the brain (or our scene script) drives
to spawn and choreograph creatures at *runtime* — mirroring how WorldDirector
owns atmosphere. We only need to bake the director actor into the level so RC
can address it by object path; creature *types* are registered at runtime via
DefineCreatureType and creatures spawned via SpawnCreature, so no art is
referenced here (the pack is force-cooked via DirectoriesToAlwaysCook).

Idempotent: removes any prior director we added (tagged) before re-adding.
Logs the director's object path — copy that into the runtime scene driver.
"""

import os

import unreal

DIRECTOR_TAG = "yellow_creature_director"


def main():
    map_path = os.environ.get("MAP", "").strip()
    if not map_path:
        raise RuntimeError("MAP env not set")

    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    actsub = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    if not les.load_level(map_path):
        raise RuntimeError("load_level failed for " + map_path)

    # Idempotent: remove any director we added previously.
    removed = 0
    for a in actsub.get_all_level_actors():
        try:
            tags = [str(t) for t in a.get_editor_property("tags")]
        except Exception:
            tags = []
        if DIRECTOR_TAG in tags:
            actsub.destroy_actor(a)
            removed += 1

    cls = getattr(unreal, "CreatureDirector", None)
    if cls is None:
        try:
            cls = unreal.load_class(None, "/Script/YellowWorld.CreatureDirector")
        except Exception as exc:
            raise RuntimeError("CreatureDirector class not found (recompile C++?): %s" % exc)

    director = actsub.spawn_actor_from_class(cls, unreal.Vector(0, 0, 0), unreal.Rotator(0, 0, 0))
    if director is None:
        raise RuntimeError("spawn CreatureDirector returned None")
    try:
        director.set_editor_property("tags", [DIRECTOR_TAG])
    except Exception:
        pass
    try:
        director.set_actor_label("CreatureDirector")
    except Exception:
        pass

    # This path is what Remote Control addresses at runtime. It is stable across
    # cook (the saved actor keeps its name), so bake it into the scene driver.
    unreal.log_warning("[creatures] CreatureDirector path=%s (removed %d prior)"
                       % (director.get_path_name(), removed))

    if not les.save_current_level():
        raise RuntimeError("save_current_level failed for " + map_path)
    unreal.log_warning("[creatures] saved %s" % map_path)


if __name__ == "__main__":
    main()
