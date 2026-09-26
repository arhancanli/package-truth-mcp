// Verdict rules on synthetic registry data, so each flag is exercised on purpose.
import assert from "node:assert/strict";
import test from "node:test";
import { createFetcher } from "../src/kit/index.mjs";
import { checkPackage } from "../src/check.mjs";

const NOW = Date.parse("2026-09-26T00:00:00Z");
const daysAgo = (d) => new Date(NOW - d * 86_400_000).toISOString();

function registry(pkgs) {
  const impl = async (url) => {
    const path = decodeURIComponent(new URL(url).pathname);
    const m = path.match(/^\/v3\/systems\/(\w+)\/packages\/(.+?)(?:\/versions\/(.+))?$/);
    const pkg = m && pkgs[m[2]];
    if (!pkg) return new Response('{"error":"not found"}', { status: 404 });
    if (!m[3]) {
      return Response.json({ packageKey: { name: m[2] }, versions: pkg.versions.map((v) => ({ versionKey: { version: v.v }, publishedAt: v.at, isDefault: Boolean(v.default) })) });
    }
    const v = pkg.versions.find((x) => x.v === m[3]);
    return v ? Response.json({ versionKey: { version: v.v }, isDeprecated: Boolean(v.deprecated), deprecatedReason: v.deprecated ?? "", licenses: ["MIT"], advisoryKeys: (v.adv ?? []).map((id) => ({ id })) }) : new Response("{}", { status: 404 });
  };
  return createFetcher({ allowHosts: ["api.deps.dev"], userAgent: "t", fetchImpl: impl });
}

test("a package first published last month is a possible squat: verify", async () => {
  const f = registry({ fresh: { versions: [{ v: "1.0.0", at: daysAgo(40) }, { v: "1.0.1", at: daysAgo(30) }, { v: "1.0.2", at: daysAgo(20), default: true }] } });
  const r = await checkPackage(f, "npm", "fresh", {}, NOW);
  assert.equal(r.verdict, "verify");
  assert.deepEqual(r.flags, ["new_package"]);
});

test("an old package with only two versions is also verify", async () => {
  const f = registry({ tiny: { versions: [{ v: "0.0.1", at: daysAgo(900) }, { v: "0.0.2", at: daysAgo(800), default: true }] } });
  const r = await checkPackage(f, "npm", "tiny", {}, NOW);
  assert.equal(r.verdict, "verify");
  assert.deepEqual(r.flags, ["few_versions"]);
});

test("deprecation outranks newness: risky", async () => {
  const f = registry({ dep: { versions: [{ v: "1.0.0", at: daysAgo(10), default: true, deprecated: "use x" }] } });
  const r = await checkPackage(f, "npm", "dep", {}, NOW);
  assert.equal(r.verdict, "risky");
  assert.equal(r.deprecated_reason, "use x");
  assert.deepEqual(r.flags, ["deprecated", "new_package", "few_versions"]);
});

test("a range with no matching version means the install would fail", async () => {
  const f = registry({ p: { versions: [{ v: "1.0.0", at: daysAgo(900) }, { v: "1.1.0", at: daysAgo(800) }, { v: "1.2.0", at: daysAgo(700), default: true }] } });
  const none = await checkPackage(f, "npm", "p", { range: "^2.0.0" }, NOW);
  assert.equal(none.verdict, "does_not_exist");
  assert.deepEqual(none.flags, ["no_version_matches_range"]);
  const ok = await checkPackage(f, "npm", "p", { range: "~1.1.0" }, NOW);
  assert.equal(ok.version, "1.1.0");
  const odd = await checkPackage(f, "maven", "p", { range: "[1.0,2.0)" }, NOW);
  assert.equal(odd.version, "1.2.0");
  assert.ok(odd.flags.includes("range_not_understood_checked_latest"));
});

test("with no isDefault marker, the newest publish date is the latest", async () => {
  const f = registry({ q: { versions: [{ v: "2.0.0", at: daysAgo(500) }, { v: "1.9.0", at: daysAgo(100) }, { v: "1.0.0", at: daysAgo(900) }] } });
  assert.equal((await checkPackage(f, "npm", "q", {}, NOW)).latest, "1.9.0");
});
