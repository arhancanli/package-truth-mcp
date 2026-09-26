#!/usr/bin/env node
// node test/record.mjs: re-records test/fixtures/depsdev.json from the live API.
import { writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer, createContext } from "../src/server.mjs";
import { NOW, SCENARIOS } from "./scenarios.mjs";

const recorded = {};
const recordingFetch = async (url, init) => {
  const res = await fetch(url, init);
  const body = await res.text();
  let parsed = body.startsWith("{") ? JSON.parse(body) : body;
  // Keep only the version fields the server reads, so the fixture stays small.
  if (parsed?.packageKey && Array.isArray(parsed.versions)) {
    parsed = { packageKey: parsed.packageKey, versions: parsed.versions.map(({ versionKey, publishedAt, isDefault }) => ({ versionKey, publishedAt, isDefault })) };
  }
  recorded[new URL(url).pathname] = { status: res.status, body: parsed };
  return new Response(body, { status: res.status, headers: res.headers });
};
const server = buildServer(createContext({ fetchImpl: recordingFetch, now: () => NOW }));
const [a, b] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "record", version: "0" });
await Promise.all([server.connect(a), client.connect(b)]);
for (const s of SCENARIOS) {
  const res = await client.callTool({ name: s.tool, arguments: s.args });
  if (res.isError) console.error(s.tool, res.content[0].text);
}
const sorted = Object.fromEntries(Object.entries(recorded).sort(([x], [y]) => x.localeCompare(y)));
writeFileSync(new URL("./fixtures/depsdev.json", import.meta.url), `${JSON.stringify(sorted)}\n`);
console.log(`recorded ${Object.keys(sorted).length} responses`);
