# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- `agent-tools/` - Unified tool layer for Claude Code and other agent frameworks
- `agent-tools/src/core/` - Core executors (execRemote, execDocker, syncFiles)
- Platform runtime layer with unified dispatcher and state management

### Changed
- Renamed `claude-remote-mt-gpu-tools/` to `agent-tools/`
- Updated `agent-tools/package.json` with proper exports for multi-entry usage
- Updated `agent-tools/tsconfig.json` to use `module: NodeNext`
- Refactored MCP tools to use core executors layer

### Removed
- `.opencode/tools/` - Migrated to `agent-tools/src/core/`
- `feishu-claude-bridge/` - Removed from repository (not part of core platform scope)

### Fixed
- Updated all documentation to reflect new architecture
- Fixed stale references to `.opencode/tools/` in README.md, CLAUDE.md, AGENTS.md

## [1.0.0] - 2024-03-13

### Added
- Initial release
- MUSA SDK deployment skills (`deploy_musa_base_env`, `update_musa_driver`)
- OpenCode remote execution tools (`remote-exec`, `remote-docker`, `remote-sync`)
- SDK compatibility mapping configuration
- Container validation runbook
- Remote execution policy documentation
- Feishu bot bridge with Claude API integration