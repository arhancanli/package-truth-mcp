// src/check.mjs
//
// The verdict for one package. Order of severity:
//   does_not_exist  the registry has no such package, or no such version of it
//   risky           the checked version is deprecated or has known advisories
//   verify          the package is under 90 days old or has at most two versions: new names are
//                   where squatters wait for agents that hallucinate a dependency
//   ok              none of the above was found in deps.dev at query time
import { compact } from "./kit/index.mjs";
import { getPackage, getVersion, normalizeName } from "./depsdev.mjs";
import { resolveRange } from "./ranges.mjs";

const DAY = 86_400_000;
export const NEW_PACKAGE_DAYS = 90;
export const STALE_YEARS = 3;

const day = (iso) => (iso ? iso.slice(0, 10) : undefined);

function pickDefault(versions) {
  const flagged = versions.find((v) => v.isDefault);
  if (flagged) return flagged;
  const dated = versions.filter((v) => v.publishedAt).sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  return dated.at(-1) ?? versions.at(-1);
}

/**
 * @param {object} fetcher   kit fetcher allowed to call api.deps.dev
 * @param {string} ecosystem one of ECOSYSTEMS
 * @param {string} rawName   as written by the user or the manifest
 * @param {{version?: string, range?: string}} [want] an exact version, or a range to resolve the way
 *   the package manager would; the latest when neither is given
 * @param {number} [now]     epoch ms, injectable for tests
 */
export async function checkPackage(fetcher, ecosystem, rawName, { version, range } = {}, now = Date.now()) {
  const name = normalizeName(ecosystem, rawName);
  // With an exact version, the package list and that version's details are fetched in parallel.
  const earlyDetail = version !== undefined ? getVersion(fetcher, ecosystem, name, version) : undefined;
  earlyDetail?.catch(() => {});
  const pkg = await getPackage(fetcher, ecosystem, name);
  if (!pkg || !Array.isArray(pkg.versions) || pkg.versions.length === 0) {
    return compact({ name: rawName, version, verdict: "does_not_exist", flags: ["not_found"], note: "The registry has no package with this name. It may be misspelled or hallucinated; do not install it." });
  }
  const versions = pkg.versions;
  const latest = pickDefault(versions);
  const latestVersion = latest.versionKey.version;
  if (version !== undefined && !versions.some((v) => v.versionKey.version === version)) {
    return compact({ name: rawName, version, latest: latestVersion, verdict: "does_not_exist", flags: ["version_not_found"], note: `Version ${version} was never published. The latest is ${latestVersion}.` });
  }
  const flags = [];
  let target = version ?? latestVersion;
  if (version === undefined && range !== undefined && range !== "*") {
    const resolved = resolveRange(ecosystem, range, versions.map((v) => v.versionKey.version));
    if (resolved === null) {
      return compact({ name: rawName, spec: range, latest: latestVersion, verdict: "does_not_exist", flags: ["no_version_matches_range"], note: `No published version satisfies ${range}; installing will fail. The latest is ${latestVersion}.` });
    }
    if (resolved === undefined) flags.push("range_not_understood_checked_latest");
    else target = resolved;
  }
  // The latest version's details are fetched alongside the target's, since a vulnerable target is
  // reported with how many advisories remain at the latest version.
  const latestDetailP = target !== latestVersion ? getVersion(fetcher, ecosystem, name, latestVersion) : undefined;
  latestDetailP?.catch(() => {});
  const detail = await (target === version && earlyDetail ? earlyDetail : getVersion(fetcher, ecosystem, name, target));
  const advisories = (detail?.advisoryKeys ?? []).map((a) => a.id).sort();
  const published = versions.map((v) => v.publishedAt).filter(Boolean).sort();
  const firstPublished = published[0];
  const latestPublished = latest.publishedAt ?? published.at(-1);

  if (detail?.isDeprecated) flags.push("deprecated");
  if (advisories.length) flags.push("vulnerable");
  if (firstPublished && now - Date.parse(firstPublished) < NEW_PACKAGE_DAYS * DAY) flags.push("new_package");
  if (versions.length <= 2) flags.push("few_versions");
  if (latestPublished && now - Date.parse(latestPublished) > STALE_YEARS * 365 * DAY) flags.push("no_release_in_3_years");

  let verdict = "ok";
  if (flags.includes("deprecated") || flags.includes("vulnerable")) verdict = "risky";
  else if (flags.includes("new_package") || flags.includes("few_versions")) verdict = "verify";

  let latestAdvisories;
  if (advisories.length && latestDetailP) latestAdvisories = ((await latestDetailP)?.advisoryKeys ?? []).length;

  return compact({
    name: rawName,
    version: target,
    latest: latestVersion,
    verdict,
    flags,
    deprecated_reason: detail?.isDeprecated ? detail.deprecatedReason || "Deprecated by its maintainer." : undefined,
    advisories,
    latest_advisory_count: latestAdvisories,
    license: detail?.licenses?.length ? detail.licenses.join(" OR ") : undefined,
    first_published: day(firstPublished),
    latest_published: day(latestPublished),
    version_count: versions.length,
  });
}

export const VERDICT_ORDER = ["does_not_exist", "risky", "verify", "ok"];

/** Worst-first ordering and counts, so the problems are at the top of a long list. */
export function summarize(rows) {
  const counts = Object.fromEntries(VERDICT_ORDER.map((v) => [v, 0]));
  for (const r of rows) counts[r.verdict]++;
  const sorted = [...rows].sort((a, b) => VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict));
  return { counts, results: sorted };
}
