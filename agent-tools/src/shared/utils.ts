/**
 * Escape single quotes for shell command construction
 */
export function escapeSingleQuotes(value: string): string {
  return value.replace(/'/g, "'\\''");
}

/**
 * Escape double quotes for shell command construction
 */
export function escapeDoubleQuotes(value: string): string {
  return value.replace(/[\\"$`]/g, "\\$&");
}

/**
 * Quote a value for shell execution
 */
export function shellQuote(value: string): string {
  return `'${escapeSingleQuotes(value)}'`;
}

/**
 * Build working directory prefix for remote commands
 * Handles ~, ~user/, and absolute paths
 */
export function buildWorkdirPrefix(workdir: string): string {
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
export function truncateOutput(text: string, maxBytes: number = 51200): string {
  if (Buffer.byteLength(text) <= maxBytes) return text;
  const truncated = Buffer.from(text).subarray(0, maxBytes).toString("utf-8");
  return truncated + "\n\n--- OUTPUT TRUNCATED (exceeded 50KB) ---";
}

/**
 * Check if a local dependency is available
 */
export function checkDependency(name: string): boolean {
  try {
    // Try to find the command in PATH
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
export function formatOutput(stdout: string, stderr: string, exitCode: number): string {
  let output = "";
  if (stdout.trim()) output += stdout;
  if (stderr.trim()) output += (output ? "\n" : "") + `STDERR:\n${stderr}`;
  output += `\nEXIT CODE: ${exitCode}`;
  return output;
}