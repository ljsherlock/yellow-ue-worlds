using UnrealBuildTool;
using System.Collections.Generic;

public class YellowWorldTarget : TargetRules
{
	public YellowWorldTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.V6;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("YellowWorld");
	}
}
