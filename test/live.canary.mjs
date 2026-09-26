// Weekly canary (.github/workflows/canary.yml): the same tools against the live deps.dev API.
// Asserts only facts that should not change: a name that never existed, a long-deprecated package,
// a version with published advisories.
import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.mjs";

const client = new Client({ name: "canary", version: "0" });
const [a, b] = InMemoryTransport.createLinkedPair();
await Promise.all([buildServer().connect(a), client.connect(b)]);

test("live: known facts still come back from deps.dev", { timeout: 60_000 }, async () => {
  const res = await client.callTool({ name: "check_packages", arguments: { ecosystem: "npm", packages: [{ name: "request" }, { name: "express", version: "4.17.1" }, { name: "zz-never-published-canary-9q" }] } });
  assert.ok(!res.isError, res.content[0].text);
  const byName = Object.fromEntries(res.structuredContent.results.map((r) => [r.name, r]));
  assert.ok(byName.request.flags.includes("deprecated"));
  assert.ok(byName.express.advisories.includes("GHSA-rv95-896h-c2vc"));
  assert.equal(byName["zz-never-published-canary-9q"].verdict, "does_not_exist");
  const adv = await client.callTool({ name: "get_advisories", arguments: { ecosystem: "npm", name: "express", version: "4.17.1" } });
  assert.ok(adv.structuredContent.advisories.some((x) => x.aliases?.includes("CVE-2024-29041")));
  await client.close();
});
