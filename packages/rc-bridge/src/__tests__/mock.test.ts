import {
  InMemorySink,
  resetTracingForTests,
  setSink,
} from "@yellow-ue/tracing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MockRCBridge } from "../mock.js";

const fixed = { latencyMs: 0, sleep: false, requestId: () => "rc-test" } as const;

beforeEach(() => resetTracingForTests());
afterEach(() => resetTracingForTests());

describe("MockRCBridge — callFunction", () => {
  it("builds the RC /remote/object/call wire request", async () => {
    const bridge = new MockRCBridge({ ...fixed, baseUrl: "http://ue:30010" });
    const res = await bridge.callFunction({
      objectPath: "/Game/X.X:PersistentLevel.Director_0",
      functionName: "SetSkyState",
      parameters: { Preset: "storm" },
    });
    expect(res.ok).toBe(true);
    expect(res.httpStatus).toBe(200);
    expect(res.wire.method).toBe("PUT");
    expect(res.wire.url).toBe("http://ue:30010/remote/object/call");
    expect(res.wire.body).toMatchObject({
      functionName: "SetSkyState",
      parameters: { Preset: "storm" },
      generateTransaction: true,
    });
  });

  it("reports the simulated latency", async () => {
    const bridge = new MockRCBridge({ ...fixed, latencyMs: 123 });
    const res = await bridge.callFunction({
      objectPath: "/x",
      functionName: "Ping",
    });
    expect(res.latencyMs).toBe(123);
  });

  it("simulates failures via failOn", async () => {
    const bridge = new MockRCBridge({
      ...fixed,
      failOn: () => "ETIMEDOUT after 5000ms",
    });
    const res = await bridge.callFunction({ objectPath: "/x", functionName: "F" });
    expect(res.ok).toBe(false);
    expect(res.httpStatus).toBe(502);
    expect(res.error).toContain("ETIMEDOUT");
  });
});

describe("MockRCBridge — setProperty", () => {
  it("builds the RC /remote/object/property wire request", async () => {
    const bridge = new MockRCBridge(fixed);
    const res = await bridge.setProperty({
      objectPath: "/x",
      propertyName: "SkyPreset",
      propertyValue: "night",
    });
    expect(res.wire.url).toContain("/remote/object/property");
    expect(res.wire.body).toMatchObject({
      propertyName: "SkyPreset",
      propertyValue: "night",
      access: "WRITE_TRANSACTION_ACCESS",
    });
    expect(res.returnValue).toMatchObject({ SkyPreset: "night" });
  });
});

describe("MockRCBridge — tracing (R3)", () => {
  it("emits a rc-bridge.callFunction boundary event", async () => {
    const sink = new InMemorySink();
    setSink(sink);
    const bridge = new MockRCBridge(fixed);
    await bridge.callFunction({ objectPath: "/x", functionName: "F" });
    expect(sink.byPrefix("rc-bridge.")).toHaveLength(1);
    expect(sink.events[0]?.name).toBe("rc-bridge.callFunction");
  });
});
