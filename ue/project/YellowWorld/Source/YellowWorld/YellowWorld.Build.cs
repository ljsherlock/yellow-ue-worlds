using System.IO;
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
			// StreamBridge hosts a native UPixelStreaming2Input subobject so it can
			// receive UI interactions (camera buttons) from the browser and push
			// creature state back. Header lives under PixelStreaming2/Internal.
			"PixelStreaming2",
		});

		// UPixelStreaming2Input is declared in the PixelStreaming2 module's
		// Internal/ folder. Project modules (unlike modules inside the same plugin,
		// e.g. PixelStreaming2RTC) don't get a module's Internal include path
		// automatically, so add it explicitly. This is a stable built-in engine
		// plugin path.
		PrivateIncludePaths.Add(Path.Combine(
			EngineDirectory, "Plugins", "Media", "PixelStreaming2",
			"Source", "PixelStreaming2", "Internal"));
	}
}
