import { WorldAPICallSchema } from "@yellow-ue/world-api";
import { z } from "zod";

import {
  LLMCompletionRequestSchema,
  LLMCompletionResultSchema,
} from "./contract.js";

/**
 * R4 — one source of truth per contract.
 *
 * The Zod schemas in this package (and `@yellow-ue/world-api`) are the single
 * source. We emit them to JSON Schema so the Python brain can validate against
 * the *same* contract instead of hand-maintaining a parallel Pydantic
 * definition. The emitted files are generated artifacts; regenerate with
 * `pnpm --filter @yellow-ue/llm-brain codegen` (the gen test also rewrites them
 * on every `pnpm test`, so they never drift).
 */
export const schemaManifest = [
  { name: "llm-completion-request", schema: LLMCompletionRequestSchema },
  { name: "llm-completion-result", schema: LLMCompletionResultSchema },
  { name: "world-api-call", schema: WorldAPICallSchema },
] as const;

export function buildSchemas(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const { name, schema } of schemaManifest) {
    out[name] = z.toJSONSchema(schema, { target: "draft-7" });
  }
  return out;
}
