"use strict";

const path = require("path");
const { registerMusaTools } = require("./src/tools");
const { ensureAgentsMerged, checkStaticRules } = require("./src/utils/agents-merge");

// Note: TypeScript modules (adapter, dispatcher, state-manager) need to be compiled
// before use. Run: npm run build
// For now, we provide optional loading with fallback.

/**
 * OpenClaw MUSA Deployment Plugin
 *
 * Platform runtime layer for MUSA SDK environment deployment and GPU management.
 *
 * Architecture:
 * - Static Platform Constitution: AGENTS.autodeploy.md (auto-merged to workspace)
 * - Dynamic Context: before_prompt_build hook injection
 * - Execution Layer: musa_dispatch + existing tools
 * - State Layer: workspace/autodeploy/*.json
 */
const plugin = {
  id: "openclaw-musa",
  name: "MUSA Deployment Platform",
  description:
    "Platform runtime layer for MUSA SDK deployment and GPU management. Provides unified dispatcher, state management, and cognitive injection.",
  configSchema: {
    type: "object",
    properties: {
      workspacePath: {
        type: "string",
        description: "Path for state persistence (default: workspace/autodeploy/)",
      },
    },
  },

  register(api) {
    const log = (msg) => api.logger.info?.(`[musa] ${msg}`);
    const warn = (msg) => api.logger.warn?.(`[musa] ${msg}`);

    // OpenClaw workspace is separate from plugin directory
    // Use OPENCLAW_WORKSPACE env or default to ~/.openclaw/workspace
    const openclawWorkspace = process.env.OPENCLAW_WORKSPACE
      || path.join(require("os").homedir(), ".openclaw", "workspace");
    const pluginDir = __dirname;

    log(`OpenClaw workspace: ${openclawWorkspace}`);

    // =========================================================================
    // 1. Auto-merge AGENTS.autodeploy.md (self-bootstrapping)
    // =========================================================================
    const AUTO_MERGE_ENABLED = process.env.MUSA_AUTO_MERGE_AGENTS !== "false";

    if (AUTO_MERGE_ENABLED) {
      // ensureAgentsMerged() never throws, returns result object
      const result = ensureAgentsMerged(openclawWorkspace, pluginDir);
      log(`AGENTS autodeploy: ${result.status}`);

      if (result.status === "failed") {
        warn(`AGENTS merge failed: ${result.reason}`);
      }
    } else {
      log("AGENTS auto-merge disabled by MUSA_AUTO_MERGE_AGENTS=false");
    }

    // =========================================================================
    // 2. Track platform capabilities
    // =========================================================================
    // Capability truth comes from target file state, not process return value
    const capabilities = {
      staticRules: checkStaticRules(openclawWorkspace),
      dynamicContext: false,
      dispatcher: false,
      stateManager: false,
    };

    // Try to load enhanced components (requires TypeScript compilation)
    let stateManager = null;
    let registerHooks = null;
    let registerDispatcherTool = null;

    try {
      // These modules are compiled from TypeScript
      const { StateManager } = require("./dist/core/state-manager");
      const { registerHooks: registerHooksFn } = require("./dist/adapter/hooks");
      const { registerDispatcherTool: registerDispatcher } = require("./dist/dispatcher");

      // Initialize state manager
      const workspacePath = api.getWorkspacePath?.() || process.cwd();
      stateManager = new StateManager(workspacePath);
      stateManager.initialize().catch(err => {
        api.logger.error?.(`[musa] Failed to initialize state manager: ${err}`);
      });

      registerHooks = registerHooksFn;
      registerDispatcherTool = registerDispatcher;

      // Mark enhanced capabilities as available
      capabilities.dynamicContext = true;
      capabilities.dispatcher = true;
      capabilities.stateManager = true;

      log("Platform runtime layer loaded (enhanced mode)");
    } catch (err) {
      warn("Enhanced platform layer not available. Run 'npm run build' to compile TypeScript.");
      warn(`Error: ${err.message}`);
      // Dispatcher is still available via existing tools (fallback)
      capabilities.dispatcher = true;
    }

    // 3. Register hooks for dynamic context injection (if available)
    if (registerHooks && stateManager) {
      registerHooks(api, stateManager);
      log("Registered adapter hooks: before_prompt_build, session_end");
    }

    // 4. Register dispatcher tool as primary entry point (if available)
    if (registerDispatcherTool && stateManager) {
      registerDispatcherTool(api, stateManager);
      log("Registered dispatcher tool: musa_dispatch");
    }

    // 5. Register existing tools (fallback layer)
    registerMusaTools(api);
    log("Registered execution tools: musa_set_mode, musa_get_mode, musa_exec, musa_docker, musa_sync");

    // Tool call logging
    api.on("before_tool_call", (event) => {
      if (event.toolName.startsWith("musa_")) {
        log(`tool call: ${event.toolName}`);
      }
    });

    api.on("after_tool_call", (event) => {
      if (event.toolName.startsWith("musa_")) {
        if (event.error) {
          api.logger.error?.(
            `[musa] tool fail: ${event.toolName} ${event.error} (${event.durationMs ?? 0}ms)`
          );
        } else {
          log(`tool done: ${event.toolName} (${event.durationMs ?? 0}ms)}`);
        }
      }
    });

    // Output capability check
    log("=== Platform Capabilities ===");
    log(`  Static Rules (AGENTS.md): ${capabilities.staticRules ? "✓" : "✗"}`);
    log(`  Dynamic Context (hook): ${capabilities.dynamicContext ? "✓" : "✗"}`);
    log(`  Dispatcher (manual): ${capabilities.dispatcher ? "✓" : "✗"}`);
    log(`  State Manager: ${capabilities.stateManager ? "✓" : "✗"}`);
    log("=============================");

    if (!capabilities.staticRules) {
      warn("Static rules not available. Check AGENTS.md merge status.");
    }

    if (!capabilities.dynamicContext) {
      log("Note: Platform degraded mode - musa_dispatch still callable manually");
    }

    log("MUSA Deployment Platform initialized");
  },
};

module.exports = plugin;
module.exports.default = plugin;