"use strict";

const path = require("path");
const { registerMusaTools } = require("./src/tools");
const { ensureAgentsMerged, checkStaticRules } = require("./src/utils/agents-merge");

// Note: TypeScript modules (adapter, dispatcher, state-manager) need to be compiled
// before use. Run: npm run build
// For now, we provide optional loading with fallback.

/**
 * Get LarkTicket from openclaw-lark plugin
 *
 * Uses AsyncLocalStorage to propagate ticket context in the async call chain.
 * Works when the plugin is invoked through openclaw-lark (Feishu messages).
 *
 * @returns {object|undefined} LarkTicket with messageId, chatId, accountId, senderOpenId
 */
function getLarkTicket() {
  try {
    const larkTicketPath = path.join(
      require("os").homedir(),
      ".openclaw/extensions/openclaw-lark/src/core/lark-ticket.js"
    );
    const { getTicket } = require(larkTicketPath);
    return getTicket();
  } catch {
    return undefined;
  }
}

/**
 * Format trace prefix for logging
 * Simple format: [TRACE:messageId]
 */
function formatTracePrefix() {
  const ticket = getLarkTicket();
  if (!ticket?.messageId) return "";
  return `[TRACE:${ticket.messageId}] `;
}

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

  // CRITICAL: This fix assumes OpenClaw plugin loader awaits register():
  //   await plugin.register(api)
  // If the framework only calls register() without awaiting, race condition may still occur.
  // TODO: Verify OpenClaw plugin loading behavior
  async register(api) {
    const log = (msg) => api.logger.info?.(`[musa] ${formatTracePrefix()}${msg}`);
    const warn = (msg) => api.logger.warn?.(`[musa] ${formatTracePrefix()}${msg}`);

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

      // Initialize state manager (MUST wait for completion before accepting requests)
      // Race condition fix: if Feishu message arrives before initialize() completes,
      // executor.refreshCache() would fallback to local mode incorrectly
      const workspacePath = api.getWorkspacePath?.() || process.cwd();
      stateManager = new StateManager(workspacePath);
      try {
        await stateManager.initialize();
        log("StateManager initialized successfully");
      } catch (err) {
        api.logger.error?.(`[musa] Failed to initialize state manager: ${err?.stack || err}`);
        throw err; // Fail fast - state manager must be ready before accepting requests
      }

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
    // Pass stateManager for mode persistence
    registerMusaTools(api, stateManager);
    log("Registered execution tools: musa_set_mode, musa_get_mode, musa_exec, musa_docker, musa_sync");

    // Tool call logging with trace context
    api.on("before_tool_call", (event) => {
      if (event.toolName.startsWith("musa_")) {
        const tracePrefix = formatTracePrefix();
        log(`${tracePrefix}tool call: ${event.toolName}`);
      }
    });

    api.on("after_tool_call", (event) => {
      if (event.toolName.startsWith("musa_")) {
        const tracePrefix = formatTracePrefix();
        if (event.error) {
          api.logger.error?.(
            `[musa] ${tracePrefix}tool fail: ${event.toolName} ${event.error} (${event.durationMs ?? 0}ms)`
          );
        } else {
          log(`${tracePrefix}tool done: ${event.toolName} (${event.durationMs ?? 0}ms)}`);
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
// Export getLarkTicket for use in compiled modules
module.exports.getLarkTicket = getLarkTicket;
module.exports.formatTracePrefix = formatTracePrefix;