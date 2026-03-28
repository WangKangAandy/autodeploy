# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2025-03-28

### Added
- `agent-tools/` - Unified tool layer for Claude Code and other agent frameworks
- `agent-tools/src/core/` - Core executors (execRemote, execDocker, syncFiles)
- Platform runtime layer with unified dispatcher and state management
- `src/dispatcher/` - Unified dispatch system (intent parser, router, orchestrator)
- `src/document/` - Document-driven execution engine (loader, parser, executor)
- `src/shared/` - Trace framework and structured logging
- `src/adapter/` - OpenClaw hooks and dynamic context builder
- Granular atomic skills: `ensure_system_dependencies`, `ensure_musa_driver`, `ensure_mt_container_toolkit`, `manage_container_images`, `validate_musa_container_environment`
- Asset preparation skills: `prepare_musa_package`, `prepare_model_artifacts`, `prepare_dataset_artifacts`, `prepare_dependency_repo`
- `skills/index.yml` - Machine-readable skill definitions with inputs, outputs, trigger patterns
- `references/document-driven-execution.md` - Document execution reference
- `docs/doc-sync/` - Documentation synchronization system (DOC-MAP, UPDATE-RULES, GATE-RUNBOOK)
- `docs/platform-evolution-roadmap.md` - Platform evolution roadmap

### Changed
- Renamed `claude-remote-mt-gpu-tools/` to `agent-tools/`
- Updated `agent-tools/package.json` with proper exports for multi-entry usage
- Updated `agent-tools/tsconfig.json` to use `module: NodeNext`
- Refactored MCP tools to use core executors layer
- `deploy_musa_base_env` changed from monolithic skill to meta skill orchestrating atomic skills
- `update_musa_driver` now uses `ensure_musa_driver` internally
- Updated `references/remote-execution-policy.md` to reflect current architecture
- Updated `agent-tools/MIGRATION.md` with correct file paths

### Removed
- `.opencode/tools/` - Migrated to `agent-tools/src/core/`
- `feishu-claude-bridge/` - Removed from repository (not part of core platform scope)
- `docs/参考：本地部署环境.md` - Removed (outdated reference)

### Fixed
- Updated all documentation to reflect new architecture
- Fixed stale references to `.opencode/tools/` in documentation
- Fixed stale references to `.opencode/remote-ssh.env` (now `agent-tools/config/remote-ssh.env`)