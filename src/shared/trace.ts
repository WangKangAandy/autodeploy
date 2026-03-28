/**
 * Unified Trace Framework - Core Module
 *
 * Platform-agnostic distributed tracing support.
 * Supports feishu, dingtalk, wecom, api, cli and future platforms.
 *
 * Design Principles:
 * 1. TraceContext is runtime context, not message protocol
 * 2. Cross-boundary: only pass minimal TracePayload, not full context
 * 3. traceId is global root ID, requestId is platform-local auxiliary
 * 4. Platform adapters only change at ingress layer, not core trace protocol
 */

import { AsyncLocalStorage } from "node:async_hooks"

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Platform-agnostic message metadata - Adapter layer mapping target
 * Fields are optional to support API/CLI/scheduled tasks (non-IM scenarios)
 */
export interface PlatformTraceMetadata {
  platform: "feishu" | "dingtalk" | "wecom" | "api" | "cli"
  userId?: string
  chatId?: string
  messageId?: string
  platformRequestId?: string  // Platform original ID for cross-referencing platform logs
}

/**
 * Minimal Trace Payload - Cross-boundary transmission
 * Only pass necessary fields, not full context object
 */
export interface TracePayload {
  traceId: string
  spanId: string
  parentSpanId?: string
  sourceService: string      // Calling source service
  sourceSpanName?: string    // Calling source span name
}

/**
 * TraceContext - Runtime context (in-process ALS)
 * Note: This is a runtime object, do not serialize it entirely into message body
 */
export interface TraceContext {
  traceId: string
  spanId: string
  parentSpanId?: string
  startTime: number
  metadata: PlatformTraceMetadata & {
    intent?: string
    toolName?: string
    operationId?: string
  }
}

/**
 * Span - Single operation record
 */
export interface Span {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string               // Operation name
  startTime: number
  endTime?: number
  status: "ok" | "error"
  durationMs?: number        // Unified in milliseconds
  error?: {
    code: string
    message: string
  }
  metadata: Record<string, unknown>
}

// ============================================================================
// AsyncLocalStorage Setup
// ============================================================================

const traceStorage = new AsyncLocalStorage<TraceContext>()

// ============================================================================
// ID Generation
// ============================================================================

/**
 * Generate a unique trace ID
 * Format: {YYYYMMDD}-{HHMMSS}-{random8}
 */
export function generateTraceId(): string {
  const now = new Date()
  const date = now.toISOString().slice(0, 10).replace(/-/g, "")
  const time = now.toTimeString().slice(0, 8).replace(/:/g, "")
  const random = Math.random().toString(36).substring(2, 10)

  return `${date}-${time}-${random}`
}

/**
 * Generate a unique span ID
 * Format: {random8}
 */
export function generateSpanId(): string {
  return Math.random().toString(36).substring(2, 10)
}

// ============================================================================
// Context Management
// ============================================================================

/**
 * Get the current trace context (from async storage)
 */
export function getTraceContext(): TraceContext | undefined {
  return traceStorage.getStore()
}

/**
 * Get the current trace ID (convenience function)
 */
export function getTraceId(): string | undefined {
  return traceStorage.getStore()?.traceId
}

/**
 * Create a new trace context with metadata
 */
export function createTraceContext(
  metadata: TraceContext["metadata"]
): TraceContext {
  return {
    traceId: generateTraceId(),
    spanId: generateSpanId(),
    startTime: Date.now(),
    metadata,
  }
}

/**
 * Run a function within a trace context
 * Supports both sync and async functions, return type is automatically inferred
 */
export function withTraceContext<T>(
  ctx: TraceContext,
  fn: () => T | Promise<T>
): T | Promise<T> {
  return traceStorage.run(ctx, fn)
}

/**
 * Update the current trace context metadata
 */
export function updateTraceMetadata(
  updates: Partial<TraceContext["metadata"]>
): void {
  const context = getTraceContext()
  if (context) {
    Object.assign(context.metadata, updates)
  }
}

// ============================================================================
// Span Lifecycle
// ============================================================================

/**
 * Start a new span
 *
 * Default behavior:
 * - Inherits traceId from current ALS TraceContext
 * - Uses current spanId as parentSpanId (creates child span)
 * - No need to manually pass traceId
 * - If independent trace is needed, create new TraceContext at higher level
 *
 * @param name Span name (operation name)
 * @param metadata Optional metadata for the span
 */
export function startSpan(
  name: string,
  metadata?: Record<string, unknown>
): Span {
  const parentContext = getTraceContext()
  const spanId = generateSpanId()

  const span: Span = {
    traceId: parentContext?.traceId || generateTraceId(),
    spanId,
    parentSpanId: parentContext?.spanId,
    name,
    startTime: Date.now(),
    status: "ok",
    metadata: metadata || {},
  }

  // Update current context's spanId to this span
  if (parentContext) {
    parentContext.spanId = spanId
  }

  return span
}

/**
 * Finish a span with status
 *
 * @param span The span to finish
 * @param status "ok" or "error"
 * @param error Optional error details
 */
export function finishSpan(
  span: Span,
  status: "ok" | "error",
  error?: { code: string; message: string }
): void {
  span.endTime = Date.now()
  span.durationMs = span.endTime - span.startTime
  span.status = status

  if (error) {
    span.error = error
  }
}

// ============================================================================
// Trace Payload Extraction
// ============================================================================

/**
 * Extract minimal trace payload from current context
 * Used for cross-boundary transmission
 *
 * @param sourceService The service name that is making the call
 * @param sourceSpanName Optional span name for the calling operation
 */
export function extractTracePayload(
  sourceService: string,
  sourceSpanName?: string
): TracePayload | undefined {
  const context = getTraceContext()

  if (!context) {
    return undefined
  }

  return {
    traceId: context.traceId,
    spanId: context.spanId,
    parentSpanId: context.parentSpanId,
    sourceService,
    sourceSpanName,
  }
}

/**
 * Create TraceContext from TracePayload
 * Used when receiving trace from upstream
 */
export function contextFromPayload(
  payload: TracePayload,
  metadata?: Partial<TraceContext["metadata"]>
): TraceContext {
  return {
    traceId: payload.traceId,
    spanId: payload.spanId,
    parentSpanId: payload.parentSpanId,
    startTime: Date.now(),
    metadata: {
      platform: "api",  // Default, should be overridden
      ...metadata,
    },
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format trace info for logging
 * Returns a compact string like: [TRACE:abc123|SPAN:xyz|PARENT:def]
 */
export function formatTracePrefix(context?: TraceContext): string {
  const ctx = context || getTraceContext()

  if (!ctx) {
    return ""
  }

  const parts = [`TRACE:${ctx.traceId}`, `SPAN:${ctx.spanId}`]

  if (ctx.parentSpanId) {
    parts.push(`PARENT:${ctx.parentSpanId}`)
  }

  return `[${parts.join("|")}]`
}

/**
 * Check if we're in a trace context
 */
export function isInTraceContext(): boolean {
  return !!traceStorage.getStore()
}