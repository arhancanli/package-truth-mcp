import { z } from "zod";
import { defineTool, ToolError } from "../kit/index.mjs";
import { checkPackage, summarize } from "../check.mjs";
import { mapLimit } from "../depsdev.mjs";
import { parseManifest, SUPPORTED_MANIFESTS } from "../manifest.mjs";
import { counts, READ_ONLY, resultRow } from "./schemas.mjs";

export const MAX_DEPENDENCIES = 300;

export const checkManifest = defineTool({
  name: "check_manifest",
  title: "Check a dependency manifest",
  description: `Checks every dependency in a manifest file's text (${SUPPORTED_MANIFESTS}). Pinned versions are checked exactly; ranges at the version an install would pick today. Problems are listed first.`,
  input: {
    filename: z.string().min(1).max(200).describe("File name, e.g. package.json"),
    content: z.string().min(1).max(500_000).describe("The file's full text"),
  },
  output: {
    ecosystem: z.string(),
    counts,
    results: z.array(resultRow),
    skipped: z.array(z.looseObject({ name: z.string() })).optional(),
    truncated: z.number().optional(),
  },
  annotations: READ_ONLY,
  handler: async ({ filename, content }, { fetcher, now }) => {
    let parsed;
    try {
      parsed = parseManifest(filename, content);
    } catch (err) {
      throw new ToolError("unreadable_manifest", `${err.message}.`);
    }
    if (!parsed) throw new ToolError("unsupported_manifest", `Unsupported file name ${filename}. Supported: ${SUPPORTED_MANIFESTS}. For anything else, use check_packages.`);
    const deps = parsed.deps.slice(0, MAX_DEPENDENCIES);
    const rows = await mapLimit(deps, 8, async (d) => {
      const row = await checkPackage(fetcher, parsed.ecosystem, d.name, { version: d.version, range: d.version === undefined ? d.spec : undefined }, now?.());
      const extra = {};
      if (d.version === undefined) extra.spec = d.spec;
      if (d.dev) extra.dev = true;
      if (d.alias) extra.alias = d.alias;
      if (d.indirect) extra.indirect = true;
      return { ...row, ...extra };
    });
    const out = { ecosystem: parsed.ecosystem, ...summarize(rows) };
    if (parsed.skipped.length) out.skipped = parsed.skipped;
    if (parsed.deps.length > deps.length) out.truncated = parsed.deps.length - deps.length;
    return out;
  },
});
