"""Read-only water diagnostic. Loads the savanna map and, for each WaterBodyLake,
dumps: location, the assigned water material, and the full wave object chain
(UWaterWavesAssetReference -> water_waves_asset -> water_waves ->
UGerstnerWaterWaves -> gerstner_wave_generator + baked gerstner_waves[]).
This tells us whether the saved map has a populated, scalable wave asset (scale
it) or an empty reference (we must CREATE + ASSIGN calm waves). NEVER saves.
"""
import unreal

MAP = "/Game/8KSavannahLandscapePack/Scenes/Landscapes/Landscape_1"


def _comp(lake):
    for getter in ("get_water_body_component", "water_body_component"):
        obj = getattr(lake, getter, None)
        if obj is not None:
            try:
                c = obj() if callable(obj) else obj
                if c is not None:
                    return c
            except Exception:
                pass
    try:
        return lake.get_component_by_class(unreal.WaterBodyComponent)
    except Exception:
        return None


def _waves(comp):
    fn = getattr(comp, "get_water_waves", None)
    if callable(fn):
        try:
            w = fn()
            if w is not None:
                return w
        except Exception:
            pass
    try:
        return comp.get_editor_property("water_waves")
    except Exception:
        return None


def _cls(o):
    try:
        return o.get_class().get_name()
    except Exception:
        return str(o)


def main():
    try:
        unreal.EditorLoadingAndSavingUtils.load_map(MAP)
    except Exception as e:
        unreal.log_warning("[wi] load_map failed: %s" % e)

    actsub = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    lakes = [a for a in actsub.get_all_level_actors()
             if "WaterBody" in a.get_class().get_name()]
    unreal.log_warning("[wi] water bodies=%d" % len(lakes))

    for lake in lakes:
        loc = lake.get_actor_location()
        unreal.log_warning("[wi] %s class=%s loc=(%.0f,%.0f,%.0f)"
                           % (lake.get_actor_label(), _cls(lake), loc.x, loc.y, loc.z))
        comp = _comp(lake)
        if comp is None:
            unreal.log_warning("[wi]   no component")
            continue
        try:
            mat = comp.get_editor_property("water_material")
            unreal.log_warning("[wi]   water_material=%s" % (mat.get_name() if mat else None))
        except Exception:
            pass

        wb = _waves(comp)
        unreal.log_warning("[wi]   water_waves=%s class=%s" % (wb, _cls(wb) if wb else None))
        obj = wb
        for prop in ("water_waves_asset", "water_waves"):
            nxt = None
            try:
                nxt = obj.get_editor_property(prop) if obj else None
            except Exception:
                nxt = None
            unreal.log_warning("[wi]     .%s -> %s (%s)" % (prop, nxt, _cls(nxt) if nxt else None))
            if nxt is not None:
                obj = nxt
        # obj should now be the UGerstnerWaterWaves (or still the reference if empty)
        try:
            gen = obj.get_editor_property("gerstner_wave_generator")
        except Exception:
            gen = None
        unreal.log_warning("[wi]     gerstner_wave_generator=%s (%s)" % (gen, _cls(gen) if gen else None))
        if gen is not None:
            for p in ("num_waves", "min_amplitude", "max_amplitude", "min_wavelength", "max_wavelength"):
                try:
                    unreal.log_warning("[wi]       gen.%s=%s" % (p, gen.get_editor_property(p)))
                except Exception:
                    pass
        try:
            arr = obj.get_editor_property("gerstner_waves")
        except Exception:
            arr = None
        if arr:
            amps = []
            for w in arr[:6]:
                try:
                    amps.append(round(w.get_editor_property("amplitude"), 1))
                except Exception:
                    pass
            unreal.log_warning("[wi]     gerstner_waves: count=%d sample_amps=%s" % (len(arr), amps))
        else:
            unreal.log_warning("[wi]     gerstner_waves: empty/none")

    unreal.log_warning("[wi] DONE (no save)")
    try:
        w = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
        unreal.SystemLibrary.execute_console_command(w, "QUIT_EDITOR")
    except Exception:
        pass


main()
