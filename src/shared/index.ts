/**
 * Shared Module - Trace Framework
 *
 * Export trace context management and structured logging.
 */

export {
  // Types
  type TraceContext,
  type TracePayload,
  type Span,
  type PlatformTraceMetadata,

  // Context Management
  generateTraceId,
  generateSpanId,
  createTraceContext,
  getTraceContext,
  getTraceId,
  withTraceContext,
  updateTraceMetadata,

  // Span Lifecycle
  startSpan,
  finishSpan,

  // Payload Extraction
  extractTracePayload,
  contextFromPayload,

  // Utilities
  formatTracePrefix,
  isInTraceContext,
} from "./trace"

export {
  // Types
  type LogLevel,
  type EventType,
  type StructuredLogEntry,
  type StructuredLogger,
  type LoggerOptions,

  // Logger
  createLogger,
  initGlobalLogger,
  getLogger,
} from "./logger"