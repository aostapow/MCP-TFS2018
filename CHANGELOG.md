# Changelog

All notable changes to MCP-TFS2018 are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.1] - 2026-07-04

### Added
- `AGENTS.md` — checklist de instalacion y migracion para agentes de IA

### Changed
- `README.md` — guia de instalacion ampliada (`npm ci`, `npm run setup`, ejemplo MCP config, troubleshooting auto-update)

## [1.3.0] - 2026-07-04

### Added
- Auto-update via GitHub release zip before MCP startup (`MCP_TFS_AUTO_UPDATE=true` by default)
- `scripts/launcher.mjs` as recommended MCP entry point (update + start)
- `scripts/zip-update.mjs` for zip download, extract, merge, and `npm ci`
- `src/utils/release-assets.ts` for resolving release zip assets from GitHub API
- `tfs_get_server_info` now reports auto-update status, last applied version, and zip asset URL
- `allowScripts` policy for `esbuild` and `kerberos` (npm 12 readiness)

### Changed
- `npm run update` downloads and applies the latest release zip instead of using git pull
- `npm start` runs through `scripts/launcher.mjs`
- Setup wizard generates MCP snippets pointing to `scripts/launcher.mjs`
- Security dependency updates (`form-data`, `hono`, `esbuild`, `@babel/*`, `js-yaml`) — 0 npm audit vulnerabilities

## [1.2.0] - 2026-07-03

### Added
- `tfs_add_work_item_link` supports `Microsoft.VSTS.Common.TestedBy-Forward` and `Microsoft.VSTS.Common.TestedBy-Reverse` for Bug ↔ Test Case traceability

## [1.1.0] - 2026-06-06

### Added
- Version check on startup with one-time notification when a newer release is available
- MCP tool `tfs_get_server_info` for version and update status
- `npm run update` script to pull latest code and rebuild
- GitHub Actions workflow to publish releases with zip assets on tag push

## [1.0.0] - 2026-06-06

### Added
- Initial MCP server for TFS 2018 with 305+ tools (work items, tests, builds, releases, TFVC, Git, admin, policy, integrations, security, dashboards, REST)
- PAT, NTLM, Basic, and Kerberos authentication
- Interactive setup wizard (`npm run setup`)
- `projectIdOrName` override on all project-scoped tools

[Unreleased]: https://github.com/aostapow/MCP-TFS2018/compare/v1.3.1...HEAD
[1.3.1]: https://github.com/aostapow/MCP-TFS2018/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/aostapow/MCP-TFS2018/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/aostapow/MCP-TFS2018/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/aostapow/MCP-TFS2018/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/aostapow/MCP-TFS2018/releases/tag/v1.0.0
