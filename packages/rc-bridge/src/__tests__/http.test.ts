import {
  InMemorySink,
  resetTracingForTests,
  setSink,
} from "@yellow-ue/tracing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HttpRCBridge } from "../http.js";

beforeEach(() => resetTracingForTests());
afterEach(() => resetTracingForTests());

/** Build a fake fetch that records the request and returns a canned response. */
function stubFetch(response: { status?: number; body?: unknown } = {}): {
  fetch: typeof fetch;
  calls: Array<{ url: string; init?: RequestInit | undefined }>;
} {
  const calls: Array<{ url: string; init?: RequestInit | undefined }> = [];
  const status = response.status ?? 200;
  const body = response.body === undefined ? { ReturnValue: true } : response.body;
  const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () =>
        typeof body === "string" ? body : JSON.stringify(body),
    } as Response;
  });
  return { fetch: fetchImpl as unknown as typeof fetch, calls };
}

describe("HttpRCBridge — callFunction", () => {
  it("PUTs the verified /remote/object/call wire request", async () => {
    const { fetch, calls } = stubFetch({ body: { ReturnValue: true } });
    const bridge = new HttpRCBridge({
      baseUrl: "http://127.0.0.1:30010/",
      fetchImpl: fetch,
      requestId: () => "rc-test",
    });

    const res = await bridge.callFunction({
      objectPath: "/Game/Maps/Spike.Spike:PersistentLevel.WorldDirector_0",
      functionName: "SetTimeOfDay",
      parameters: { Hours: 18 },
    });

    expect(res.ok).toBe(true);
    expect(res.httpStatus).toBe(200);
    // trailing slash on baseUrl is normalized away
    expect(calls[0]?.url).toBe("http://127.0.0.1:30010/remote/object/call");
    expect(calls[0]?.init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      objectPath: "/Game/Maps/Spike.Spike:PersistentLevel.WorldDirector_0",
      functionName: "SetTimeOfDay",
      parameters: { Hours: 18 },
      generateTransaction: true,
    });
    expect(res.returnValue).toMatchObject({ ReturnValue: true });
  });

  it("maps a non-2xx response to ok:false with the error body", async () => {
    const { fetch } = stubFetch({ status: 404, body: "object not found" });
    const bridge = new HttpRCBridge({ fetchImpl: fetch });
    const res = await bridge.callFunction({
      objectPath: "/x",
      functionName: "Nope",
    });
    expect(res.ok).toBe(false);
    expect(res.httpStatus).toBe(404);
    expect(res.error).toContain("object not found");
  });

  it("maps a network throw to ok:false (httpStatus 0)", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const bridge = new HttpRCBridge({ fetchImpl });
    const res = await bridge.callFunction({ objectPath: "/x", functionName: "F" });
    expect(res.ok).toBe(false);
    expect(res.httpStatus).toBe(0);
    expect(res.error).toContain("ECONNREFUSED");
  });

  it("emits a rc-bridge.http boundary trace event", async () => {
    const sink = new InMemorySink();
    setSink(sink);
    const { fetch } = stubFetch();
    const bridge = new HttpRCBridge({ fetchImpl: fetch });
    await bridge.callFunction({ objectPath: "/x", functionName: "F" });
    expect(sink.byPrefix("rc-bridge.")).toHaveLength(1);
    expect(sink.events[0]?.name).toBe("rc-bridge.http.callFunction");
  });
});

describe("HttpRCBridge — setProperty", () => {
  it("wraps propertyValue under the property name per the RC write format", async () => {
    const { fetch, calls } = stubFetch({ status: 200, body: "" });
    const bridge = new HttpRCBridge({ fetchImpl: fetch });
    await bridge.setProperty({
      objectPath: "/x",
      propertyName: "CurrentSunPitch",
      propertyValue: 80,
    });
    expect(calls[0]?.url).toContain("/remote/object/property");
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      objectPath: "/x",
      propertyName: "CurrentSunPitch",
      propertyValue: { CurrentSunPitch: 80 },
      access: "WRITE_TRANSACTION_ACCESS",
    });
  });
});
