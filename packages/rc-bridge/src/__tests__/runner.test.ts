import type { WorldAPICall } from "@yellow-ue/world-api";
import { describe, expect, it } from "vitest";

import type { RCBridge } from "../client.js";
import type { RCFunctionCall, RCResponse } from "../contract.js";
import { CREATURE_DIRECTOR_PATH } from "../creatures.js";
import { runPlan } from "../runner.js";

/** A fake bridge that records every RC call and always succeeds. */
function recordingBridge() {
  const calls: RCFunctionCall[] = [];
  const bridge: RCBridge = {
    callFunction: async (req: RCFunctionCall): Promise<RCResponse> => {
      calls.push(req);
      return {
        ok: true,
        httpStatus: 200,
        latencyMs: 1,
        requestId: "test",
        wire: { method: "PUT", url: "test", body: req },
        returnValue: {},
      };
    },
    setProperty: async (): Promise<RCResponse> => {
      throw new Error("not used");
    },
  };
  return { bridge, calls };
}

// The brain's elephant plan (matches FakeProvider._match_creatures output).
const ELEPHANT_PLAN: WorldAPICall[] = [
  { tool: "SpawnCreature", args: { species: "elephant_adult", id: "matriarch", at: "herd_start" } },
  { tool: "SpawnCreature", args: { species: "elephant_baby", id: "calf", at: "herd_start" } },
  { tool: "SetCreatureLeader", args: { id: "calf", leader_id: "matriarch", distance_m: 4 } },
  { tool: "MoveCreatureTo", args: { id: "matriarch", to: "watering_hole" } },
  { tool: "Wait", args: { seconds: 75 } },
  { tool: "SetCreatureState", args: { id: "matriarch", state: "drink" } },
  { tool: "Wait", args: { seconds: 4 } },
  { tool: "SetCreatureState", args: { id: "calf", state: "drink" } },
];

describe("runPlan — elephant scene", () => {
  it("bootstraps each species once + the waterline, then runs the scene", async () => {
    const { bridge, calls } = recordingBridge();
    let slept = 0;
    const steps = await runPlan(ELEPHANT_PLAN, bridge, {
      sleep: async (ms) => {
        slept += ms;
      },
    });

    const fns = calls.map((c) => c.functionName);
    // Bootstrap injected before the first spawn of each species, water once.
    expect(fns).toEqual([
      "DefineCreatureType", // adult bootstrap
      "SetWaterLevel", // herd_start waterline
      "SpawnCreature", // matriarch
      "DefineCreatureType", // baby bootstrap
      "SpawnCreature", // calf
      "SetCreatureLeader",
      "FollowPath", // MoveCreatureTo -> approach path
      "SetCreatureState", // matriarch drink
      "SetCreatureState", // calf drink
    ]);

    // Wait is intercepted locally — slept the right total, never sent to UE.
    expect(slept).toBe((75 + 4) * 1000);
    expect(fns).not.toContain("Wait");

    // Every RC call targets the CreatureDirector.
    expect(calls.every((c) => c.objectPath === CREATURE_DIRECTOR_PATH)).toBe(true);

    // The step log records the two waits.
    expect(steps.filter((s) => s.kind === "wait")).toHaveLength(2);
  });

  it("resolves intent to pack facts + coordinates", async () => {
    const { bridge, calls } = recordingBridge();
    await runPlan(ELEPHANT_PLAN, bridge, { sleep: async () => {} });

    const define = calls.find((c) => c.functionName === "DefineCreatureType");
    expect(define?.parameters).toMatchObject({
      Type: "elephant_adult",
      MeshPath: "/Game/Elephant/Meshes/SK_Elephant_Re.SK_Elephant_Re",
      MeshYawOffset: -90,
    });

    const spawn = calls.find(
      (c) => c.functionName === "SpawnCreature" && c.parameters?.Id === "matriarch",
    );
    // Resolved near the herd_start landmark (408400, 719700) with small scatter.
    expect(Math.abs((spawn?.parameters?.X as number) - 408400)).toBeLessThan(400);
    expect(Math.abs((spawn?.parameters?.Y as number) - 719700)).toBeLessThan(400);

    const leader = calls.find((c) => c.functionName === "SetCreatureLeader");
    // 4 m -> 400 cm.
    expect(leader?.parameters).toMatchObject({ Distance: 400 });

    const follow = calls.find((c) => c.functionName === "FollowPath");
    expect(follow?.parameters?.PointsCsv).toContain("479552,625856");
  });

  it("WaitForArrival polls QueryCreature until arrived, then proceeds", async () => {
    const calls: RCFunctionCall[] = [];
    let polls = 0;
    const bridge: RCBridge = {
      callFunction: async (req: RCFunctionCall): Promise<RCResponse> => {
        calls.push(req);
        let returnValue: unknown = {};
        if (req.functionName === "QueryCreature") {
          polls += 1;
          const arrived = polls >= 2; // arrive on the 2nd poll
          returnValue = {
            ReturnValue: JSON.stringify({
              id: "matriarch",
              type: "elephant_adult",
              state: arrived ? "idle" : "walk",
              x: 1,
              y: 2,
              z: 3,
              speed: arrived ? 0 : 200,
              arrived,
              atWater: arrived,
            }),
          };
        }
        return {
          ok: true,
          httpStatus: 200,
          latencyMs: 1,
          requestId: "t",
          wire: { method: "PUT", url: "t", body: req },
          returnValue,
        };
      },
      setProperty: async (): Promise<RCResponse> => {
        throw new Error("not used");
      },
    };

    const plan: WorldAPICall[] = [
      { tool: "MoveCreatureTo", args: { id: "matriarch", to: "watering_hole" } },
      { tool: "WaitForArrival", args: { id: "matriarch", timeout_seconds: 10 } },
      { tool: "SetCreatureState", args: { id: "matriarch", state: "drink" } },
    ];
    const steps = await runPlan(plan, bridge, {
      sleep: async () => {},
      arrivalPollMs: 100,
    });

    const queries = calls.filter((c) => c.functionName === "QueryCreature");
    expect(queries.length).toBeGreaterThanOrEqual(2);

    // The drink only fires after the final (arrived) poll.
    const order = calls.map((c) => c.functionName);
    expect(order.indexOf("SetCreatureState")).toBeGreaterThan(
      order.lastIndexOf("QueryCreature"),
    );

    const wait = steps.find((s) => s.tool === "WaitForArrival");
    expect(wait?.detail).toContain("arrived");
    // A WaitForArrival is never forwarded to UE as a function call by name.
    expect(order).not.toContain("WaitForArrival");
  });

  it("stops on the first RC failure", async () => {
    const calls: RCFunctionCall[] = [];
    const bridge: RCBridge = {
      callFunction: async (req): Promise<RCResponse> => {
        calls.push(req);
        return {
          ok: false,
          httpStatus: 500,
          latencyMs: 1,
          requestId: "t",
          wire: { method: "PUT", url: "t", body: req },
          error: "boom",
        };
      },
      setProperty: async (): Promise<RCResponse> => {
        throw new Error("not used");
      },
    };
    const steps = await runPlan(ELEPHANT_PLAN, bridge, { sleep: async () => {} });
    // First bootstrap call fails -> we stop immediately.
    expect(calls).toHaveLength(1);
    expect(steps).toHaveLength(1);
  });
});
