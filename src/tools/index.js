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
 */
function registerMusaTools(api) {
  // Mode management tools
  registerMusaSetModeTool(api);
  registerMusaGetModeTool(api);

  // Execution tools
  registerMusaExecTool(api);
  registerMusaDockerTool(api);
  registerMusaSyncTool(api);
}

module.exports = {
  registerMusaTools,
};