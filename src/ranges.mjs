// src/ranges.mjs
//
// Resolves a version range to the version a package manager would install today: the highest
// published, non-prerelease version that satisfies it. Covers the common forms of npm and Cargo
// (^ ~ comparators, x-ranges, hyphen ranges, ||), PyPI (== != >= <= > < ~= and 1.2.*) and RubyGems
// (~> and comparators). Returns undefined when a range is not understood, so the caller can say
// so instead of guessing.

const VERSION_RE = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?(?:[-.]?((?:a|b|rc|alpha|beta|pre|dev|c)[\w.]*|-[\w.]+))?(?:\+[\w.]+)?$/i;

/** @returns {{nums:number[], pre:string|null, parts:number}|null} */
export function parse(v) {
  const s = String(v).trim();
  const m = s.match(VERSION_RE) ?? s.match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?-([\w.]+)$/);
  if (!m) return null;
  const parts = [m[1], m[2], m[3], m[4]].filter((x) => x !== undefined).length;
  return { nums: [m[1], m[2], m[3], m[4]].map((x) => Number(x ?? 0)), pre: m[5] ? m[5].replace(/^-/, "") : null, parts };
}

export function compare(a, b) {
  for (let i = 0; i < 4; i++) if (a.nums[i] !== b.nums[i]) return a.nums[i] - b.nums[i];
  if (a.pre && !b.pre) return -1;
  if (!a.pre && b.pre) return 1;
  if (a.pre && b.pre) return a.pre.localeCompare(b.pre, undefined, { numeric: true });
  return 0;
}

const bump = (p, index) => {
  const nums = p.nums.map((n, i) => (i < index ? n : i === index ? n + 1 : 0));
  return { nums, pre: null, parts: 4 };
};

// A comparator is [op, parsedVersion]; a set is satisfied when all its comparators are.
function caret(p) {
  const upper = p.nums[0] > 0 || p.parts === 1 ? bump(p, 0) : p.nums[1] > 0 || p.parts === 2 ? bump(p, 1) : bump(p, 2);
  return [[">=", p], ["<", upper]];
}
function tilde(p) {
  return [[">=", p], ["<", p.parts === 1 ? bump(p, 0) : bump(p, 1)]];
}
// "~> 1.2" allows < 2.0; "~> 1.2.3" allows < 1.3.0 (RubyGems), and PyPI "~= 1.2" is the same rule.
function pessimistic(p) {
  const index = Math.max(0, p.parts - 2);
  return [[">=", p], ["<", bump(p, index)]];
}
function xRange(s) {
  const m = s.match(/^v?(\d+|[x*])(?:\.(\d+|[x*]))?(?:\.(\d+|[x*]))?$/i);
  if (!m) return null;
  const parts = [m[1], m[2], m[3]];
  const wild = parts.findIndex((x) => x === undefined || /^[x*]$/i.test(x));
  if (wild === -1) return null;
  if (wild === 0) return [];
  const num = (x) => (x === undefined || /^[x*]$/i.test(x) ? 0 : Number(x));
  const p = { nums: [num(m[1]), num(m[2]), 0, 0], pre: null, parts: wild };
  return [[">=", p], ["<", bump(p, wild - 1)]];
}

function npmSet(text) {
  const s = text.trim();
  if (s === "" || s === "*" || s === "latest") return [];
  const hyphen = s.match(/^(\S+)\s+-\s+(\S+)$/);
  if (hyphen) {
    const lo = parse(hyphen[1]);
    const hi = parse(hyphen[2]);
    return lo && hi ? [[">=", lo], [hi.parts < 3 ? "<" : "<=", hi.parts < 3 ? bump(hi, hi.parts - 1) : hi]] : null;
  }
  const out = [];
  for (const tok of s.replace(/([<>=~^]+)\s+/g, "$1").split(/[\s,]+/).filter(Boolean)) {
    const m = tok.match(/^(\^|~>|~|>=|<=|>|<|=|==)?(.*)$/);
    const op = m[1] ?? "";
    const x = xRange(m[2]);
    if (x && (op === "" || op === "=")) {
      out.push(...x);
      continue;
    }
    const p = parse(m[2]);
    if (!p) return null;
    if (op === "^") out.push(...caret(p));
    else if (op === "~") out.push(...tilde(p));
    else if (op === "~>") out.push(...pessimistic(p));
    else if (op === "" || op === "=" || op === "==") out.push(p.parts < 3 ? [">=", p] : ["=", p], ...(p.parts < 3 ? [["<", bump(p, p.parts - 1)]] : []));
    else out.push([op, p]);
  }
  return out;
}

function pypiSet(text) {
  const out = [];
  for (const raw of text.split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = raw.match(/^(===|==|!=|~=|>=|<=|>|<)\s*(.+)$/);
    if (!m) return null;
    const [, op, v] = m;
    if ((op === "==" || op === "!=") && v.endsWith(".*")) {
      const p = parse(v.slice(0, -2));
      if (!p) return null;
      const range = [[">=", p], ["<", bump(p, p.parts - 1)]];
      if (op === "==") out.push(...range);
      else out.push(["not", range]);
      continue;
    }
    const p = parse(v);
    if (!p) return null;
    if (op === "~=") out.push(...pessimistic(p));
    else if (op === "==" || op === "===") out.push(["=", p]);
    else if (op === "!=") out.push(["!=", p]);
    else out.push([op, p]);
  }
  return out;
}

function test(set, v) {
  return set.every((c) => {
    if (c[0] === "not") return !test(c[1], v);
    const d = compare(v, c[1]);
    switch (c[0]) {
      case ">=": return d >= 0;
      case ">": return d > 0;
      case "<=": return d <= 0;
      case "<": return d < 0;
      case "=": return d === 0;
      case "!=": return d !== 0;
      default: return false;
    }
  });
}

/** The comparator sets for a range (any set may match), or null when the range is not understood. */
export function parseRange(ecosystem, range) {
  const r = String(range ?? "").trim();
  if (ecosystem === "pypi") {
    const set = r === "" || r === "*" ? [] : pypiSet(r);
    return set ? [set] : null;
  }
  if (ecosystem === "npm" || ecosystem === "cargo" || ecosystem === "rubygems") {
    // Cargo: a bare "1.2.3" means ^1.2.3.
    const src = ecosystem === "cargo" ? r.split(",").map((s) => (/^\d/.test(s.trim()) ? `^${s.trim()}` : s.trim())).join(" ") : r;
    const sets = src.split("||").map(npmSet);
    return sets.every(Boolean) ? sets : null;
  }
  return null;
}

/**
 * @param {string} ecosystem
 * @param {string} range
 * @param {string[]} versions published versions
 * @returns {string|null|undefined} the version, null when nothing satisfies the range, undefined when the range is not understood
 */
export function resolveRange(ecosystem, range, versions) {
  const sets = parseRange(ecosystem, range);
  if (!sets) return undefined;
  let best;
  let bestParsed;
  for (const v of versions) {
    const p = parse(v);
    if (!p || p.pre) continue;
    if (sets.some((set) => test(set, p)) && (!bestParsed || compare(p, bestParsed) > 0)) {
      best = v;
      bestParsed = p;
    }
  }
  return best ?? null;
}
