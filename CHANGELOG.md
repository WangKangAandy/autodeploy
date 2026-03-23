# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- `agent-tools/` - Unified tool layer for Claude Code, OpenCode, and Feishu bot
- `agent-tools/src/core/` - Core executors (execRemote, execDocker, syncFiles)
- `feishu-claude-bridge/src/tool-client.ts` - ToolClient for agent-tools integration
- `feishu-claude-bridge/src/system-prompt.ts` - Context-aware system prompt generator
- `feishu-claude-bridge/src/skill-loader.ts` - Dynamic skill loading from repository

### Changed
- Renamed `claude-remote-mt-gpu-tools/` to `agent-tools/`
- Updated `agent-tools/package.json` with proper exports for multi-entry usage
- Updated `agent-tools/tsconfig.json` to use `module: NodeNext`
- Refactored MCP tools to use core executors layer
- Enhanced Feishu bot system prompt with skills integration and tool guidance

### Removed
- `.opencode/tools/` - Migrated to `agent-tools/src/core/`
- Redundant documentation files in `feishu-claude-bridge/`

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