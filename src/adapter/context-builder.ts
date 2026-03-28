/**
 * Dynamic Context Builder
 *
 * Generates runtime context snapshot for injection into prompt via before_prompt_build hook.
 *
 * Token Budget: Only injects essential info to avoid prompt bloat.
 * - Current mode + default host
 * - Active job status
 * - Last deployment status
 * - Document execution status
 * - Max 3 online hosts (to prevent token explosion)
 *
 * Relevance-first: Sort hosts by relevance BEFORE truncation, not after.
 *
 * Note: documentExecution fields are derived runtime view from Operation + DocumentExecutionState,
 * not a new persistence model.
 */

import type { StateManager, ContextSnapshot, HostState, DocumentExecutionState, Operation } from "../core/state-manager.js"

/**
 * Context token budget constraints
 */
const CONTEXT_LIMITS = {
  MAX_HOSTS: 3,            // Maximum hosts to display
  MAX_ERROR_SUMMARY: 200,  // Maximum characters for error summary
}

/**
 * Build dynamic context string for prompt injection
 */
export async function buildDynamicContext(stateManager: StateManager): Promise<string> {
  // Assert StateManager is ready before using it
  stateManager.assertReady()

  const snapshot = await stateManager.loadSnapshot()

  const lines: string[] = [
    "## MUSA Runtime Context",
    "",
    `- **Mode**: ${snapshot.mode}`,
    `- **Default Host**: ${snapshot.defaultHost || "not configured"}`,
    `- **Active Job**: ${formatActiveJob(snapshot.activeJob)}`,
    `- **Last Deployment**: ${snapshot.lastDeploymentStatus || "never run"}`,
  ]

  // Document execution context (derived from Operation + DocumentExecutionState)
  const docExecContext = await buildDocumentExecutionContext(stateManager)
  if (docExecContext) {
    lines.push("", "## Document Execution")
    lines.push(`- **Running**: ${docExecContext.running ? "yes" : "no"}`)
    if (docExecContext.running) {
      lines.push(`- **Current Phase**: ${docExecContext.currentPhase}`)
      lines.push(`- **Current Step**: ${docExecContext.currentStep}`)
      lines.push(`- **Progress**: ${docExecContext.progress}%`)
    }
    if (docExecContext.awaitingInput?.active) {
      lines.push(`- **Awaiting Input**: ${docExecContext.awaitingInput.type}`)
    }
  }

  // Step 1: 过滤在线 hosts
  const allOnlineHosts = snapshot.hosts.filter(h => h.status === "online")

  // Step 2: 先做 relevance 排序（在截断之前！）
  // 使用 host.id 作为统一标识符进行匹配
  const relevanceContext = {
    defaultHost: snapshot.defaultHost,
    activeJobHost: snapshot.activeJob?.hostId,  // 现在可以从 schema 获取
  }
  const sortedHosts = sortByRelevance(allOnlineHosts, relevanceContext)

  // Step 3: 再截断
  const displayedHosts = sortedHosts.slice(0, CONTEXT_LIMITS.MAX_HOSTS)

  if (displayedHosts.length > 0) {
    lines.push("", "## Online Hosts")
    for (const host of displayedHosts) {
      const marker = host.host === snapshot.defaultHost ? " (default)" : ""
      lines.push(`- ✓ ${host.host} (${host.gpu?.type || "unknown"})${marker}`)
    }
    // 正确计算剩余 hosts（基于 allOnlineHosts，不是 snapshot.hosts）
    if (allOnlineHosts.length > CONTEXT_LIMITS.MAX_HOSTS) {
      lines.push(`- ... and ${allOnlineHosts.length - CONTEXT_LIMITS.MAX_HOSTS} more hosts online`)
    }
  }

  lines.push(
    "",
    "## Quick Actions",
    `- Check GPU: \`musa_dispatch(intent="gpu_status")\``,
    `- Resume Deployment: \`musa_dispatch(intent="deploy_env", action="resume")\``,
    `- Validate: \`musa_dispatch(intent="validate")\``,
  )

  return lines.join("\n")
}

