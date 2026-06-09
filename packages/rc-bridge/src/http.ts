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

/**
 * The REAL Remote Control transport. Speaks plain HTTP to a running Unreal
 * instance's Remote Control web server (`-RCWebControlEnable`, default port
 * 30010). Wire format follows the UE 5.7 "Remote Control API HTTP Reference"
 * (`PUT /remote/object/call`, `PUT /remote/object/property`).
 *
 * Security: the RC server is unauthenticated, so we never expose 30010
 * publicly. In the spike the bridge talks to `http://127.0.0.1:30010` through
 * an SSH tunnel (`npm run ue:rc-tunnel`), keeping the control plane private.
 */
export interface HttpRCBridgeOptions {
  /** RC web server base URL. Default: $RC_BASE_URL or http://127.0.0.1:30010. */
  baseUrl?: string;
  /** Injectable fetch (for tests). Default: global fetch. */
  fetchImpl?: typeof fetch;
  /** Abort a request after this many ms. Default 10000. */
  timeoutMs?: number;
  requestId?: () => string;
}

const DEFAULT_BASE = "http://127.0.0.1:30010";

export class HttpRCBridge implements RCBridge {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly requestId: () => string;

  constructor(options: HttpRCBridgeOptions = {}) {
    this.baseUrl = (
      options.baseUrl ??
      process.env.RC_BASE_URL ??
      DEFAULT_BASE
    ).replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.requestId =
      options.requestId ?? (() => globalThis.crypto.randomUUID());
    if (typeof this.fetchImpl !== "function") {
      throw new Error(
        "HttpRCBridge: no fetch available (Node >=18 or pass fetchImpl)",
      );
    }
  }

  callFunction = boundary(
    "rc-bridge.http.callFunction",
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
      return this.send(wire);
    },
  );

  setProperty = boundary(
    "rc-bridge.http.setProperty",
    async (req: RCPropertySet): Promise<RCResponse> => {
      const parsed = RCPropertySetSchema.parse(req);
      const wire: RCWire = {
        method: "PUT",
        url: `${this.baseUrl}/remote/object/property`,
        body: {
          objectPath: parsed.objectPath,
          propertyName: parsed.propertyName,
          // RC expects { propertyValue: { <propertyName>: <value> } } on writes.
          propertyValue: { [parsed.propertyName]: parsed.propertyValue },
          access: parsed.access,
        },
      };
      return this.send(wire);
    },
  );

  private async send(wire: RCWire): Promise<RCResponse> {
    const requestId = this.requestId();
    const start = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(wire.url, {
        method: wire.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(wire.body),
        signal: controller.signal,
      });
      const latencyMs = Math.round(performance.now() - start);
      const text = await res.text();
      let payload: unknown;
      try {
        payload = text ? JSON.parse(text) : undefined;
      } catch {
        payload = text;
      }
      if (!res.ok) {
        return {
          ok: false,
          httpStatus: res.status,
          latencyMs,
          requestId,
          wire,
          error:
            typeof payload === "string" ? payload : JSON.stringify(payload),
        };
      }
      return {
        ok: true,
        httpStatus: res.status,
        latencyMs,
        requestId,
        wire,
        returnValue: payload,
      };
    } catch (e) {
      const latencyMs = Math.round(performance.now() - start);
      const isAbort = e instanceof Error && e.name === "AbortError";
      return {
        ok: false,
        httpStatus: 0,
        latencyMs,
        requestId,
        wire,
        error: isAbort
          ? `request timed out after ${this.timeoutMs}ms`
          : e instanceof Error
            ? e.message
            : String(e),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
