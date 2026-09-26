// The tool calls the golden tests replay. test/record.mjs runs them against the live deps.dev API
// and stores every response in test/fixtures/depsdev.json; the tests replay those bytes offline.
export const NOW = Date.parse("2026-09-26T00:00:00Z");

export const PACKAGE_JSON = JSON.stringify({
  dependencies: { express: "4.17.1", request: "^2.88.0", "left-pad-hallucinated-zz9": "1.0.0", local: "file:../local" },
  devDependencies: { typescript: "^5.0.0" },
});

export const REQUIREMENTS = "requests==2.31.0\nflask>=3.0  # web\n-r other.txt\nnot-a-real-pkg-qq7==0.1\n";

export const SCENARIOS = [
  { label: "check_packages: 5 npm packages (missing, deprecated, vulnerable, clean)", tool: "check_packages", args: { ecosystem: "npm", packages: [{ name: "express" }, { name: "request" }, { name: "express", version: "4.17.1" }, { name: "express", version: "99.0.0" }, { name: "left-pad-hallucinated-zz9" }] } },
  { label: "check_packages: 1 PyPI package", tool: "check_packages", args: { ecosystem: "pypi", packages: [{ name: "Requests", version: "2.31.0" }] } },
  { label: "check_packages: 1 Go module", tool: "check_packages", args: { ecosystem: "go", packages: [{ name: "github.com/gin-gonic/gin", version: "v1.9.1" }] } },
  { label: "check_manifest: package.json, 5 entries", tool: "check_manifest", args: { filename: "package.json", content: PACKAGE_JSON } },
  { label: "check_manifest: requirements.txt, 4 lines", tool: "check_manifest", args: { filename: "requirements.txt", content: REQUIREMENTS } },
  { label: "get_advisories: express 4.17.1", tool: "get_advisories", args: { ecosystem: "npm", name: "express", version: "4.17.1" } },
];
