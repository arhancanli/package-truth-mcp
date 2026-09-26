import { z } from "zod";
import { defineTool, ToolError } from "../kit/index.mjs";
import { getAdvisory, getPackage, getVersion, mapLimit, normalizeName } from "../depsdev.mjs";
import { ecosystem, READ_ONLY } from "./schemas.mjs";

export const getAdvisories = defineTool({
  name: "get_advisories",
  title: "Advisories for a package version",
  description: "Lists the known security advisories for one package version (latest if omitted): id, title, CVE aliases, CVSS 3 score and link, plus how many affect the latest version.",
  input: { ecosystem, name: z.string().min(1).max(214), version: z.string().min(1).max(100).optional() },
  output: {
    name: z.string(),
    version: z.string(),
    latest: z.string(),
    latest_advisory_count: z.number(),
    advisories: z.array(z.looseObject({ id: z.string() })),
  },
  annotations: READ_ONLY,
  handler: async ({ ecosystem: eco, name, version }, { fetcher }) => {
    const norm = normalizeName(eco, name);
    const pkg = await getPackage(fetcher, eco, norm);
    if (!pkg?.versions?.length) throw new ToolError("not_found", `The ${eco} registry has no package named ${name}.`);
    const latest = (pkg.versions.find((v) => v.isDefault) ?? pkg.versions.at(-1)).versionKey.version;
    const target = version ?? latest;
    const detail = await getVersion(fetcher, eco, norm, target);
    if (!detail) throw new ToolError("version_not_found", `${name} has no version ${target}. The latest is ${latest}.`);
    const ids = (detail.advisoryKeys ?? []).map((a) => a.id).sort();
    const advisories = await mapLimit(ids, 8, async (id) => {
      const a = await getAdvisory(fetcher, id);
      const row = { id };
      if (a?.title) row.title = a.title;
      if (a?.aliases?.length) row.aliases = a.aliases;
      if (typeof a?.cvss3Score === "number" && a.cvss3Score > 0) row.cvss3 = a.cvss3Score;
      if (a?.url) row.url = a.url;
      return row;
    });
    const latestDetail = target === latest ? detail : await getVersion(fetcher, eco, norm, latest);
    return { name, version: target, latest, latest_advisory_count: (latestDetail?.advisoryKeys ?? []).length, advisories };
  },
});
