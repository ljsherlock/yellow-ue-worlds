import { describe, expect, it } from "vitest";

import type { RCBridge } from "../client.js";
import type { RCFunctionCall, RCResponse } from "../contract.js";
import { CREATURE_DIRECTOR_PATH } from "../creatures.js";
import {
  drainEventLoop,
  drainEventsCall,
  parseEvents,
  type CreatureEvent,
} from "../perception.js";

const ok = (returnValue: unknown): RCResponse => ({
  ok: true,
  httpStatus: 200,
  latencyMs: 1,
  requestId: "t",
  wire: { method: "PUT", url: "t", body: {} as RCFunctionCall },
  returnValue,
});

describe("drainEventsCall", () => {
  it("targets the CreatureDirector with no transaction", () => {
    const call = drainEventsCall();
    expect(call.functionName).toBe("DrainEvents");
    expect(call.objectPath).toBe(CREATURE_DIRECTOR_PATH);
    expect(call.generateTransaction).toBe(false);
  });
});

describe("parseEvents", () => {
  it("unwraps the ReturnValue envelope into typed events", () => {
    const wire = {
      ReturnValue: JSON.stringify([
        { id: "a01", event: "atWater" },
        { id: "a02", event: "thirsty" },
      ]),
    };
    expect(parseEvents(wire)).toEqual([
      { id: "a01", event: "atWater" },
      { id: "a02", event: "thirsty" },
    ]);
  });

  it("drops malformed entries and tolerates junk", () => {
    const wire = {
      ReturnValue: JSON.stringify([
        { id: "a01", event: "tired" },
        { id: 7 },
        { event: "atWater" },
        null,
      ]),
    };
    expect(parseEvents(wire)).toEqual([{ id: "a01", event: "tired" }]);
  });

  it("returns [] for absent or unparseable payloads", () => {
    expect(parseEvents(undefined)).toEqual([]);
    expect(parseEvents({ ReturnValue: "not json" })).toEqual([]);
    expect(parseEvents({ ReturnValue: JSON.stringify({}) })).toEqual([]);
  });
});

describe("drainEventLoop", () => {
  it("drains on an interval, delivers only non-empty batches, and stops", async () => {
    // Three drains: a batch, an empty tick, then a final batch — then stop.
    const batches: CreatureEvent[][] = [
      [{ id: "a01", event: "atWater" }],
      [],
      [{ id: "a02", event: "thirsty" }],
    ];
    const calls: RCFunctionCall[] = [];
    let drains = 0;
    const bridge: RCBridge = {
      callFunction: async (req: RCFunctionCall): Promise<RCResponse> => {
        calls.push(req);
        const batch = batches[Math.min(drains, batches.length - 1)] ?? [];
        drains += 1;
        return ok({ ReturnValue: JSON.stringify(batch) });
      },
      setProperty: async (): Promise<RCResponse> => {
        throw new Error("not used");
      },
    };

    const received: CreatureEvent[] = [];
    await drainEventLoop(
      bridge,
      (events) => {
        received.push(...events);
      },
      {
        sleep: async () => {},
        // Stop once we've drained all three scripted ticks.
        stop: () => drains >= batches.length,
      },
    );

    expect(calls.every((c) => c.functionName === "DrainEvents")).toBe(true);
    // The empty middle tick is never delivered to the handler.
    expect(received).toEqual([
      { id: "a01", event: "atWater" },
      { id: "a02", event: "thirsty" },
    ]);
  });
});
