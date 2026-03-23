"use strict";

const { registerMusaTools } = require("./src/tools");

/**
 * OpenClaw MUSA Deployment Plugin
 *
 * Provides MUSA SDK environment deployment and GPU driver management capabilities.
 * Supports both local and remote deployment modes.
 */
const plugin = {
  id: "openclaw-musa",
  name: "MUSA Deployment",
  description:
    "MUSA SDK environment deployment and GPU driver management. Supports local and remote deployment modes.",
  configSchema: {
    type: "object",
    properties: {},
  },
  register(api) {
    const log = (msg) => api.logger.info?.(`[musa] ${msg}`);

    // Register MUSA deployment tools
    registerMusaTools(api);

    log("Registered tools: musa_set_mode, musa_get_mode, musa_exec, musa_docker, musa_sync");

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
          log(`tool done: ${event.toolName} (${event.durationMs ?? 0}ms)`);
        }
      }
    });
  },
};

module.exports = plugin;
module.exports.default = plugin;