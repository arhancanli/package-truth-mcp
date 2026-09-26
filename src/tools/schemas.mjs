// Shared schema pieces for the tools.
import { z } from "zod";
import { ECOSYSTEMS } from "../depsdev.mjs";

export const ecosystem = z.enum(Object.keys(ECOSYSTEMS)).describe("Registry");

// Lean on purpose: tool lists are resent every turn. The fields an agent branches on are typed;
// the rest (advisories, licence, dates, spec, dev) are documented in the README.
export const resultRow = z.looseObject({
  name: z.string(),
  version: z.string().optional(),
  latest: z.string().optional(),
  verdict: z.enum(["does_not_exist", "risky", "verify", "ok"]),
  flags: z.array(z.string()).optional(),
});

export const counts = z.record(z.string(), z.number());

export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
