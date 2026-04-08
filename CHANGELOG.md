# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - 2026-04-01

### Removed
- `src/dispatcher/` - Removed unified dispatcher (musa_dispatch tool)
- `docs/doc-sync/dispatcher.md` - Removed dispatcher documentation
- `references/document-driven-execution.md` - Removed (no longer needed without dispatcher)
- `musa_set_mode` and `musa_get_mode` tools - merged into single `musa_mode` tool
- Operation management from StateManager (startOperation, completeOperation, getOperation, resumeOperation, findConflictingOperation, acquireLock, releaseLock)
- `operations.json` state file - no longer needed

### Changed
- Execution Contract rules moved from dispatcher to `inject/AGENTS.autodeploy.md`
- Documentation updated to reflect three core capabilities (removed dispatcher layer)
- Plugin entry point simplified to register musa_* tools directly
- `musa_mode` now handles both get and set operations (call without params to get mode)
- `src/adapter/hooks.ts` simplified - removed duplicate try/catch blocks
- StateManager slimmed down to ~200 lines (from ~500)

### Added
- `install.js` - Added memorySearch extraPaths configuration for knowledge directory
- `knowledge/` - Directory for searchable knowledge documents

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