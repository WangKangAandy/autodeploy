/**
 * OpenClaw Hook Registrations
 *
 * Registers hooks for cognitive injection and lifecycle management.
 */

import type { StateManager } from "../core/state-manager.js"
import { buildDynamicContext } from "./context-builder.js"

// Import executor's refreshCache function
// Note: executor.js is plain JS, so we use require
const executor = require("../core/executor.js")

export interface OpenClawAPI {
  on: (hookName: string, handler: (event: any) => void | Promise<void>, opts?: { priority?: number }) => void
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

  // Dynamic context injection - highest priority
  // Note: priority is passed as second argument object in some OpenClaw versions
  try {
    api.on("before_prompt_build", async (event: BeforePromptBuildEvent) => {
      try {
        // 1. Refresh executor cache from StateManager (ensures mode is up-to-date)
        await executor.refreshCache()

        // 2. Build and inject dynamic context
        const dynamicContext = await buildDynamicContext(stateManager)
        event.prependSystemContext(dynamicContext)
        log("Dynamic context injected")
      } catch (err) {
        api.logger.error?.(`[musa-adapter] Failed to build dynamic context: ${err}`)
      }
    }, { priority: 100 })
  } catch {
    // Fallback for APIs that don't support priority
    api.on("before_prompt_build", async (event: BeforePromptBuildEvent) => {
      try {
        // 1. Refresh executor cache from StateManager
        await executor.refreshCache()

        // 2. Build and inject dynamic context
        const dynamicContext = await buildDynamicContext(stateManager)
        event.prependSystemContext(dynamicContext)
        log("Dynamic context injected")
      } catch (err) {
        api.logger.error?.(`[musa-adapter] Failed to build dynamic context: ${err}`)
      }
    })
  }

  // State persistence on session end
  try {
    api.on("session_end", async () => {
      try {
        await stateManager.persistAll()
        log("State persisted on session end")
      } catch (err) {
        api.logger.error?.(`[musa-adapter] Failed to persist state: ${err}`)
      }
    }, { priority: 50 })
  } catch {
    api.on("session_end", async () => {
      try {
        await stateManager.persistAll()
        log("State persisted on session end")
      } catch (err) {
        api.logger.error?.(`[musa-adapter] Failed to persist state: ${err}`)
      }
    })
  }

  log("Hooks registered: before_prompt_build, session_end")
}

interface BeforePromptBuildEvent {
  prependSystemContext: (content: string) => void
  appendSystemContext?: (content: string) => void
}