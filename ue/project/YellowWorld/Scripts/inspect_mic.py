"""Read-only: load MI_SavannahWater and dump its overridden scalar/vector
parameters so we can confirm the author pass applied the lighter color AND the
reduced ripple (normal-strength) scalars before paying for a cook. NEVER saves.
"""
import unreal

MIC = "/Game/Water/MI_SavannahWater"
WATCH_VEC = ("Scattering", "Absorption", "Water Albedo")
WATCH_SCAL = ("Water Roughness", "Water Specular",
              "Default Near Normal Strength",
              "Default Distant Normal Strength",
              "Default Distant Normal StrengthB")


def main():
    mic = unreal.EditorAssetLibrary.load_asset(MIC)
    if mic is None:
        unreal.log_warning("[mic] MISSING %s" % MIC)
        return
    base = mic
    try:
        base = mic.get_base_material()
    except Exception:
        pass
    unreal.log_warning("[mic] %s parent=%s" % (mic.get_name(), base.get_name() if base else "?"))
    for n in WATCH_VEC:
        try:
            v = unreal.MaterialEditingLibrary.get_material_instance_vector_parameter_value(mic, n)
            unreal.log_warning("[mic] VEC %-16s = (%.3f, %.3f, %.3f)" % (n, v.r, v.g, v.b))
        except Exception as e:
            unreal.log_warning("[mic] VEC %-16s ERR %s" % (n, e))
    for n in WATCH_SCAL:
        try:
            s = unreal.MaterialEditingLibrary.get_material_instance_scalar_parameter_value(mic, n)
            unreal.log_warning("[mic] SCAL %-30s = %.4f" % (n, s))
        except Exception as e:
            unreal.log_warning("[mic] SCAL %-30s ERR %s" % (n, e))
    unreal.log_warning("[mic] DONE (no save)")


main()
