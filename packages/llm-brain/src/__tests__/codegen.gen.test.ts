import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildSchemas } from "../codegen.js";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * This is codegen-as-test: running the suite (re)writes the JSON Schema
 * artifacts the Python brain consumes, so the cross-language contract can
 * never silently drift from the Zod source (R4).
 */
const OUT_DIRS = [
  // canonical artifact location
  resolve(here, "../../schemas"),
  // vendored copy the Python brain loads at runtime
  resolve(here, "../../../brain/src/brain/_schemas"),
];

describe("contract codegen (R4)", () => {
  it("emits JSON Schema for every contract and writes the artifacts", () => {
    const schemas = buildSchemas();
    expect(Object.keys(schemas).sort()).toEqual([
      "llm-completion-request",
      "llm-completion-result",
      "world-api-call",
    ]);

    for (const dir of OUT_DIRS) {
      mkdirSync(dir, { recursive: true });
      for (const [name, schema] of Object.entries(schemas)) {
        writeFileSync(
          resolve(dir, `${name}.schema.json`),
          `${JSON.stringify(schema, null, 2)}\n`,
          "utf8",
        );
      }
    }

    const result = schemas["llm-completion-result"] as {
      properties?: Record<string, unknown>;
    };
    expect(result.properties).toHaveProperty("toolCalls");
    expect(result.properties).toHaveProperty("finishReason");
  });
});
