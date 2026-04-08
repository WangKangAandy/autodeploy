import * as path from "path"
import * as os from "os"
import { registerMusaTools } from "./tools"
import { ensureAllInjected, checkInjected } from "./utils/inject-manager"

// Note: TypeScript modules (adapter, state-manager) need to be compiled
// before use. Run: npm run build

/**
 * Get LarkTicket from openclaw-lark plugin
 */
export function getLarkTicket(): any {
  try {
    const larkTicketPath = path.join(
      os.homedir(),
      ".openclaw/extensions/openclaw-lark/src/core/lark-ticket.js"
    )
    const { getTicket } = require(larkTicketPath)
    return getTicket()
  } catch {
    return undefined
  }
}

/**
 * Format trace prefix for logging
 */
export function formatTracePrefix(): string {
  const ticket = getLarkTicket()
  if (!ticket?.messageId) return ""
  return `[TRACE:${ticket.messageId}] `
}

/**
 * OpenClaw MUSA Deployment Plugin
 */
const plugin = {
  id: "openclaw-musa",
  name: "MUSA Deployment Platform",
  description:
    "Platform runtime layer for MUSA SDK deployment and GPU management. Provides state management and cognitive injection.",
  configSchema: {
    type: "object",
    properties: {
      workspacePath: {
        type: "string",
        description: "Path for state persistence (default: workspace/autodeploy/)",
      },
    },
  },

  async register(api: any) {
    const log = (msg: string) => api.logger.info?.(`[musa] ${formatTracePrefix()}${msg}`)
    const warn = (msg: string) => api.logger.warn?.(`[musa] ${formatTracePrefix()}${msg}`)

    const openclawWorkspace = process.env.OPENCLAW_WORKSPACE
      || path.join(os.homedir(), ".openclaw", "workspace")
    const pluginDir = __dirname

    log(`OpenClaw workspace: ${openclawWorkspace}`)

    // =========================================================================
    // 1. Auto-inject all sources (AGENTS, IDENTITY, etc.)
    // =========================================================================
    const AUTO_INJECT_ENABLED = process.env.MUSA_AUTO_INJECT !== "false"
    const injectDir = path.join(pluginDir, "inject")

    if (AUTO_INJECT_ENABLED) {
      const results = ensureAllInjected(openclawWorkspace, injectDir)
      for (const [source, result] of Object.entries(results)) {
        log(`Inject ${source}: ${result.status}`)
        if (result.status === "failed") {
          warn(`Inject ${source} failed: ${result.reason}`)
        }
      }
    } else {
      log("Auto-inject disabled by MUSA_AUTO_INJECT=false")
    }

    // =========================================================================
    // 2. Track platform capabilities
    // =========================================================================
    const injectStatus = checkInjected(openclawWorkspace)
    const capabilities = {
      staticRules: injectStatus.agents || false,
      identity: injectStatus.identity || false,
      dynamicContext: false,
      stateManager: false,
    }

    let stateManager: any = null
    let registerHooks: any = null

    try {
      const { StateManager } = require("./core/state-manager")
      const { registerHooks: registerHooksFn } = require("./adapter/hooks")

      const workspacePath = api.getWorkspacePath?.() || process.cwd()
      stateManager = new StateManager(workspacePath)
      await stateManager.initialize()

      registerHooks = registerHooksFn

      capabilities.dynamicContext = true
      capabilities.stateManager = true

      log("Platform runtime layer loaded (enhanced mode)")
    } catch (err: any) {
      warn("Enhanced platform layer not available. Run 'npm run build' to compile TypeScript.")
      warn(`Error: ${err.message}`)
    }

    // 3. Register hooks for dynamic context injection (if available)
    if (registerHooks && stateManager) {
      registerHooks(api, stateManager)
      log("Registered adapter hooks: before_prompt_build, session_end")
    }

    // 4. Register execution tools
    registerMusaTools(api, stateManager)
    log("Registered execution tools: musa_mode, musa_exec, musa_docker, musa_sync")

    // Tool call logging with trace context
    api.on("before_tool_call", (event: any) => {
      if (event.toolName.startsWith("musa_")) {
        const tracePrefix = formatTracePrefix()
        log(`${tracePrefix}tool call: ${event.toolName}`)
      }
    })

    api.on("after_tool_call", (event: any) => {
      if (event.toolName.startsWith("musa_")) {
        const tracePrefix = formatTracePrefix()
        if (event.error) {
          api.logger.error?.(
            `[musa] ${tracePrefix}tool fail: ${event.toolName} ${event.error} (${event.durationMs ?? 0}ms)`
          )
        } else {
          log(`${tracePrefix}tool done: ${event.toolName} (${event.durationMs ?? 0}ms)}`)
        }
      }
    })

    // Output capability check
    log("=== Platform Capabilities ===")
    log(`  Static Rules (AGENTS.md): ${capabilities.staticRules ? "✓" : "✗"}`)
    log(`  Identity (IDENTITY.md): ${capabilities.identity ? "✓" : "✗"}`)
    log(`  Dynamic Context (hook): ${capabilities.dynamicContext ? "✓" : "✗"}`)
    log(`  State Manager: ${capabilities.stateManager ? "✓" : "✗"}`)
    log("=============================")

    if (!capabilities.staticRules) {
      warn("Static rules not available. Check AGENTS.md merge status.")
    }

    log("MUSA Deployment Platform initialized")
  },
}

export default plugin
module.exports = plugin
module.exports.default = plugin
module.exports.getLarkTicket = getLarkTicket
module.exports.formatTracePrefix = formatTracePrefix
