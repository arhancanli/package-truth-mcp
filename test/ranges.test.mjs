// Range resolution checked against the rules each package manager documents.
import assert from "node:assert/strict";
import test from "node:test";
import { resolveRange } from "../src/ranges.mjs";

const V = ["0.1.0", "0.1.5", "0.2.0", "1.0.0", "1.2.0", "1.2.3", "1.2.9", "1.3.0", "1.9.9", "2.0.0-rc.1", "2.0.0", "2.1.0", "3.0.0"];
const r = (eco, range, versions = V) => resolveRange(eco, range, versions);

test("npm caret, tilde, x-ranges, comparators, hyphen and ||", () => {
  assert.equal(r("npm", "^1.2.0"), "1.9.9");
  assert.equal(r("npm", "^0.1.0"), "0.1.5");
  assert.equal(r("npm", "~1.2.0"), "1.2.9");
  assert.equal(r("npm", "1.x"), "1.9.9");
  assert.equal(r("npm", "1.2.*"), "1.2.9");
  assert.equal(r("npm", "*"), "3.0.0");
  assert.equal(r("npm", ">=1.2.0 <2.0.0"), "1.9.9");
  assert.equal(r("npm", "1.2.0 - 1.3.0"), "1.3.0");
  assert.equal(r("npm", "1.2.3"), "1.2.3");
  assert.equal(r("npm", "^1.0.0 || ^3.0.0"), "3.0.0");
  assert.equal(r("npm", "^4.0.0"), null);
  assert.equal(r("npm", "latest"), "3.0.0");
  assert.equal(r("npm", "not a range!"), undefined);
});

test("prereleases are never picked", () => {
  assert.equal(r("npm", ">=2.0.0-rc.1 <2.0.0"), null);
  assert.equal(r("pypi", ">=2.0", ["2.0.0", "2.1.0rc1"]), "2.0.0");
});

test("PyPI specifiers", () => {
  assert.equal(r("pypi", ">=1.2,<2"), "1.9.9");
  assert.equal(r("pypi", "~=1.2"), "1.9.9");
  assert.equal(r("pypi", "~=1.2.0"), "1.2.9");
  assert.equal(r("pypi", "==1.2.*"), "1.2.9");
  assert.equal(r("pypi", "!=3.0.0"), "2.1.0");
  assert.equal(r("pypi", "==1.2.3"), "1.2.3");
  assert.equal(r("pypi", ""), "3.0.0");
});

test("Cargo bare versions are caret ranges", () => {
  assert.equal(r("cargo", "1.2"), "1.9.9");
  assert.equal(r("cargo", "0.1"), "0.1.5");
  assert.equal(r("cargo", ">=1.0, <1.3"), "1.2.9");
});

test("RubyGems pessimistic operator", () => {
  assert.equal(r("rubygems", "~> 1.2"), "1.9.9");
  assert.equal(r("rubygems", "~> 1.2.0"), "1.2.9");
  assert.equal(r("rubygems", ">= 1.0, < 2.0"), "1.9.9");
});

test("ecosystems without range support say so", () => {
  assert.equal(r("maven", "[1.0,2.0)"), undefined);
  assert.equal(r("nuget", "[1.0,2.0)"), undefined);
});
