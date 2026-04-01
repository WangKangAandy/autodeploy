import {
  registerMusaModeTool,
  registerMusaExecTool,
} from "./musa-exec"
import { registerMusaDockerTool } from "./musa-docker"
import { registerMusaSyncTool } from "./musa-sync"
import type { StateManager } from "../core/state-manager"

/**
 * Register all MUSA deployment tools
 */
export function registerMusaTools(api: any, stateManager: StateManager | null = null): void {
  // Mode management tool
  registerMusaModeTool(api, stateManager)

  // Execution tools
  registerMusaExecTool(api, stateManager)
  registerMusaDockerTool(api, stateManager)
  registerMusaSyncTool(api, stateManager)
}
