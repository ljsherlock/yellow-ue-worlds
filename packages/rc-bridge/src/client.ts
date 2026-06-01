import type { RCFunctionCall, RCPropertySet, RCResponse } from "./contract.js";

/**
 * R2: the RCBridge boundary — the low-level transport to Unreal's Remote
 * Control web server. Consumers depend on this interface; the mock and the
 * real HTTP/WS client both implement it.
 *
 * Phase 1: `MockRCBridge` (simulated latency + responses).
 * Phase 2 Track C: real client speaking HTTP+WebSocket to a packaged UE
 *   instance, plus the `WorldAPIClient` implementation that maps tool calls
 *   to these RC calls (see `mapping.ts`).
 */
export interface RCBridge {
  callFunction(req: RCFunctionCall): Promise<RCResponse>;
  setProperty(req: RCPropertySet): Promise<RCResponse>;
}
