using UnrealBuildTool;
using System.Collections.Generic;

public class YellowWorldEditorTarget : TargetRules
{
	public YellowWorldEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		// V6 matches the prebuilt engine's build environment in the dev-5.7
		// container; V5 diverged on UndefinedIdentifierWarningLevel and UBT
		// rejects targets that modify shared-engine build settings.
		DefaultBuildSettings = BuildSettingsVersion.V6;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("YellowWorld");
	}
}
