// src/manifest.mjs
//
// Reads the dependency list out of a manifest's text. Deliberately small, line-oriented parsers:
// they never execute anything and never fetch anything. A pinned version is checked exactly; a
// range is checked at the latest version and reported with its range. Entries that do not come
// from a registry (paths, git URLs, workspace links) are listed as skipped, never silently dropped.

const EXACT_SEMVER = /^v?\d+(\.\d+){1,3}([-+][\w.+-]+)?$/;

const dep = (name, spec, extra = {}) => {
  const s = (spec ?? "").trim();
  const exact = s.replace(/^==?\s*/, "");
  const isExact = s !== "" && EXACT_SEMVER.test(exact) && !/^[~^><*]/.test(s);
  return { name, spec: s || "*", ...(isExact ? { version: exact } : {}), ...extra };
};

function parsePackageJson(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("package.json is not valid JSON");
  }
  const deps = [];
  const skipped = [];
  for (const [field, dev] of [["dependencies", false], ["optionalDependencies", false], ["devDependencies", true]]) {
    for (const [name, spec] of Object.entries(json[field] ?? {})) {
      const s = String(spec);
      if (/^(file:|link:|workspace:|git|github:|https?:|\.|\/)/.test(s) || s.includes("/") && !s.startsWith("npm:")) {
        skipped.push({ name, spec: s, reason: "not from the registry" });
      } else if (s.startsWith("npm:")) {
        const m = s.slice(4).match(/^(@?[^@]+)(?:@(.*))?$/);
        deps.push(dep(m[1], m[2], { alias: name, ...(dev ? { dev } : {}) }));
      } else deps.push(dep(name, s, dev ? { dev } : {}));
    }
  }
  return { ecosystem: "npm", deps, skipped };
}

// One PEP 508 requirement string: name[extras] specifier ; marker
function pep508(line) {
  const noMarker = line.split(";")[0].trim();
  const m = noMarker.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*(.*)$/);
  if (!m) return null;
  const spec = m[3].replace(/\s+/g, "");
  if (spec.startsWith("@")) return { skip: { name: m[1], spec, reason: "not from the registry" } };
  const exact = spec.match(/^===?([^,]+)$/);
  return exact ? dep(m[1], exact[1]) : { name: m[1], spec: spec || "*" };
}

function parseRequirements(text) {
  const deps = [];
  const skipped = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, "").trim();
    if (!line) continue;
    if (line.startsWith("-") || /^(https?|git\+|file):/.test(line) || line.startsWith(".") || line.startsWith("/")) {
      skipped.push({ name: line.slice(0, 80), spec: "", reason: "option, path or URL" });
      continue;
    }
    const d = pep508(line);
    if (d?.skip) skipped.push(d.skip);
    else if (d) deps.push(d);
  }
  return { ecosystem: "pypi", deps, skipped };
}

