using UnrealBuildTool;

public class YellowWorld : ModuleRules
{
	public YellowWorld(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"InputCore"
		});

		// Remote Control is enabled as a plugin (see YellowWorld.uproject) and
		// activated at runtime with -RCWebControlEnable; the WorldDirector only
		// needs engine types, so no extra private deps are required yet.
		PrivateDependencyModuleNames.AddRange(new string[]
		{
			"Json",
			"JsonUtilities",
		});
	}
}
