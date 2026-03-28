/**
 * Pre-flight Checks
 *
 * Validates environment readiness before executing operations.
 */

import type { Intent } from "../core/state-manager"
import { getMode, getRemoteConfig, isRemoteReady } from "../core/executor.js"

export interface CheckResult {
  passed: boolean
  checks: CheckItem[]
  guidance: string[]
}

export interface CheckItem {
  name: string
  passed: boolean
  message: string
  critical: boolean
}

/**
 * Run pre-flight checks for an intent
 */
export async function runPreFlightCheck(intent: Intent): Promise<CheckResult> {
  const checks: CheckItem[] = []
  const guidance: string[] = []

  // Always check host connectivity
  checks.push(await checkHostReachable())

  // Intent-specific checks
  switch (intent) {
    case "gpu_status":
      // Basic check only
      break

    case "validate":
      checks.push(await checkDockerAvailable())
      break

    case "sync":
      // Host check only
      break

    case "run_container":
      checks.push(await checkDockerAvailable())
      break

    case "deploy_env":
      checks.push(await checkDockerAvailable())
      checks.push(await checkSudoAvailable())
      break

    case "update_driver":
      checks.push(await checkMthreadsGmiAvailable())
      checks.push(await checkSudoAvailable())
      break

    case "auto":
      // Run basic checks
      checks.push(await checkDockerAvailable())
      break
  }

  // Aggregate results
  const criticalFailures = checks.filter(c => !c.passed && c.critical)
  const passed = criticalFailures.length === 0

  // Build guidance for failures
  for (const check of checks) {
    if (!check.passed) {
      guidance.push(getGuidanceForCheck(check.name))
    }
  }

  return { passed, checks, guidance }
}

/**
 * Check if host is reachable
 */
async function checkHostReachable(): Promise<CheckItem> {
  const mode = getMode()

  if (mode === "local") {
    return {
      name: "host_reachable",
      passed: true,
      message: "Running in local mode",
      critical: true,
    }
  }

  if (!isRemoteReady()) {
    return {
      name: "host_reachable",
      passed: false,
      message: "Remote mode not configured. Call musa_set_mode first.",
      critical: true,
    }
  }

  // For remote mode, we assume reachable if config is set
  // Actual connectivity is tested during command execution
  const config = getRemoteConfig() as { host?: string } | null
  return {
    name: "host_reachable",
    passed: true,
    message: `Remote host configured: ${config?.host || 'unknown'}`,
    critical: true,
  }
}

/**
 * Check if Docker is available
 */
async function checkDockerAvailable(): Promise<CheckItem> {
  // This would need to execute `docker ps` on the target
  // For now, we return a placeholder that will be validated during execution
  return {
    name: "docker_available",
    passed: true,
    message: "Docker availability will be checked during execution",
    critical: true,
  }
}

/**
 * Check if mthreads-gmi is available
 */
async function checkMthreadsGmiAvailable(): Promise<CheckItem> {
  // This would need to execute `which mthreads-gmi` on the target
  return {
    name: "mthreads_gmi_available",
    passed: true,
    message: "mthreads-gmi availability will be checked during execution",
    critical: false, // Not critical - driver may not be installed yet
  }
}

/**
 * Check if sudo is available
 */
async function checkSudoAvailable(): Promise<CheckItem> {
  // This would need to check sudo availability
  return {
    name: "sudo_available",
    passed: true,
    message: "Sudo availability will be checked during execution",
    critical: true,
  }
}

/**
 * Get guidance for a failed check
 */
function getGuidanceForCheck(checkName: string): string {
  switch (checkName) {
    case "host_reachable":
      return "Ensure the target host is accessible. For remote mode, call musa_set_mode with correct credentials."

    case "docker_available":
      return "Docker is required. Start Docker with: systemctl start docker"

    case "mthreads_gmi_available":
      return "mthreads-gmi not found. Install GPU driver or add to PATH."

    case "sudo_available":
      return "Sudo privileges are required for this operation. Ensure sudo password is configured."

    default:
      return `Check "${checkName}" failed. Please resolve the issue and retry.`
  }
}