// Minimal TOML reading for dependency tables: [section] headers, key = "string" or key = { version = "..." },
// and multi-line string arrays. Enough for pyproject.toml and Cargo.toml dependency sections.
function tomlSections(text) {
  const sections = new Map();
  let current = "";
  let pendingArray = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (pendingArray) {
      for (const m of line.matchAll(/"([^"]*)"|'([^']*)'/g)) pendingArray.push(m[1] ?? m[2]);
      if (line.includes("]")) pendingArray = null;
      continue;
    }
    if (!line || line.startsWith("#")) continue;
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      current = header[1].trim();
      if (!sections.has(current)) sections.set(current, new Map());
      continue;
    }
    const kv = line.match(/^("?[\w.@/-]+"?)\s*=\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].replace(/"/g, "");
    const value = kv[2].trim();
    if (!sections.has(current)) sections.set(current, new Map());
    if (value.startsWith("[")) {
      const arr = [...value.matchAll(/"([^"]*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2]);
      sections.get(current).set(key, arr);
      if (!value.includes("]")) pendingArray = arr;
    } else if (value.startsWith("{")) {
      const version = value.match(/version\s*=\s*"([^"]*)"/)?.[1];
      const nonRegistry = /\b(path|git|url)\s*=/.test(value);
      sections.get(current).set(key, { version, nonRegistry, package: value.match(/package\s*=\s*"([^"]*)"/)?.[1] });
    } else {
      sections.get(current).set(key, value.replace(/^["']|["']$/g, ""));
    }
  }
  return sections;
}

function parsePyproject(text) {
  const s = tomlSections(text);
  const deps = [];
  const skipped = [];
  const addPep = (line, extra) => {
    const d = pep508(line);
    if (d?.skip) skipped.push(d.skip);
    else if (d) deps.push({ ...d, ...extra });
  };
  for (const line of s.get("project")?.get("dependencies") ?? []) addPep(line, {});
  for (const [, list] of s.get("project.optional-dependencies") ?? []) for (const line of list) addPep(line, { dev: true });
  for (const [section, dev] of [["tool.poetry.dependencies", false], ["tool.poetry.dev-dependencies", true], ["tool.poetry.group.dev.dependencies", true]]) {
    for (const [name, value] of s.get(section) ?? []) {
      if (name.toLowerCase() === "python") continue;
      if (typeof value === "object" && value.nonRegistry) skipped.push({ name, spec: "", reason: "not from the registry" });
      else {
        const spec = typeof value === "object" ? value.version : value;
        deps.push(dep(name, spec, dev ? { dev } : {}));
      }
    }
  }
  return { ecosystem: "pypi", deps, skipped };
}

function parseCargo(text) {
  const s = tomlSections(text);
  const deps = [];
  const skipped = [];
  for (const [section, dev] of [["dependencies", false], ["dev-dependencies", true], ["build-dependencies", true]]) {
    for (const [key, value] of s.get(section) ?? []) {
      const name = typeof value === "object" && value.package ? value.package : key;
      if (typeof value === "object" && (value.nonRegistry || !value.version)) {
        skipped.push({ name, spec: "", reason: value.nonRegistry ? "not from the registry" : "no version" });
        continue;
      }
      const spec = typeof value === "object" ? value.version : value;
      // In Cargo a bare "1.2.3" means ^1.2.3; only "=1.2.3" is exact.
      const d = spec.startsWith("=") ? dep(name, spec.slice(1)) : { name, spec };
      deps.push(dev ? { ...d, dev } : d);
    }
  }
  return { ecosystem: "cargo", deps, skipped };
}

function parseGoMod(text) {
  const deps = [];
  let inBlock = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^require\s*\($/.test(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock && line === ")") {
      inBlock = false;
      continue;
    }
    const m = (inBlock ? line : line.replace(/^require\s+/, "")).match(/^([^\s/]+\.[^\s]+)\s+(v[^\s]+)(\s*\/\/\s*indirect)?/);
    if ((inBlock || line.startsWith("require ")) && m) deps.push({ name: m[1], spec: m[2], version: m[2], ...(m[3] ? { indirect: true } : {}) });
  }
  return { ecosystem: "go", deps, skipped: [] };
}

function parseGemfile(text) {
  const deps = [];
  const skipped = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.trim().match(/^gem\s+["']([^"']+)["'](.*)$/);
    if (!m) continue;
    if (/\b(path|git|github):/.test(m[2])) {
      skipped.push({ name: m[1], spec: "", reason: "not from the registry" });
      continue;
    }
    const specs = [...m[2].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
    deps.push(specs.length === 1 && EXACT_SEMVER.test(specs[0]) ? dep(m[1], specs[0]) : { name: m[1], spec: specs.join(", ") || "*" });
  }
  return { ecosystem: "rubygems", deps, skipped };
}

function parseCsproj(text) {
  const deps = [];
  for (const m of text.matchAll(/<PackageReference\s+([^>]*?)\/?>/gi)) {
    const name = m[1].match(/Include="([^"]+)"/i)?.[1];
    const version = m[1].match(/Version="([^"]+)"/i)?.[1];
    if (name) deps.push(version && EXACT_SEMVER.test(version) ? dep(name, version) : { name, spec: version ?? "*" });
  }
  return { ecosystem: "nuget", deps, skipped: [] };
}

function parsePom(text) {
  const deps = [];
  const skipped = [];
  const body = text.replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/g, "").replace(/<plugins>[\s\S]*?<\/plugins>/g, "");
  for (const m of body.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const tag = (t) => m[1].match(new RegExp(`<${t}>\\s*([^<]+?)\\s*</${t}>`))?.[1];
    const g = tag("groupId");
    const a = tag("artifactId");
    const v = tag("version");
    if (!g || !a) continue;
    const name = `${g}:${a}`;
    if (!v || v.includes("${")) skipped.push({ name, spec: v ?? "", reason: "version set by a property or parent" });
    else deps.push(/^[[(]/.test(v) ? { name, spec: v } : dep(name, v, tag("scope") === "test" ? { dev: true } : {}));
  }
  return { ecosystem: "maven", deps, skipped };
}

const PARSERS = [
  [/^package\.json$/i, parsePackageJson],
  [/^requirements.*\.txt$/i, parseRequirements],
  [/^pyproject\.toml$/i, parsePyproject],
  [/^cargo\.toml$/i, parseCargo],
  [/^go\.mod$/i, parseGoMod],
  [/^gemfile$/i, parseGemfile],
  [/\.csproj$/i, parseCsproj],
  [/^pom\.xml$/i, parsePom],
];

export const SUPPORTED_MANIFESTS = "package.json, requirements*.txt, pyproject.toml, Cargo.toml, go.mod, Gemfile, *.csproj, pom.xml";

/** @returns {{ecosystem: string, deps: object[], skipped: object[]} | null} null when the file name is not supported */
export function parseManifest(filename, text) {
  const base = filename.split(/[\\/]/).pop();
  const hit = PARSERS.find(([re]) => re.test(base));
  return hit ? hit[1](text) : null;
}
