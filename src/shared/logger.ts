/**
 * Unified Trace Framework - Structured Logger
 *
 * Provides structured logging with automatic trace context injection.
 * Supports dual output: human-readable (console) and JSON (log systems).
 *
 * Standard Fields:
 * - timestamp: ISO 8601 format
 * - level: debug/info/warn/error
 * - service: Service name (feishu-bridge, openclaw, dispatcher)
 * - sourceService: Calling source service (cross-service debugging)
 * - message: Log message
 * - traceId: Global trace ID
 * - spanId: Current span ID
 * - parentSpanId: Parent span ID
 * - operationId: Dispatcher Operation ID
 * - event: Event type (standard events defined below)
 * - durationMs: Duration in milliseconds
 * - status: ok/error
 * - error: Error details
 */

import { getLarkTraceId } from "./lark-ticket"

// ============================================================================
// Types
// ============================================================================

export type LogLevel = "debug" | "info" | "warn" | "error"

export type EventType =
  | "message_received"
  | "message_published"
  | "claude_process_start"
  | "claude_process_end"
  | "tool_execute_start"
  | "tool_execute_end"
  | "dispatch_start"
  | "step_start"
  | "step_complete"
  | "step_failed"
  | "operation_complete"
  | "error"

/**
 * Structured log entry - matches the specification
 */
export interface StructuredLogEntry {
  timestamp: string
  level: LogLevel
  service: string
  sourceService?: string  // Calling source service (cross-service debugging)
  message: string

  // Trace fields
  traceId: string
  spanId: string
  parentSpanId?: string
  operationId?: string

  // Event fields
  event: string
  durationMs?: number
  status?: "ok" | "error"

  // Error fields
  error?: {
    code: string
    message: string
    stack?: string
  }
}

export interface StructuredLogger {
  debug(message: string, extra?: Record<string, unknown>): void
  info(message: string, extra?: Record<string, unknown>): void
  warn(message: string, extra?: Record<string, unknown>): void
  error(message: string, extra?: Record<string, unknown>): void

  // Convenience methods
  logEvent(event: EventType, message: string, extra?: Record<string, unknown>): void
  logError(error: Error, extra?: Record<string, unknown>): void
}

export interface LoggerOptions {
  /** Service name */
  service: string
  /** Enable JSON output (default: false, uses human-readable format) */
  jsonOutput?: boolean
  /** Minimum log level (default: info) */
  minLevel?: LogLevel
  /** Include stack traces in error logs (default: true) */
  includeStackTrace?: boolean
}

// ============================================================================
// Logger Implementation
// ============================================================================

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

/**
 * Create a structured logger with automatic trace context injection
 */
export function createLogger(options: LoggerOptions | string): StructuredLogger {
  const opts: LoggerOptions = typeof options === "string"
    ? { service: options }
    : options

  const {
    service,
    jsonOutput = false,
    minLevel = "info",
    includeStackTrace = true,
  } = opts

  const shouldLog = (level: LogLevel): boolean => {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[minLevel]
  }

  const formatTimestamp = (): string => {
    return new Date().toISOString()
  }

  const buildEntry = (
    level: LogLevel,
    message: string,
    extra: Record<string, unknown> = {}
  ): StructuredLogEntry => {
    const traceId = getLarkTraceId() || ""

    const entry: StructuredLogEntry = {
      timestamp: formatTimestamp(),
      level,
      service,
      message,
      traceId,
      spanId: "",  // Simplified: not using span for now
      event: (extra.event as string) || level,
      ...extra,
    }

    // Add operationId if present
    if (extra.operationId) {
      entry.operationId = extra.operationId as string
    }

    // Add sourceService if present
    if (extra.sourceService) {
      entry.sourceService = extra.sourceService as string
    }

    return entry
  }

  const formatHumanReadable = (entry: StructuredLogEntry): string => {
    const tracePrefix = entry.traceId ? `[TRACE:${entry.traceId}]` : ""
    const levelStr = `[${entry.level.toUpperCase()}]`
    const serviceStr = `[${entry.service}]`
    const opStr = entry.operationId ? `[OP:${entry.operationId}]` : ""

    let msg = `${serviceStr} ${tracePrefix}${opStr} ${levelStr} ${entry.message}`

    // Add extra fields (excluding trace fields we already showed)
    const extraFields: string[] = []
    for (const [key, value] of Object.entries(entry)) {
      if (!["timestamp", "level", "service", "message", "traceId", "spanId", "parentSpanId", "operationId", "event"].includes(key)) {
        if (value !== undefined && value !== null) {
          extraFields.push(`${key}=${JSON.stringify(value)}`)
        }
      }
    }

    if (extraFields.length > 0) {
      msg += ` | ${extraFields.join(" ")}`
    }

    return msg
  }

  const output = (entry: StructuredLogEntry): void => {
    if (jsonOutput) {
      const outputEntry = { ...entry }
      console.log(JSON.stringify(outputEntry))
    } else {
      const formatted = formatHumanReadable(entry)
      switch (entry.level) {
        case "error":
          console.error(formatted)
          break
        case "warn":
          console.warn(formatted)
          break
        case "debug":
          console.debug(formatted)
          break
        default:
          console.log(formatted)
      }
    }
  }

  const log = (
    level: LogLevel,
    message: string,
    extra?: Record<string, unknown>
  ): void => {
    if (!shouldLog(level)) {
      return
    }

    const entry = buildEntry(level, message, extra)
    output(entry)
  }

  return {
    debug(message: string, extra?: Record<string, unknown>): void {
      log("debug", message, extra)
    },

    info(message: string, extra?: Record<string, unknown>): void {
      log("info", message, extra)
    },

    warn(message: string, extra?: Record<string, unknown>): void {
      log("warn", message, extra)
    },

    error(message: string, extra?: Record<string, unknown>): void {
      log("error", message, extra)
    },

    logEvent(event: EventType, message: string, extra?: Record<string, unknown>): void {
      const level = event === "error" || event === "step_failed" ? "error" : "info"
      log(level, message, { ...extra, event })
    },

    logError(error: Error, extra?: Record<string, unknown>): void {
      const errorInfo: Record<string, unknown> = {
        event: "error",
        status: "error",
        error: {
          code: (error as any).code || "UNKNOWN_ERROR",
          message: error.message,
        },
      }

      if (includeStackTrace && error.stack) {
        (errorInfo.error as any).stack = error.stack
      }

      log("error", error.message, { ...errorInfo, ...extra })
    },
  }
}

// ============================================================================
// Global Logger Instance
// ============================================================================

let globalLogger: StructuredLogger | null = null

/**
 * Initialize the global logger
 */
export function initGlobalLogger(options: LoggerOptions | string): void {
  globalLogger = createLogger(options)
}

/**
 * Get the global logger instance
 * Falls back to a default logger if not initialized
 */
export function getLogger(): StructuredLogger {
  if (!globalLogger) {
    globalLogger = createLogger({ service: "unknown" })
  }
  return globalLogger
}