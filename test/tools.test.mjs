// Golden tests: every tool over a real MCP client, replaying deps.dev responses recorded by
// test/record.mjs (test/fixtures/depsdev.json). No test here touches the network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer, createContext } from "../src/server.mjs";
import { NOW, PACKAGE_JSON, REQUIREMENTS } from "./scenarios.mjs";

const FIXTURES = JSON.parse(readFileSync(new URL("./fixtures/depsdev.json", import.meta.url), "utf8"));

export function replayFetch(fixtures = FIXTURES) {
  const calls = [];
  const impl = async (url) => {
    const path = new URL(url).pathname;
    calls.push(path);
    const hit = fixtures[path];
    if (!hit) throw new Error(`no fixture for ${path}`);
    return new Response(typeof hit.body === "string" ? hit.body : JSON.stringify(hit.body), { status: hit.status });
  };
  return { impl, calls };
}

export async function connect(fetchImpl = replayFetch().impl) {
  const server = buildServer(createContext({ fetchImpl, now: () => NOW }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "golden", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  // Like a real client: once the tools are listed, every result is validated against its schema.
  await client.listTools();
  return client;
}

const call = async (client, name, args) => {
  const res = await client.callTool({ name, arguments: args });
  return { res, data: res.structuredContent ?? JSON.parse(res.content[0].text) };
};
const byKey = (rows) => Object.fromEntries(rows.map((r) => [`${r.name}@${r.version ?? r.spec ?? ""}`, r]));

test("check_packages: verdicts for missing, missing version, deprecated, vulnerable and clean", async () => {
  const client = await connect();
  const { res, data } = await call(client, "check_packages", {
    ecosystem: "npm",
    packages: [{ name: "express" }, { name: "request" }, { name: "express", version: "4.17.1" }, { name: "express", version: "99.0.0" }, { name: "left-pad-hallucinated-zz9" }],
  });
  assert.ok(!res.isError);
  assert.deepEqual(data.counts, { does_not_exist: 2, risky: 2, verify: 0, ok: 1 });
  assert.deepEqual(data.results.map((r) => r.verdict), ["does_not_exist", "does_not_exist", "risky", "risky", "ok"], "worst first");
  const r = byKey(data.results);
  assert.deepEqual(r["left-pad-hallucinated-zz9@"].flags, ["not_found"]);
  assert.deepEqual(r["express@99.0.0"].flags, ["version_not_found"]);
  assert.equal(r["express@99.0.0"].latest, "5.2.1");
  assert.deepEqual(r["request@2.88.2"].flags, ["deprecated", "vulnerable", "no_release_in_3_years"]);
  assert.match(r["request@2.88.2"].deprecated_reason, /request has been deprecated/);
  assert.deepEqual(r["express@4.17.1"].advisories, ["GHSA-qw6h-vgh9-j6wx", "GHSA-rv95-896h-c2vc"]);
  assert.equal(r["express@4.17.1"].latest_advisory_count, 0, "upgrading to the latest clears them");
  assert.equal(r["express@5.2.1"].verdict, "ok");
  assert.equal(r["express@5.2.1"].license, "MIT");
  assert.equal(r["express@5.2.1"].flags, undefined, "a clean result carries no flags");
});

test("check_packages: PyPI names are normalised and Go module paths are encoded", async () => {
  const { impl, calls } = replayFetch();
  const client = await connect(impl);
  const py = await call(client, "check_packages", { ecosystem: "pypi", packages: [{ name: "Requests", version: "2.31.0" }] });
  assert.equal(py.data.results[0].name, "Requests");
  assert.equal(py.data.results[0].verdict, "risky");
  assert.equal(py.data.results[0].latest, "2.34.2");
  const go = await call(client, "check_packages", { ecosystem: "go", packages: [{ name: "github.com/gin-gonic/gin", version: "v1.9.1" }] });
  assert.equal(go.data.results[0].verdict, "ok");
  assert.equal(go.data.results[0].latest, "v1.12.0");
  assert.ok(calls.includes("/v3/systems/pypi/packages/requests"));
  assert.ok(calls.includes("/v3/systems/go/packages/github.com%2Fgin-gonic%2Fgin"));
});

test("check_manifest: package.json ranges resolve like npm, local paths are listed as skipped", async () => {
  const client = await connect();
  const { data } = await call(client, "check_manifest", { filename: "package.json", content: PACKAGE_JSON });
  assert.equal(data.ecosystem, "npm");
  assert.deepEqual(data.counts, { does_not_exist: 1, risky: 2, verify: 0, ok: 1 });
  const r = byKey(data.results);
  assert.equal(r["typescript@5.9.3"].spec, "^5.0.0", "^5.0.0 resolves to the last 5.x, not the latest 7.x");
  assert.equal(r["typescript@5.9.3"].dev, true);
  assert.equal(r["request@2.88.2"].spec, "^2.88.0");
  assert.equal(r["left-pad-hallucinated-zz9@1.0.0"].verdict, "does_not_exist");
  assert.deepEqual(data.skipped, [{ name: "local", spec: "file:../local", reason: "not from the registry" }]);
});

test("check_manifest: requirements.txt", async () => {
  const client = await connect();
  const { data } = await call(client, "check_manifest", { filename: "requirements.txt", content: REQUIREMENTS });
  assert.equal(data.ecosystem, "pypi");
  assert.deepEqual(data.results.map((r) => [r.name, r.verdict]), [["not-a-real-pkg-qq7", "does_not_exist"], ["requests", "risky"], ["flask", "ok"]]);
  assert.equal(data.skipped.length, 1);
});

test("check_manifest: unsupported and unreadable files are clear errors", async () => {
  const client = await connect();
  const a = await call(client, "check_manifest", { filename: "build.gradle", content: "x" });
  assert.equal(a.res.isError, true);
  assert.equal(a.data.error.code, "unsupported_manifest");
  const b = await call(client, "check_manifest", { filename: "package.json", content: "{not json" });
  assert.equal(b.data.error.code, "unreadable_manifest");
});

test("get_advisories: titles, CVE aliases, scores and links", async () => {
  const client = await connect();
  const { data } = await call(client, "get_advisories", { ecosystem: "npm", name: "express", version: "4.17.1" });
  assert.equal(data.latest, "5.2.1");
  assert.equal(data.latest_advisory_count, 0);
  assert.deepEqual(data.advisories.map((a) => [a.id, a.aliases[0], a.cvss3]), [["GHSA-qw6h-vgh9-j6wx", "CVE-2024-43796", 5], ["GHSA-rv95-896h-c2vc", "CVE-2024-29041", 6.1]]);
  assert.match(data.advisories[0].url, /^https:\/\/osv\.dev\/vulnerability\//);
});

test("get_advisories: unknown package and version are not_found errors", async () => {
  const client = await connect();
  const a = await call(client, "get_advisories", { ecosystem: "npm", name: "left-pad-hallucinated-zz9" });
  assert.equal(a.data.error.code, "not_found");
});
