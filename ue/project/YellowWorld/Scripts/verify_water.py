"""Read-only: load the map in a -nullrhi commandlet and confirm the lake loads
without the Slate assertion. Lists water actors + the lake's location."""
import os

import unreal


def main():
    map_path = os.environ.get("MAP", "").strip()
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    actsub = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    les.load_level(map_path)
    actors = actsub.get_all_level_actors()
    unreal.log_warning("[verify] total actors=%d" % len(actors))
    for a in actors:
        cls = a.get_class().get_name()
        if "Water" in cls:
            loc = a.get_actor_location()
            unreal.log_warning("[verify] WATER %s class=%s loc=(%.0f,%.0f,%.0f)"
                               % (a.get_name(), cls, loc.x, loc.y, loc.z))
    unreal.log_warning("[verify] DONE")


if __name__ == "__main__":
    main()
