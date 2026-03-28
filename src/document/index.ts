/**
 * Document-Driven Execution Module
 *
 * 提供文档驱动编排能力：
 * - 解析文档提取执行计划
 * - 生成执行计划
 * - 安全校验
 * - Plan Review
 * - 步骤执行
 */

// ============================================================================
// Types
// ============================================================================

export type {
  // Document Loading
  DocumentLoader,
  RawDocument,
  DocumentProvenance,
  FeishuCredentials,
  DingdingCredentials,

  // Document Parsing
  ParsedDocument,
  DocumentMetadata,
  ExecutionPhase,
  ExecutionStep,
  ValidationEndpoint,

  // Execution Plan
  ExecutionPlan,
  PlanPhase,
  PlanStep,
  PlanStatus,
  StepStatus,

  // State Management
  DocumentExecutionState,
  PhaseState,
  StepState,
  ExecutionStatus,
  PhaseStatus,

  // Validation Results
  SafetyValidationResult,
  SafetyViolation,
  ExecutionValidationResult,

  // Dispatch
  InternalDispatchParams,

  // Plan Review & Manual Steps
  AwaitingInputContext,
  PlanReviewPayload,
  ManualStepPayload,

  // Policy
  UnparsedSectionPolicy,
  PlanReviewResult,

  // Resume & Revalidation
  RevalidationResult,
} from "./types"

// ============================================================================
// Loader
// ============================================================================

export { documentLoader, DocumentLoaderImpl } from "./loader"

// ============================================================================
// Parser
// ============================================================================

export { parseDocument } from "./parser"

// ============================================================================
// Plan Generator
// ============================================================================

export { generatePlan, validatePlan } from "./plan-generator"
export type { PlanValidationResult } from "./plan-generator"

// ============================================================================
// Safety Validator
// ============================================================================

export {
  validateSafety,
  getRiskLevelDescription,
  requiresExplicitConfirmation,
} from "./safety-validator"

// ============================================================================
// Plan Review
// ============================================================================

export {
  generatePlanReview,
  createPlanReviewContext,
  createManualStepContext,
  handleUnparsedSections,
  formatPlanReviewForDisplay,
  DEFAULT_UNPARSED_POLICY,
} from "./plan-review"
export type {
  PlanReviewSummary,
  PlanReviewConfirmation,
  ManualStepConfirmation,
} from "./plan-review"

// ============================================================================
// Executor
// ============================================================================

export { executeStep } from "./executor"
export type {
  ExecutionContext,
  StateManagerAdapter,
  ExecutorAdapter,
  DispatcherAdapter,
  StepExecutionResult,
  OperationUpdate,
  StepStatusUpdate,
  DocumentExecutionState as DocumentExecutionStateFromExecutor,
  ExecOptions,
  DockerExecOptions,
  DockerRunOptions,
  ExecResult,
  DispatchResult,
} from "./executor"