/**
 * Document execution context structure
 *
 * This is a derived runtime view from:
 * - Operation.status (running, awaiting_input)
 * - DocumentExecutionState (currentPhase, currentStep, phases)
 * - Operation.context.awaitingInput
 *
 * NOT a new persistence model.
 */
interface DocumentExecutionContext {
  running: boolean
  currentPhase: string
  currentStep: string
  progress: number
  awaitingInput?: {
    active: boolean
    type: "plan_review" | "manual_step"
  }
}

/**
 * Build document execution context from state
 *
 * Derives runtime view from Operation + DocumentExecutionState.
 * Returns null if no document execution is active.
 */
async function buildDocumentExecutionContext(stateManager: StateManager): Promise<DocumentExecutionContext | null> {
  try {
    // Find running or awaiting_input operation with execute_document intent
    const sm = stateManager as unknown as { loadState: (file: string) => Promise<Operation[] | null> }
    const operations = await sm.loadState("operations.json")
    const docOp = operations?.find((op: Operation) =>
      op.intent === "execute_document" &&
      ["running", "awaiting_input"].includes(op.execution.status)
    )

    if (!docOp) return null

    // Get document execution state
    const docExec = await stateManager.getDocumentExecutionByOperationId(docOp.id)
    if (!docExec) return null

    // Calculate progress
    const totalSteps = docExec.phases.reduce((sum, p) => sum + p.steps.length, 0)
    const completedSteps = docExec.phases.reduce(
      (sum, p) => sum + p.steps.filter(s => s.status === "completed").length,
      0
    )
    const progress = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0

    // Get current phase/step names
    const currentPhaseState = docExec.phases.find(p => p.id === docExec.currentPhase)
    const currentPhaseName = currentPhaseState?.name || docExec.currentPhase
    const currentStepState = currentPhaseState?.steps.find(s => s.id === docExec.currentStep)
    const currentStepDesc = currentStepState?.output?.substring(0, 50) || docExec.currentStep

    // Extract awaiting input context
    let awaitingInput: DocumentExecutionContext["awaitingInput"]
    if (docOp.execution.status === "awaiting_input" && docOp.input.params?.awaitingInput) {
      const ai = docOp.input.params.awaitingInput as any
      awaitingInput = {
        active: true,
        type: ai.type || "plan_review",
      }
    }

    return {
      running: docOp.execution.status === "running",
      currentPhase: currentPhaseName,
      currentStep: currentStepDesc,
      progress,
      awaitingInput,
    }
  } catch {
    return null
  }
}

function formatActiveJob(job: ContextSnapshot["activeJob"]): string {
  if (!job) return "none"
  const progress = job.progress ? ` (${job.progress.percentage}%)` : ""
  return `${job.type}${progress} - ${job.status}`
}

/**
 * 相关性排序：activeJobHost > defaultHost > 其他
 * 优先展示相关 host，避免"在线但无关"的 host 挤掉"相关 host"
 */
function sortByRelevance(
  hosts: HostState[],
  context: { defaultHost?: string | null, activeJobHost?: string }
): HostState[] {
  return [...hosts].sort((a, b) => {
    const aScore = getRelevanceScore(a, context)
    const bScore = getRelevanceScore(b, context)
    return bScore - aScore  // 降序
  })
}

/**
 * 计算相关性得分
 *
 * 注意标识符区分：
 * - activeJobHost 是 host.id（从 job.hostId 获取）
 * - defaultHost 是 host.host（IP/hostname，从 snapshot.defaultHost 获取）
 */
function getRelevanceScore(
  host: HostState,
  context: { defaultHost?: string | null, activeJobHost?: string }
): number {
  let score = 0

  // activeJobHost 使用 host.id 匹配
  if (context.activeJobHost && host.id === context.activeJobHost) score += 100

  // defaultHost 使用 host.host 匹配（IP/hostname）
  if (context.defaultHost && host.host === context.defaultHost) score += 50

  return score
}