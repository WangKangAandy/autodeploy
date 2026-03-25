/**
 * Document-Driven Execution Types
 *
 * 所有类型定义统一放在这里，避免前后漂移。
 * 这是文档驱动编排能力的唯一类型来源。
 */

import type { Intent, RiskLevel } from "../core/state-manager"

// ============================================================================
// Document Loading
// ============================================================================

/**
 * Document loader interface for fetching documents from various sources
 */
export interface DocumentLoader {
  load(url: string): Promise<RawDocument>
  loadFromFeishu(token: string, credentials: FeishuCredentials): Promise<RawDocument>
  loadFromDingding(token: string, credentials: DingdingCredentials): Promise<RawDocument>
  loadFromLocal(path: string): Promise<RawDocument>
  loadFromPasted(content: string): Promise<RawDocument>
}

/**
 * Raw document content after loading, before parsing
 */
export interface RawDocument {
  source: "feishu" | "dingding" | "local" | "pasted"
  content: string              // 归一化后的 Markdown
  provenance: DocumentProvenance
  originalFormat?: "markdown" | "html" | "docx"
  metadata?: Record<string, unknown>
}

/**
 * Document provenance tracking for audit and debugging
 */
export interface DocumentProvenance {
  url?: string
  filePath?: string
  fetchedAt: string
  documentVersion?: string
  contentHash: string
}

/**
 * Credentials for Feishu API access
 */
export interface FeishuCredentials {
  appId: string
  appSecret: string
}

/**
 * Credentials for Dingding API access
 */
export interface DingdingCredentials {
  clientId: string
  clientSecret: string
}

// ============================================================================
// Document Parsing
// ============================================================================

/**
 * Parsed document structure with phases and steps
 */
export interface ParsedDocument {
  id: string
  source: "feishu" | "dingding" | "local" | "pasted"
  title: string
  provenance: DocumentProvenance
  metadata: DocumentMetadata
  phases: ExecutionPhase[]
  validationEndpoints: ValidationEndpoint[]
  unparsedSections: string[]
  totalSections: number
}

/**
 * Document metadata extracted from tables or headers
 */
export interface DocumentMetadata {
  sdkVersion?: string
  driverVersion?: string
  gpuType?: string
  dockerImage?: string
  customVars: Record<string, string>
}

/**
 * Execution phase containing steps
 */
export interface ExecutionPhase {
  id: string
  name: string
  steps: ExecutionStep[]
}

/**
 * Execution step with command and metadata
 */
export interface ExecutionStep {
  id: string
  type: "shell" | "docker_exec" | "docker_run" | "validation" | "skill_invoke" | "manual"
  command?: string
  skillIntent?: Intent
  description: string
  riskLevel: RiskLevel
  requiresSudo?: boolean
  // Validation 相关
  validationLevel?: "infra" | "service" | "business"
  expectedOutput?: string
}

/**
 * Validation endpoint definition
 */
export interface ValidationEndpoint {
  id: string
  description: string
  command: string
  expectedOutput?: string
  isTerminal: boolean
}

// ============================================================================
// Execution Plan
// ============================================================================

/**
 * Generated execution plan from parsed document
 */
export interface ExecutionPlan {
  id: string
  documentId: string
  createdAt: string
  phases: PlanPhase[]
  variables: Record<string, string>
  status: PlanStatus
  unparsedSections: string[]
  totalSections: number
}

/**
 * Phase in the execution plan
 */
export interface PlanPhase {
  id: string
  name: string
  steps: PlanStep[]
}

/**
 * Step in the execution plan
 */
export interface PlanStep {
  id: string
  executionStep: ExecutionStep
  status: StepStatus
  output?: string
  error?: string
  startedAt?: string
  completedAt?: string
  retryCount: number
}

/**
 * Plan status
 */
export type PlanStatus = "draft" | "approved" | "executing" | "completed" | "failed" | "paused"

/**
 * Step status
 */
export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped" | "awaiting_input"

// ============================================================================
// State Management
// ============================================================================

/**
 * Document execution state for tracking progress
 */
export interface DocumentExecutionState {
  id: string
  operationId: string              // 关联到 Operation
  planId: string
  documentId: string
  status: ExecutionStatus
  currentPhase: string
  currentStep: string
  phases: PhaseState[]
  variables: Record<string, string>
  createdAt: string
  updatedAt: string
  completedAt?: string
  error?: string
}

/**
 * Phase state for tracking phase progress
 */
export interface PhaseState {
  id: string
  name: string
  status: PhaseStatus
  steps: StepState[]
  startedAt?: string
  completedAt?: string
}

/**
 * Step state for tracking step progress
 */
export interface StepState {
  id: string
  kind: ExecutionStep["type"]   // 镜像字段，方便排障
  status: StepStatus
  output?: string
  error?: string
  startedAt?: string
  completedAt?: string
  retryCount: number
}

/**
 * Execution status
 */
export type ExecutionStatus = "pending" | "running" | "completed" | "failed" | "paused" | "awaiting_input"

/**
 * Phase status
 */
export type PhaseStatus = "pending" | "running" | "completed" | "failed" | "skipped"

// ============================================================================
// Validation Results
// ============================================================================

/**
 * Safety validation result from safety-validator
 */
export interface SafetyValidationResult {
  passed: boolean
  violations: SafetyViolation[]
  highRiskSteps: ExecutionStep[]
  blockedSteps: ExecutionStep[]
}

/**
 * Safety violation
 */
export interface SafetyViolation {
  ruleId: string
  stepId: string
  message: string
  severity: "error" | "warning"
}

/**
 * Execution validation result from executor
 */
export interface ExecutionValidationResult {
  level: "infra" | "service" | "business"
  passed: boolean
  details: string
}

// ============================================================================
// Dispatch
// ============================================================================

/**
 * Internal dispatch parameters for substep execution
 */
export interface InternalDispatchParams {
  intent: Intent
  parentOperationId: string
  context: Record<string, unknown>
  mode: "internal"
}

// ============================================================================
// Plan Review & Manual Steps
// ============================================================================

/**
 * Unified awaiting input context
 */
export interface AwaitingInputContext {
  type: "plan_review" | "manual_step"
  payload: PlanReviewPayload | ManualStepPayload
  createdAt: string
}

/**
 * Plan review payload for awaiting input
 */
export interface PlanReviewPayload {
  planId: string
  summary: string
  highRiskSteps: ExecutionStep[]
  unparsedSections: string[]
}

/**
 * Manual step payload for awaiting input
 */
export interface ManualStepPayload {
  stepId: string
  phaseId: string
  description: string
}

// ============================================================================
// Unparsed Sections Policy
// ============================================================================

/**
 * Policy for handling unparsed sections
 */
export interface UnparsedSectionPolicy {
  allowContinue: boolean
  threshold: number
  requireManualConfirm: boolean
}

/**
 * Result of unparsed sections handling
 */
export interface PlanReviewResult {
  requiresConfirmation: boolean
  reason?: string
  unparsedHighlight: string[]
}

// ============================================================================
// Resume & Revalidation
// ============================================================================

/**
 * Revalidation result for resume
 */
export interface RevalidationResult {
  passed: boolean
  details: string
  checks: {
    hostReachable: boolean
    containerExists?: boolean
    serviceRunning?: boolean
  }
}