#!/usr/bin/env node
// package-truth: checks that packages exist, and are safe to install, before an agent installs them.
//
// Tools live in src/tools/, one file each. The kit in src/kit/ is a copy of the factory kit
// (a drift test keeps it identical); it holds the network guard, the result wrapper and the
// stdio and HTTP entry points.
import { readFileSync } from "node:fs";
import { createFetcher, createServer, isMain, start, TtlCache } from "./kit/index.mjs";
import { checkManifest } from "./tools/check-manifest.mjs";
import { checkPackages } from "./tools/check-packages.mjs";
import { getAdvisories } from "./tools/get-advisories.mjs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

export const SERVER_NAME = pkg.name;
export const SERVER_VERSION = pkg.version;
export const TOOLS = [checkManifest, checkPackages, getAdvisories];

export const INSTRUCTIONS = "Use check_packages or check_manifest before recommending, adding or installing any dependency. A package the registry does not know may be a hallucinated name, and a very new one may be a squatted one. A clean result means no problem was found in deps.dev at query time; it is not a security guarantee.";

export function createContext({ fetchImpl, now } = {}) {
  return {
    now,
    fetcher: createFetcher({
      allowHosts: pkg.factory.allowHosts,
      userAgent: `${SERVER_NAME}/${SERVER_VERSION} (+${pkg.homepage})`,
      cache: new TtlCache({ ttlMs: 10 * 60_000 }),
      fetchImpl,
    }),
  };
}

export function buildServer(ctx = createContext()) {
  return createServer({ name: SERVER_NAME, version: SERVER_VERSION, instructions: INSTRUCTIONS, tools: TOOLS, ctx });
}

if (isMain(import.meta.url)) start(() => buildServer(), SERVER_NAME);
