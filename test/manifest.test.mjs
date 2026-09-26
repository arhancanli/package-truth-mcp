// Every supported manifest format, including the entries that must be skipped.
import assert from "node:assert/strict";
import test from "node:test";
import { parseManifest } from "../src/manifest.mjs";

const names = (r) => r.deps.map((d) => `${d.name}${d.version ? `@${d.version}` : ` ${d.spec}`}`);

test("package.json: pinned, ranges, dev, npm: aliases, and non-registry entries", () => {
  const r = parseManifest("app/package.json", JSON.stringify({
    dependencies: { a: "1.2.3", b: "^2.0.0", c: "=3.0.0", d: "npm:real-d@4.0.0", e: "git+https://x/y.git", f: "user/repo", g: "workspace:*" },
    devDependencies: { h: "~1.0.0" },
  }));
  assert.equal(r.ecosystem, "npm");
  assert.deepEqual(names(r), ["a@1.2.3", "b ^2.0.0", "c@3.0.0", "real-d@4.0.0", "h ~1.0.0"]);
  assert.equal(r.deps.find((d) => d.name === "real-d").alias, "d");
  assert.equal(r.deps.find((d) => d.name === "h").dev, true);
  assert.deepEqual(r.skipped.map((s) => s.name), ["e", "f", "g"]);
});

test("requirements.txt: pins, specifiers, extras, markers, comments and options", () => {
  const r = parseManifest("requirements-dev.txt", "Django==4.2.1\nrequests[socks]>=2.31 ; python_version>'3.8'\n# c\n-e .\nnumpy\nhttps://x/y.whl\n");
  assert.deepEqual(names(r), ["Django@4.2.1", "requests >=2.31", "numpy *"]);
  assert.equal(r.skipped.length, 2);
});

test("pyproject.toml: PEP 621 and Poetry, multi-line arrays", () => {
  const r = parseManifest("pyproject.toml", `
[project]
name = "x"
dependencies = [
  "httpx>=0.27",
  "pydantic==2.7.1",
]
[project.optional-dependencies]
test = ["pytest>=8"]
[tool.poetry.dependencies]
python = "^3.11"
rich = "^13.0"
local = { path = "../local" }
`);
  assert.deepEqual(names(r), ["httpx >=0.27", "pydantic@2.7.1", "pytest >=8", "rich ^13.0"]);
  assert.deepEqual(r.skipped.map((s) => s.name), ["local"]);
});

test("Cargo.toml: bare versions are ranges, = is exact, renamed and path deps", () => {
  const r = parseManifest("Cargo.toml", `
[dependencies]
serde = "1.0"
tokio = { version = "=1.38.0", features = ["full"] }
mylib = { path = "../mylib" }
rq = { package = "reqwest", version = "0.12" }
[dev-dependencies]
proptest = "1"
`);
  assert.equal(r.ecosystem, "cargo");
  assert.deepEqual(names(r), ["serde 1.0", "tokio@1.38.0", "reqwest 0.12", "proptest 1"]);
  assert.deepEqual(r.skipped.map((s) => s.name), ["mylib"]);
});

test("go.mod: block and single-line requires, indirect marked", () => {
  const r = parseManifest("go.mod", "module x\n\ngo 1.22\n\nrequire github.com/a/b v1.2.3\n\nrequire (\n\tgolang.org/x/net v0.25.0 // indirect\n\tgithub.com/c/d v2.0.0+incompatible\n)\n");
  assert.deepEqual(names(r), ["github.com/a/b@v1.2.3", "golang.org/x/net@v0.25.0", "github.com/c/d@v2.0.0+incompatible"]);
  assert.equal(r.deps[1].indirect, true);
});

test("Gemfile, csproj and pom.xml", () => {
  const gem = parseManifest("Gemfile", "source 'https://rubygems.org'\ngem 'rails', '7.1.3'\ngem 'puma', '~> 6.0'\ngem 'mine', path: '../mine'\n");
  assert.deepEqual(names(gem), ["rails@7.1.3", "puma ~> 6.0"]);
  assert.equal(gem.skipped.length, 1);
  const cs = parseManifest("App.csproj", '<Project><ItemGroup><PackageReference Include="Newtonsoft.Json" Version="13.0.3" /><PackageReference Include="Serilog" Version="[3.0,4.0)" /></ItemGroup></Project>');
  assert.deepEqual(names(cs), ["Newtonsoft.Json@13.0.3", "Serilog [3.0,4.0)"]);
  const pom = parseManifest("pom.xml", "<project><dependencies><dependency><groupId>org.slf4j</groupId><artifactId>slf4j-api</artifactId><version>2.0.13</version></dependency><dependency><groupId>junit</groupId><artifactId>junit</artifactId><version>${junit.version}</version><scope>test</scope></dependency></dependencies></project>");
  assert.deepEqual(names(pom), ["org.slf4j:slf4j-api@2.0.13"]);
  assert.equal(pom.skipped[0].reason, "version set by a property or parent");
});

test("unknown file names return null; broken JSON throws", () => {
  assert.equal(parseManifest("build.gradle", ""), null);
  assert.throws(() => parseManifest("package.json", "{"), /not valid JSON/);
});
