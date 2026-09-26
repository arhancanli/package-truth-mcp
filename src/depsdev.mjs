// src/depsdev.mjs
//
// The deps.dev v3 API (documented at docs.deps.dev, API v3), which answers for seven registries
// without a key. Everything the server knows about a package comes through these three calls.

export const API = "https://api.deps.dev/v3";

// Our ecosystem names, as users and manifests say them, to deps.dev's system names.
export const ECOSYSTEMS = { npm: "npm", pypi: "pypi", go: "go", maven: "maven", cargo: "cargo", nuget: "nuget", rubygems: "rubygems" };

/** Registry-specific name normalisation, so "Requests" and "requests" are the same PyPI package. */
export function normalizeName(ecosystem, name) {
  const n = name.trim();
  switch (ecosystem) {
    case "pypi":
      return n.toLowerCase().replace(/[-_.]+/g, "-"); // PEP 503
    case "npm":
    case "cargo":
      return n.toLowerCase();
    default:
      return n;
  }
}

const enc = (s) => encodeURIComponent(s);

/** @returns {Promise<object|null>} the package's version list, or null when the registry has no such package */
export async function getPackage(fetcher, ecosystem, name) {
  const { status, data } = await fetcher.getJson(`${API}/systems/${ECOSYSTEMS[ecosystem]}/packages/${enc(name)}`, { allowStatus: [404] });
  return status === 404 ? null : data;
}

/** @returns {Promise<object|null>} one version's details, or null when that version does not exist */
export async function getVersion(fetcher, ecosystem, name, version) {
  const { status, data } = await fetcher.getJson(`${API}/systems/${ECOSYSTEMS[ecosystem]}/packages/${enc(name)}/versions/${enc(version)}`, { allowStatus: [404] });
  return status === 404 ? null : data;
}

export async function getAdvisory(fetcher, id) {
  const { status, data } = await fetcher.getJson(`${API}/advisories/${enc(id)}`, { allowStatus: [404] });
  return status === 404 ? null : data;
}

/** Runs fn over items with at most `limit` in flight, keeping input order. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
