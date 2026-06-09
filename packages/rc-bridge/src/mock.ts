import { boundary } from "@yellow-ue/tracing";

import type { RCBridge } from "./client.js";
import {
  RCFunctionCallSchema,
  RCPropertySetSchema,
  type RCFunctionCall,
  type RCPropertySet,
  type RCResponse,
  type RCWire,
} from "./contract.js";

export type RCRequest =
  | { kind: "function"; req: RCFunctionCall }
  | { kind: "property"; req: RCPropertySet };

export interface MockRCBridgeOptions {
  baseUrl?: string;
  /** Fixed latency, or a function returning ms. Default: jitter 80–160ms. */
  latencyMs?: number | (() => number);
  /** Return an error string to simulate a failed call; null/undefined = success. */
  failOn?: (request: RCRequest) => string | null | undefined;
  requestId?: () => string;
  /** Whether to actually sleep for the simulated latency. Default true (off in tests). */
  sleep?: boolean;
}

const DEFAULT_BASE = "http://ue-instance.local:30010";

let counter = 0;
const defaultRequestId = () => {
  counter += 1;
  return `rc-${counter.toString(36)}`;
};

const jitter = () => 80 + Math.random() * 80;

const wait = (ms: number) =>
  ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve();

/**
 * MockRCBridge — simulates the Unreal Remote Control transport without a
 * running engine. Produces the exact wire request that would be sent, a
 * plausible response, and a realistic latency, so page 04 can show the
 * round-trip and the WorldAPICall→RC mapping in isolation.
 */
export class MockRCBridge implements RCBridge {
  private readonly baseUrl: string;
  private readonly latencyMs: number | (() => number);
  private readonly failOn: (request: RCRequest) => string | null | undefined;
  private readonly requestId: () => string;
  private readonly doSleep: boolean;

  constructor(options: MockRCBridgeOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE;
    this.latencyMs = options.latencyMs ?? jitter;
    this.failOn = options.failOn ?? (() => null);
    this.requestId = options.requestId ?? defaultRequestId;
    this.doSleep = options.sleep ?? true;
  }

  private resolveLatency(): number {
    return typeof this.latencyMs === "function" ? this.latencyMs() : this.latencyMs;
  }

  callFunction = boundary(
    "rc-bridge.callFunction",
    async (req: RCFunctionCall): Promise<RCResponse> => {
      const parsed = RCFunctionCallSchema.parse(req);
      const wire: RCWire = {
        method: "PUT",
        url: `${this.baseUrl}/remote/object/call`,
        body: {
          objectPath: parsed.objectPath,
          functionName: parsed.functionName,
          parameters: parsed.parameters,
          generateTransaction: parsed.generateTransaction,
        },
      };
      return this.send(wire, { kind: "function", req }, {
        ReturnValue: true,
        functionName: parsed.functionName,
      });
    },
  );

  setProperty = boundary(
    "rc-bridge.setProperty",
    async (req: RCPropertySet): Promise<RCResponse> => {
      const parsed = RCPropertySetSchema.parse(req);
      const wire: RCWire = {
        method: "PUT",
        url: `${this.baseUrl}/remote/object/property`,
        body: {
          objectPath: parsed.objectPath,
          propertyName: parsed.propertyName,
          propertyValue: parsed.propertyValue,
          access: parsed.access,
        },
      };
      return this.send(wire, { kind: "property", req }, {
        [parsed.propertyName]: parsed.propertyValue,
      });
    },
  );

  private async send(
    wire: RCWire,
    request: RCRequest,
    successReturn: unknown,
  ): Promise<RCResponse> {
    const latencyMs = this.resolveLatency();
    if (this.doSleep) await wait(latencyMs);
    const requestId = this.requestId();
    const failure = this.failOn(request);
    if (failure) {
      return {
        ok: false,
        httpStatus: 502,
        latencyMs,
        requestId,
        wire,
        error: failure,
      };
    }
    return {
      ok: true,
      httpStatus: 200,
      latencyMs,
      requestId,
      wire,
      returnValue: successReturn,
    };
  }
}
