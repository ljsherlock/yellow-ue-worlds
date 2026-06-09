"""Author an AWorldDirector into an imported map, headless.

Runs as a pre-cook step in the dev-5.7 container (no GUI, -nullrhi is fine — a
plain AActor needs no Slate):

    MAP=/Game/<pack>/<...>/Map \
    UnrealEditor-Cmd YellowWorld.uproject \
        -run=pythonscript -script=Scripts/add_worlddirector.py \
        -unattended -nullrhi -nosplash -nopause -stdout

WorldDirector is the atmosphere/sky/time entry point the brain drives over
Remote Control. On the procedural Spike map make_map.py spawns it; imported packs
(e.g. the Savannah) ship their own sun/sky/fog but NO director, so SetSkyState /
SetWeatherPreset / SetTimeOfDay had nothing to call (RC errored "WorldDirector_0
does not exist"). WorldDirector::CacheActors() finds the existing lighting actors
via FindFirst<T> at BeginPlay, so simply baking the director in lets it drive the
pack's own sun/sky — no lighting art is created or referenced here.

Idempotent: removes any prior director we added (tagged) before re-adding.
Logs the director's object path — copy that into the runtime scene driver.
"""

import os

import unreal

DIRECTOR_TAG = "yellow_world_director"


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

    cls = getattr(unreal, "WorldDirector", None)
    if cls is None:
        try:
            cls = unreal.load_class(None, "/Script/YellowWorld.WorldDirector")
        except Exception as exc:
            raise RuntimeError("WorldDirector class not found (recompile C++?): %s" % exc)

    director = actsub.spawn_actor_from_class(cls, unreal.Vector(0, 0, 0), unreal.Rotator(0, 0, 0))
    if director is None:
        raise RuntimeError("spawn WorldDirector returned None")
    try:
        director.set_editor_property("tags", [DIRECTOR_TAG])
    except Exception:
        pass
    try:
        director.set_actor_label("WorldDirector")
    except Exception:
        pass

    # This path is what Remote Control addresses at runtime. It is stable across
    # cook (the saved actor keeps its name), so bake it into the scene driver.
    unreal.log_warning("[worlddirector] WorldDirector path=%s (removed %d prior)"
                       % (director.get_path_name(), removed))

    if not les.save_current_level():
        raise RuntimeError("save_current_level failed for " + map_path)
    unreal.log_warning("[worlddirector] saved %s" % map_path)


if __name__ == "__main__":
    main()
