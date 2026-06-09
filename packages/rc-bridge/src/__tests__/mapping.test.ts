import { describe, expect, it } from "vitest";
import { WORLD_DIRECTOR_PATH, toRCFunctionCall } from "../mapping.js";

describe("toRCFunctionCall", () => {
  it("maps a sky mood to WorldDirector.SetWeatherPreset", () => {
    // The brain's named moods drive SetWeatherPreset(FString); the float-based
    // SetSkyState(pitch,cloud,fog) is a different, legacy entry point.
    const rc = toRCFunctionCall({
      tool: "SetSkyState",
      args: { preset: "storm" },
    });
    expect(rc.objectPath).toBe(WORLD_DIRECTOR_PATH);
    expect(rc.functionName).toBe("SetWeatherPreset");
    expect(rc.parameters).toMatchObject({ Preset: "storm" });
  });

  it("maps AdvanceTime to WorldDirector.SetTimeOfDay (absolute hour)", () => {
    const rc = toRCFunctionCall({
      tool: "AdvanceTime",
      args: { hours: 6, speed_multiplier: 100 },
    });
    expect(rc.functionName).toBe("SetTimeOfDay");
    expect(rc.parameters).toMatchObject({ Hours: 6 });
  });

  it("maps SpawnTrees flattening area + defaults", () => {
    const rc = toRCFunctionCall({
      tool: "SpawnTrees",
      args: {
        area: { center: { x: 1, y: 2, z: 3 }, radius: 10 },
        count: 50,
        species: "oak",
      },
    });
    expect(rc.functionName).toBe("SpawnTrees");
    expect(rc.parameters).toMatchObject({
      CenterX: 1,
      CenterY: 2,
      CenterZ: 3,
      Radius: 10,
      Count: 50,
      Species: "oak",
      GrowthStage: "mature",
    });
  });
});
