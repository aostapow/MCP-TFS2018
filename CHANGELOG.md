# Changelog

All notable changes to MCP-TFS2018 are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/aostapow/MCP-TFS2018/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/aostapow/MCP-TFS2018/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/aostapow/MCP-TFS2018/releases/tag/v1.0.0
