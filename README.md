# Package Truth

<!-- badges:start -->
[![CI](https://github.com/arhancanli/package-truth-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/arhancanli/package-truth-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/package-truth-mcp)](https://www.npmjs.com/package/package-truth-mcp)
[![downloads](https://img.shields.io/npm/dw/package-truth-mcp)](https://www.npmjs.com/package/package-truth-mcp)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/arhancanli/package-truth-mcp/badge)](https://scorecard.dev/viewer/?uri=github.com/arhancanli/package-truth-mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
<!-- badges:end -->

Stops coding agents from installing packages that do not exist, are deprecated, or have known
vulnerabilities, across npm, PyPI, Go, Maven, Cargo, NuGet and RubyGems.

Language models invent package names. In a USENIX Security 2025 study of 16 code models, 19.7% of
the packages they recommended did not exist, and attackers now register those invented names
("slopsquatting"). Package Truth checks every dependency before it is installed and gives each
one a verdict an agent can act on:

| Verdict | Meaning |
| --- | --- |
| `does_not_exist` | No such package, no such version, or no version matching the range: do not install |
| `risky` | The version that would be installed is deprecated or has known advisories |
| `verify` | Published under 90 days ago or has at most two versions: a possible squat, check before use |
| `ok` | No problem found in deps.dev at query time (not a security guarantee) |

Give it a whole manifest (`package.json`, `requirements.txt`, `pyproject.toml`, `Cargo.toml`,
`go.mod`, `Gemfile`, `*.csproj`, `pom.xml`) and it resolves each range to the version an install
would pick today, checks it, and lists problems first. No account, no key.

Built and maintained by [Arhan Canli](https://github.com/arhancanli). Data from
[deps.dev](https://deps.dev) (Open Source Insights).

## Install

<!-- install:start -->
[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=package-truth&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsInBhY2thZ2UtdHJ1dGgtbWNwIl19)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=package-truth&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22package-truth-mcp%22%5D%7D)
[![Install in Goose](https://block.github.io/goose/img/extension-install-dark.svg)](https://block.github.io/goose/extension?cmd=npx&arg=-y&arg=package-truth-mcp&id=package-truth&name=Package%20Truth&description=Checks%20that%20packages%20exist%20before%20an%20agent%20installs%20them%3A%20latest%20version%2C%20deprecation%2C%20known%20vulnerabilities%20and%20licence%20across%20npm%2C%20PyPI%2C%20Go%2C%20Maven%2C%20Cargo%2C%20NuGet%20and%20RubyGems.)

Needs Node.js 20 or newer. No account or key.

**Claude Code**

```sh
claude mcp add package-truth -- npx -y package-truth-mcp
```

**Claude Desktop**: download `package-truth-mcp-<version>.mcpb` from the [latest release](https://github.com/arhancanli/package-truth-mcp/releases/latest) and open it. The bundle is signed; verify it with `gh attestation verify <file> --repo arhancanli/package-truth-mcp`.

**Any other client** (Windsurf, Zed, Cline, Continue and others), in its MCP config file:

```json
{
  "mcpServers": {
    "package-truth": {
      "command": "npx",
      "args": [
        "-y",
        "package-truth-mcp"
      ]
    }
  }
}
```

**Docker**

```sh
docker build -t package-truth-mcp https://github.com/arhancanli/package-truth-mcp.git && docker run -i --rm package-truth-mcp
```

**Hosted (Streamable HTTP)**: `node src/server.mjs --http` serves stateless MCP at `POST /mcp` (port from `PORT`, default 3000).
<!-- install:end -->

## Tools

<!-- tools:start -->
| Tool | What it does |
| --- | --- |
| `check_manifest` | Checks every dependency in a manifest file's text (package.json, requirements*.txt, pyproject.toml, Cargo.toml, go.mod, Gemfile, *.csproj, pom.xml). Pinned versions are checked exactly; ranges at the version an install would pick today. Problems are listed first. |
| `check_packages` | Checks up to 100 packages in one registry: exists, latest version, deprecated, known advisories, licence, age. Verdict each: does_not_exist, risky, verify (new or tiny: possible squat) or ok. Omit version for the latest. |
| `get_advisories` | Lists the known security advisories for one package version (latest if omitted): id, title, CVE aliases, CVSS 3 score and link, plus how many affect the latest version. |
<!-- tools:end -->

## How it behaves

- Read-only: no tool changes anything outside this process. Manifests are parsed as text; nothing
  in them is executed or fetched.
- Ranges are resolved like the package manager would (npm and Cargo caret, tilde, x and hyphen
  ranges; PyPI specifiers including `~=` and `==1.2.*`; RubyGems `~>`). Prereleases are never
  picked. Maven and NuGet ranges are checked at the latest version and flagged as such.
- Network: HTTPS only, to the hosts listed in `package.json` under `factory.allowHosts`, with a
  deadline, a size cap and bounded retries. Nothing else is contacted, and nothing is logged
  except unexpected failures (to stderr, without your inputs).
- Results are compact JSON with a matching output schema. Lists say how many items were left out.

## Benchmark

<!-- bench:start -->
Not yet measured.
<!-- bench:end -->

## More MCP servers by Arhan Canli

<!-- family:start -->
- [The whole collection](https://github.com/arhancanli/mcp-factory#servers)
<!-- family:end -->

## License

MIT, Copyright (c) 2026 Arhan Canli.
