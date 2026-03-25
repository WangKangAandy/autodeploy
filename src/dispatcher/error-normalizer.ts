/**
 * Error Normalizer
 *
 * Standardizes errors from various sources into a consistent format.
 */

import type { Intent } from "../core/state-manager"

export type DispatchErrorCode =
  | "PRECHECK_FAILED"
  | "PERMISSION_DENIED"
  | "EXECUTION_ERROR"
  | "TIMEOUT"
  | "INTENT_UNKNOWN"
  | "STATE_ERROR"
  | "OPERATION_CONFLICT"     // 幂等检查失败
  | "OPERATION_NOT_FOUND"    // Resume 找不到 operation
  | "OPERATION_NOT_RESUMABLE" // Resume 状态不合法
  | "RESUME_PREREQUISITE_NOT_MET"  // Resume 前提不满足

export interface DispatchError {
  code: DispatchErrorCode
  intent: Intent | "unknown"
  step: string
  originalError: string
  guidance: string
  recoverable: boolean
}

/**
 * Normalize an error into DispatchError format
 */
export function normalizeError(
  error: unknown,
  intent: Intent,
  step: string
): DispatchError {
  const originalError = error instanceof Error ? error.message : String(error)

  // Detect error type from message patterns
  if (originalError.includes("ECONNREFUSED") || originalError.includes("ETIMEDOUT")) {
    return {
      code: "EXECUTION_ERROR",
      intent,
      step,
      originalError,
      guidance: "Host is not reachable. Check network connectivity and ensure the host is running.",
      recoverable: true,
    }
  }

  if (originalError.includes("permission denied") || originalError.includes("Permission denied")) {
    return {
      code: "PERMISSION_DENIED",
      intent,
      step,
      originalError,
      guidance: "Permission denied. Check sudo privileges or file permissions.",
      recoverable: true,
    }
  }

  if (originalError.includes("timeout") || originalError.includes("Timeout")) {
    return {
      code: "TIMEOUT",
      intent,
      step,
      originalError,
      guidance: "Operation timed out. Try increasing timeout or check system load.",
      recoverable: true,
    }
  }

  if (originalError.includes("not found") || originalError.includes("command not found")) {
    return {
      code: "EXECUTION_ERROR",
      intent,
      step,
      originalError,
      guidance: "Required command or resource not found. Ensure dependencies are installed.",
      recoverable: true,
    }
  }

  // Default error
  return {
    code: "EXECUTION_ERROR",
    intent,
    step,
    originalError,
    guidance: "An unexpected error occurred. Check the error message for details.",
    recoverable: false,
  }
}

/**
 * Create a precheck failure error
 */
export function precheckFailedError(
  intent: Intent,
  failures: { name: string; message: string }[]
): DispatchError {
  return {
    code: "PRECHECK_FAILED",
    intent,
    step: "precheck",
    originalError: failures.map(f => `${f.name}: ${f.message}`).join("; "),
    guidance: "Pre-flight checks failed. Resolve the issues above before retrying.",
    recoverable: true,
  }
}

/**
 * Create a permission denied error
 */
export function permissionDeniedError(intent: Intent, message: string): DispatchError {
  return {
    code: "PERMISSION_DENIED",
    intent,
    step: "permission_check",
    originalError: message,
    guidance: "This operation requires confirmation. Use force=true to skip confirmation, or explicitly confirm the operation.",
    recoverable: true,
  }
}

/**
 * Create an unknown intent error
 */
export function unknownIntentError(query: string): DispatchError {
  return {
    code: "INTENT_UNKNOWN",
    intent: "unknown",
    step: "intent_parse",
    originalError: `Could not determine intent from query: "${query}"`,
    guidance: "Please specify an explicit intent: deploy_env, update_driver, gpu_status, validate, sync, or run_container.",
    recoverable: true,
  }
}

/**
 * Create an operation conflict error (idempotency check failure)
 */
export function operationConflictError(
  intent: Intent,
  hostId: string,
  conflictOpId: string
): DispatchError {
  return {
    code: "OPERATION_CONFLICT",
    intent,
    step: "idempotency_check",
    originalError: `Operation ${conflictOpId} already running on host ${hostId} with same intent`,
    guidance: `A ${intent} operation is already in progress on host ${hostId}.\n\nUse action="status" to check progress, or action="resume" to continue the existing operation.\n\nTo force a new operation, wait for the existing one to complete or use action="cancel" first.`,
    recoverable: true,
  }
}

/**
 * Format DispatchError for display
 */
export function formatDispatchError(error: DispatchError): string {
  const lines = [
    `## Error: ${error.code}`,
    "",
    `**Intent**: ${error.intent}`,
    `**Step**: ${error.step}`,
    "",
    "### Original Error",
    "```",
    error.originalError,
    "```",
    "",
    "### Guidance",
    error.guidance,
    "",
    `**Recoverable**: ${error.recoverable ? "Yes" : "No"}`,
  ]

  return lines.join("\n")
}