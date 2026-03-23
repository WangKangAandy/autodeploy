"use strict";

/**
 * Escape single quotes for shell command construction
 */
function escapeSingleQuotes(value) {
  return value.replace(/'/g, "'\\''");
}

/**
 * Escape double quotes for shell command construction
 */
function escapeDoubleQuotes(value) {
  return value.replace(/[\\"$`]/g, "\\$&");
}

/**
 * Quote a value for shell execution
 */
function shellQuote(value) {
  return `'${escapeSingleQuotes(value)}'`;
}

/**
 * Build working directory prefix for remote commands
 * Handles ~, ~user/, and absolute paths
 */
function buildWorkdirPrefix(workdir) {
  if (workdir === "~") return "";
  if (workdir.startsWith("~/")) {
    return `cd "$HOME/${escapeDoubleQuotes(workdir.slice(2))}" && `;
  }
  const otherUserHome = workdir.match(/^(~[^/]+)(?:\/(.*))?$/);
  if (otherUserHome) {
    const [, homePrefix, rest = ""] = otherUserHome;
    if (!rest) return `cd ${homePrefix} && `;
    return `cd ${homePrefix}/${shellQuote(rest)} && `;
  }
  return `cd '${escapeSingleQuotes(workdir)}' && `;
}

/**
 * Truncate output to prevent excessive response sizes
 * Default limit: 50KB
 */
function truncateOutput(text, maxBytes = 51200) {
  if (Buffer.byteLength(text) <= maxBytes) return text;
  const truncated = Buffer.from(text).subarray(0, maxBytes).toString("utf-8");
  return truncated + "\n\n--- OUTPUT TRUNCATED (exceeded 50KB) ---";
}

/**
 * Check if a local dependency is available
 */
function checkDependency(name) {
  try {
    const spawnSync = require("child_process").spawnSync;
    const result = spawnSync("which", [name], { stdio: "ignore" });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Format command output with exit code
 */
function formatOutput(stdout, stderr, exitCode) {
  let output = "";
  if (stdout.trim()) output += stdout;
  if (stderr.trim()) output += (output ? "\n" : "") + `STDERR:\n${stderr}`;
  output += `\nEXIT CODE: ${exitCode}`;
  return output;
}

/**
 * Format tool result for OpenClaw
 */
function formatToolResult(data, options = {}) {
  const { indent = 2 } = options;
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, indent),
      },
    ],
    details: data,
  };
}

/**
 * Format error as tool result
 */
function formatToolError(error, context) {
  const errorMsg = error instanceof Error ? error.message : String(error);
  return formatToolResult({
    error: errorMsg,
    ...context,
  });
}

module.exports = {
  escapeSingleQuotes,
  escapeDoubleQuotes,
  shellQuote,
  buildWorkdirPrefix,
  truncateOutput,
  checkDependency,
  formatOutput,
  formatToolResult,
  formatToolError,
};