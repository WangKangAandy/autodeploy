/**
 * Router
 *
 * Routes intents to appropriate skills, tools, or handlers.
 */

import type { Intent } from "../core/state-manager.js"
import type { StateManager } from "../core/state-manager.js"
import { getIntentSkillPath } from "./intent-parser.js"

export interface RouteResult {
  type: "skill" | "tool" | "direct" | "error"
  target: string
  params: Record<string, unknown>
  message: string
}

export interface RouterContext {
  intent: Intent
  context: Record<string, unknown>
  action: "start" | "status" | "resume" | "cancel"
  stateManager: StateManager
}

/**
 * Route an intent to the appropriate handler
 */
export async function routeToHandler(ctx: RouterContext): Promise<RouteResult> {
  const { intent, context, action } = ctx

  switch (intent) {
    case "deploy_env":
      return routeDeployEnv(context, action)

    case "update_driver":
      return routeUpdateDriver(context, action)

    case "gpu_status":
      return routeGpuStatus(context)

    case "validate":
      return routeValidate(context)

    case "sync":
      return routeSync(context)

    case "run_container":
      return routeRunContainer(context)

    case "execute_document":
      return routeExecuteDocument(context, action)

    case "auto":
      return {
        type: "error",
        target: "intent_parser",
        params: {},
        message: "Could not determine intent. Please specify an explicit intent.",
      }

    default:
      return {
        type: "error",
        target: "router",
        params: { intent },
        message: `Unknown intent: ${intent}`,
      }
  }
}

/**
 * Route deploy_env intent
 */
async function routeDeployEnv(context: Record<string, unknown>, action: string): Promise<RouteResult> {
  const skillPath = getIntentSkillPath("deploy_env")

  if (action === "status") {
    return {
      type: "direct",
      target: "check_deployment_status",
      params: {},
      message: "Check deployment status from state file: .musa_deployment_state.json",
    }
  }

  if (action === "resume") {
    return {
      type: "skill",
      target: skillPath!,
      params: { resume: true, ...context },
      message: "Resume MUSA environment deployment from last checkpoint.",
    }
  }

  return {
    type: "skill",
    target: skillPath!,
    params: context,
    message: "Start MUSA environment deployment. Follow the skill workflow.",
  }
}

/**
 * Route update_driver intent
 */
async function routeUpdateDriver(context: Record<string, unknown>, action: string): Promise<RouteResult> {
  const skillPath = getIntentSkillPath("update_driver")

  return {
    type: "skill",
    target: skillPath!,
    params: context,
    message: "Start GPU driver update. Follow the skill workflow.",
  }
}

/**
 * Route gpu_status intent
 */
async function routeGpuStatus(context: Record<string, unknown>): Promise<RouteResult> {
  return {
    type: "tool",
    target: "musa_exec",
    params: {
      command: "mthreads-gmi",
      ...context,
    },
    message: "Check GPU status with mthreads-gmi.",
  }
}

/**
 * Route validate intent
 */
async function routeValidate(context: Record<string, unknown>): Promise<RouteResult> {
  // Validation is a multi-step process
  return {
    type: "direct",
    target: "validation_sequence",
    params: context,
    message: `Run validation sequence:
1. Host: mthreads-gmi
2. Container: docker run --rm --env MTHREADS_VISIBLE_DEVICES=all registry.mthreads.com/cloud-mirror/ubuntu:20.04 mthreads-gmi
3. PyTorch: python -c "import torch; print(torch.musa.is_available())"`,
  }
}

/**
 * Route sync intent
 */
async function routeSync(context: Record<string, unknown>): Promise<RouteResult> {
  return {
    type: "tool",
    target: "musa_sync",
    params: context,
    message: "Sync files between local and remote hosts.",
  }
}

/**
 * Route run_container intent
 */
async function routeRunContainer(context: Record<string, unknown>): Promise<RouteResult> {
  return {
    type: "tool",
    target: "musa_docker",
    params: context,
    message: "Run Docker container with GPU access.",
  }
}

/**
 * Route execute_document intent
 *
 * Document-driven execution orchestration:
 * 1. Load document (local file or pasted content)
 * 2. Parse document into structured plan
 * 3. Generate execution plan
 * 4. Safety validation
 * 5. Plan Review (awaiting user confirmation)
 * 6. Execute steps
 */
async function routeExecuteDocument(context: Record<string, unknown>, action: string): Promise<RouteResult> {
  if (action === "status") {
    return {
      type: "direct",
      target: "check_document_execution_status",
      params: context,
      message: "Check document execution status from state file.",
    }
  }

  if (action === "resume") {
    return {
      type: "direct",
      target: "resume_document_execution",
      params: { resume: true, ...context },
      message: "Resume document execution from last checkpoint.",
    }
  }

  return {
    type: "direct",
    target: "document_executor",
    params: context,
    message: `Execute deployment from document.

Flow:
1. Load document (local path or pasted content)
2. Parse document into phases and steps
3. Generate execution plan
4. Safety validation
5. Plan Review (await user confirmation)
6. Execute steps sequentially

Supported sources:
- Local file: path=/path/to/document.md
- Pasted content: content="..."`,
  }
}