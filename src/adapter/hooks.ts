/**
 * OpenClaw Hook Registrations
 *
 * Registers hooks for cognitive injection and lifecycle management.
 */

import type { StateManager } from "../core/state-manager.js"
import { buildDynamicContext } from "./context-builder.js"

const executor = require("../core/executor.js")

export interface OpenClawAPI {
  on: (hookName: string, handler: (event: any) => any, opts?: { priority?: number }) => void
  logger: {
    info?: (msg: string) => void
    error?: (msg: string) => void
  }
  getWorkspacePath: () => string
}

/**
 * Register all adapter hooks
 */
export function registerHooks(api: OpenClawAPI, stateManager: StateManager): void {
  const log = (msg: string) => api.logger.info?.(`[musa-adapter] ${msg}`)

  // Initialize executor with StateManager reference
  executor.init(stateManager)

  // Dynamic context injection
  api.on("before_prompt_build", (async () => {
    try {
      await executor.refreshCache()
      const dynamicContext = await buildDynamicContext(stateManager)
      log("Dynamic context injected")
      return { prependSystemContext: dynamicContext }
    } catch (err) {
      api.logger.error?.(`[musa-adapter] Failed to build dynamic context: ${err}`)
    }
  }) as any, { priority: 100 })

  // State persistence on session end
  api.on("session_end", (async () => {
    try {
      await stateManager.persistAll()
      log("State persisted on session end")
    } catch (err) {
      api.logger.error?.(`[musa-adapter] Failed to persist state: ${err}`)
    }
  }) as any, { priority: 50 })

  log("Hooks registered: before_prompt_build, session_end")
}