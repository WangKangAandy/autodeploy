"use strict";

const {
  registerMusaSetModeTool,
  registerMusaExecTool,
  registerMusaGetModeTool,
} = require("./musa-exec");
const { registerMusaDockerTool } = require("./musa-docker");
const { registerMusaSyncTool } = require("./musa-sync");

/**
 * Register all MUSA deployment tools
 *
 * @param {Object} api - OpenClaw plugin API
 * @param {Object} stateManager - StateManager instance for persistence
 */
function registerMusaTools(api, stateManager = null) {
  // Mode management tools
  registerMusaSetModeTool(api, stateManager);
  registerMusaGetModeTool(api);

  // Execution tools
  registerMusaExecTool(api);
  registerMusaDockerTool(api);
  registerMusaSyncTool(api);
}

module.exports = {
  registerMusaTools,
};