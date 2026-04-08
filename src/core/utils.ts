import { spawnSync } from "child_process"

export function escapeSingleQuotes(value: string): string {
  return value.replace(/'/g, "'\\''")
}

export function escapeDoubleQuotes(value: string): string {
  return value.replace(/[\\"$`]/g, "\\$&")
}

export function shellQuote(value: string): string {
  return `'${escapeSingleQuotes(value)}'`
}

export function buildWorkdirPrefix(workdir: string): string {
  if (workdir === "~") return ""
  if (workdir.startsWith("~/")) {
    return `cd "$HOME/${escapeDoubleQuotes(workdir.slice(2))}" && `
  }
  const otherUserHome = workdir.match(/^(~[^/]+)(?:\/(.*))?$/)
  if (otherUserHome) {
    const [, homePrefix, rest = ""] = otherUserHome
    if (!rest) return `cd ${homePrefix} && `
    return `cd ${homePrefix}/${shellQuote(rest)} && `
  }
  return `cd '${escapeSingleQuotes(workdir)}' && `
}

export function truncateOutput(text: string, maxBytes = 51200): string {
  if (Buffer.byteLength(text) <= maxBytes) return text
  const truncated = Buffer.from(text).subarray(0, maxBytes).toString("utf-8")
  return truncated + "\n\n--- OUTPUT TRUNCATED (exceeded 50KB) ---"
}

export function checkDependency(name: string): boolean {
  try {
    const result = spawnSync("which", [name], { stdio: "ignore" })
    return result.status === 0
  } catch {
    return false
  }
}

export function formatOutput(stdout: string, stderr: string, exitCode: number): string {
  let output = ""
  if (stdout.trim()) output += stdout
  if (stderr.trim()) output += (output ? "\n" : "") + `STDERR:\n${stderr}`
  output += `\nEXIT CODE: ${exitCode}`
  return output
}

export interface ToolResult {
  content: Array<{ type: string; text: string }>
  details: Record<string, unknown>
}

export function formatToolResult(data: Record<string, unknown>, options: { indent?: number } = {}): ToolResult {
  const { indent = 2 } = options
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, indent) }],
    details: data,
  }
}

export function formatToolError(error: unknown, context?: Record<string, unknown>): ToolResult {
  const errorMsg = error instanceof Error ? error.message : String(error)
  return formatToolResult({ error: errorMsg, ...context })
}

export const SENSITIVE_FIELDS = ["password", "sudoPasswd", "sshPassword", "apiKey", "secret"]

export function sanitizeSensitive(obj: unknown, additionalFields: string[] = []): unknown {
  if (!obj || typeof obj !== "object") return obj
  const allSensitiveFields = [...SENSITIVE_FIELDS, ...additionalFields]
  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (allSensitiveFields.includes(key)) {
      sanitized[key] = "***"
    } else if (value && typeof value === "object") {
      sanitized[key] = sanitizeSensitive(value, additionalFields)
    } else {
      sanitized[key] = value
    }
  }
  return sanitized
}

export function sanitizeString(str: string): string {
  if (!str || typeof str !== "string") return str
  let sanitized = str
  for (const field of SENSITIVE_FIELDS) {
    const patterns = [
      new RegExp(`${field}=['"][^'"]*['"]`, "gi"),
      new RegExp(`${field}\\s*:\\s*["'][^"']*["']`, "gi"),
      new RegExp(`${field}=\\S+`, "gi"),
    ]
    for (const pattern of patterns) {
      sanitized = sanitized.replace(pattern, `${field}=***`)
    }
  }
  return sanitized
}
