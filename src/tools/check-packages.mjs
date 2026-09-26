import { z } from "zod";
import { defineTool } from "../kit/index.mjs";
import { checkPackage, summarize } from "../check.mjs";
import { mapLimit } from "../depsdev.mjs";
import { counts, ecosystem, READ_ONLY, resultRow } from "./schemas.mjs";

export const MAX_PACKAGES = 100;

export const checkPackages = defineTool({
  name: "check_packages",
  title: "Check packages before installing",
  description:
    "Checks up to 100 packages in one registry: exists, latest version, deprecated, known advisories, licence, age. Verdict each: does_not_exist, risky, verify (new or tiny: possible squat) or ok. Omit version for the latest.",
  input: {
    ecosystem,
    packages: z
      .array(z.object({ name: z.string().min(1).max(214), version: z.string().min(1).max(100).optional() }))
      .min(1)
      .max(MAX_PACKAGES),
  },
  output: { ecosystem: z.string(), counts, results: z.array(resultRow) },
  annotations: READ_ONLY,
  handler: async ({ ecosystem: eco, packages }, { fetcher, now }) => {
    const rows = await mapLimit(packages, 8, (p) => checkPackage(fetcher, eco, p.name, { version: p.version }, now?.()));
    return { ecosystem: eco, ...summarize(rows) };
  },
});
