# `@yellow-ue/rc-bridge`

**The `RCBridge` boundary — the transport to Unreal's Remote Control web server.**

This package owns two things:

1. The **wire format** for talking to UE Remote Control (`RCFunctionCall`,
   `RCPropertySet`, `RCResponse`).
2. The **mapping** from a high-level `WorldAPICall` to the low-level RC
   function call that actually drives the engine (`toRCFunctionCall`).

## ⚠️ Wire format is provisional

The endpoints and body shapes (`/remote/object/call`, etc.) are **modeled
after** Unreal's Remote Control HTTP API but have **not been verified against
UE 5.7** yet. That verification happens in Phase 2 Track C when the real
transport is built against a running engine. Everything here is correct
*enough* to design the inspector and the mapping against.

## Phase status

| Phase | What ships |
|---|---|
| **1 (now)** | `RCBridge` interface, `MockRCBridge`, `toRCFunctionCall` mapping |
| **2 Track C** | Real HTTP+WebSocket client; `WorldAPIClient` implementation that uses the mapping + this transport |

## `MockRCBridge`

Simulates the round-trip without a running engine:

- Produces the **exact wire request** that would be sent
- Returns a plausible response with a **realistic latency** (jittered 80–160ms)
- Can **simulate failures** via `failOn` (page 04 uses this to show error handling)

Methods are boundary-wrapped (`rc-bridge.callFunction`, `rc-bridge.setProperty`)
so round-trips appear in the Pipeline Trace Viewer (R3).

```ts
const bridge = new MockRCBridge();
const rc = toRCFunctionCall({ tool: "SetSkyState", args: { preset: "storm" } });
const res = await bridge.callFunction(rc);
// res.wire = { method: "PUT", url: ".../remote/object/call", body: {…} }
// res.latencyMs ≈ 80–160, res.ok = true
```
