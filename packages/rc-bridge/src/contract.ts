import { z } from "zod";

export const RC_WIRE_VERSION = "RCWirev1" as const;

/**
 * ⚠️ WIRE FORMAT IS PROVISIONAL — modeled after Unreal Engine's Remote Control
 * HTTP API (`/remote/object/call`, `/remote/object/property`). It MUST be
 * verified against the UE 5.7 Remote Control docs when the real transport is
 * built in Phase 2 Track C. The shapes here are good enough to design the
 * inspector and the WorldAPICall→RC mapping against, not to ship blindly.
 */

export const RCFunctionCallSchema = z.object({
  objectPath: z.string().min(1),
  functionName: z.string().min(1),
  parameters: z.record(z.string(), z.unknown()).default({}),
  generateTransaction: z.boolean().default(true),
});
export type RCFunctionCall = z.input<typeof RCFunctionCallSchema>;

export const RCAccessSchema = z.enum([
  "READ_ACCESS",
  "WRITE_ACCESS",
  "WRITE_TRANSACTION_ACCESS",
]);
export type RCAccess = z.infer<typeof RCAccessSchema>;

export const RCPropertySetSchema = z.object({
  objectPath: z.string().min(1),
  propertyName: z.string().min(1),
  propertyValue: z.unknown(),
  access: RCAccessSchema.default("WRITE_TRANSACTION_ACCESS"),
});
export type RCPropertySet = z.input<typeof RCPropertySetSchema>;

/** The literal HTTP request that goes (or would go) on the wire. */
export interface RCWire {
  method: "PUT" | "GET" | "POST";
  url: string;
  body: unknown;
}

export interface RCResponse {
  ok: boolean;
  httpStatus: number;
  latencyMs: number;
  requestId: string;
  wire: RCWire;
  returnValue?: unknown;
  error?: string;
}
