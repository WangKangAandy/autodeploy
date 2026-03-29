/**
 * Skill Registry
 *
 * Loads and caches skill metadata from skills/index.yml.
 * Provides single source of truth for skill path, category, kind, exposure.
 */

import * as fs from "fs"
import * as path from "path"
import { parse as parseYaml } from "yaml"
import type { Intent } from "../core/state-manager.js"

/**
 * Valid intents defined in state-manager.ts
 * Used for runtime validation of dispatch_intent values
 */
const VALID_INTENTS: Intent[] = [
  "deploy_env", "update_driver", "gpu_status", "run_container",
  "validate", "sync", "execute_document", "prepare_model",
  "prepare_dataset", "prepare_package", "manage_images", "prepare_repo", "auto"
]

/**
 * Skill metadata from index.yml
 */
export interface SkillMeta {
  id: string
  name: string
  path: string
  description: string
  category: "env" | "assets" | "workload" | "benchmark" | "migration"
  kind: "atomic" | "meta"
  exposure: "user" | "internal"
  dispatchIntent?: string
  dispatchEntry?: string
  riskLevel: "safe" | "destructive" | "idempotent"
  triggers?: string[]
  inputs?: {
    required?: string[]
    optional?: string[]
  }
  outputs?: string[]
  dependsOn?: string[]
}

/**
 * Raw YAML structure (snake_case fields)
 */
interface RawSkillYaml {
  id: string
  name: string
  path: string
  description: string
  category: "env" | "assets" | "workload" | "benchmark" | "migration"
  kind: "atomic" | "meta"
  exposure: "user" | "internal"
  execution_mode?: string
  dispatch_intent?: string
  dispatch_entry?: string
  risk_level: "safe" | "destructive" | "idempotent"
  triggers?: string[]
  inputs?: {
    required?: string[]
    optional?: string[]
  }
  outputs?: string[]
  depends_on?: string[]
}

interface IndexYaml {
  skills?: RawSkillYaml[]
}

/**
 * Registry state
 */
interface RegistryState {
  skills: Map<string, SkillMeta>
  intentToSkill: Map<string, string>
  loaded: boolean
}

// Singleton registry state
const registry: RegistryState = {
  skills: new Map(),
  intentToSkill: new Map(),
  loaded: false,
}

/**
 * Get the path to skills/index.yml
 */
function getIndexPath(): string {
  // Try multiple possible locations
  const possiblePaths = [
    path.join(process.cwd(), "skills", "index.yml"),
    path.join(__dirname, "..", "..", "skills", "index.yml"),
    path.join(__dirname, "..", "..", "..", "skills", "index.yml"),
  ]

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p
    }
  }

  return possiblePaths[0] // Default to first option
}

/**
 * Convert raw YAML skill (snake_case) to SkillMeta (camelCase)
 */
function normalizeSkill(raw: RawSkillYaml): SkillMeta {
  return {
    id: raw.id,
    name: raw.name,
    path: raw.path,
    description: raw.description,
    category: raw.category,
    kind: raw.kind,
    exposure: raw.exposure,
    dispatchIntent: raw.dispatch_intent,
    dispatchEntry: raw.dispatch_entry,
    riskLevel: raw.risk_level,
    triggers: raw.triggers,
    inputs: raw.inputs,
    outputs: raw.outputs,
    dependsOn: raw.depends_on,
  }
}

/**
 * Load skill registry from index.yml
 *
 * Uses standard yaml library for robust parsing.
 * Performs validation:
 * - Detects duplicate dispatch_intent (throws error)
 * - Validates dispatch_intent against Intent type (logs warning)
 */
export function loadRegistry(): void {
  if (registry.loaded) {
    return
  }

  try {
    const indexPath = getIndexPath()
    const content = fs.readFileSync(indexPath, "utf-8")

    // Use standard YAML parser
    const data = parseYaml(content) as IndexYaml

    if (data.skills) {
      for (const rawSkill of data.skills) {
        const skill = normalizeSkill(rawSkill)
        registry.skills.set(skill.id, skill)

        // Map dispatch_intent to skill id with conflict detection
        if (skill.dispatchIntent) {
          // 1. Validate against Intent type
          if (!VALID_INTENTS.includes(skill.dispatchIntent as Intent)) {
            console.warn(
              `[skill-registry] Unknown dispatch_intent "${skill.dispatchIntent}" in skill "${skill.id}". ` +
              `Valid intents: ${VALID_INTENTS.join(", ")}`
            )
          }

          // 2. Detect duplicate dispatch_intent
          if (registry.intentToSkill.has(skill.dispatchIntent)) {
            const existingSkillId = registry.intentToSkill.get(skill.dispatchIntent)
            throw new Error(
              `Duplicate dispatch_intent "${skill.dispatchIntent}" in skills "${existingSkillId}" and "${skill.id}". ` +
              `Each intent must map to exactly one skill.`
            )
          }

          registry.intentToSkill.set(skill.dispatchIntent, skill.id)
        }
      }
    }

    registry.loaded = true
  } catch (err) {
    // If loading fails, registry remains empty
    // This allows the system to work with hardcoded fallbacks
    console.warn("Failed to load skill registry:", err)
  }
}

/**
 * Get skill metadata by ID
 */
export function getSkillMeta(skillId: string): SkillMeta | null {
  loadRegistry()
  return registry.skills.get(skillId) ?? null
}

/**
 * Get skill metadata by dispatch intent
 */
export function getSkillByIntent(intent: string): SkillMeta | null {
  loadRegistry()
  const skillId = registry.intentToSkill.get(intent)
  return skillId ? registry.skills.get(skillId) ?? null : null
}

/**
 * Get skill path by ID
 */
export function getSkillPath(skillId: string): string | null {
  const meta = getSkillMeta(skillId)
  if (meta && meta.path) {
    return `skills/${meta.path}`
  }
  return null
}

/**
 * Get skill category by ID
 */
export function getSkillCategory(skillId: string): string | null {
  const meta = getSkillMeta(skillId)
  if (meta) {
    return meta.category
  }
  return null
}

/**
 * Check if skill is a meta skill
 */
export function isMetaSkill(skillId: string): boolean {
  const meta = getSkillMeta(skillId)
  return meta?.kind === "meta"
}

/**
 * Check if skill is exposed to users
 */
export function isUserExposed(skillId: string): boolean {
  const meta = getSkillMeta(skillId)
  return meta?.exposure === "user"
}

/**
 * Check if skill can be called in given mode
 */
export function canCallSkill(skillId: string, internalMode: boolean): boolean {
  // User-exposed skills can always be called
  if (isUserExposed(skillId)) {
    return true
  }

  // Internal skills can only be called in internal mode
  return internalMode
}

/**
 * Get all skills with given exposure
 */
export function getSkillsByExposure(exposure: "user" | "internal"): SkillMeta[] {
  loadRegistry()
  const result: SkillMeta[] = []
  for (const skill of registry.skills.values()) {
    if (skill.exposure === exposure) {
      result.push(skill)
    }
  }
  return result
}

/**
 * Get all skills with given kind
 */
export function getSkillsByKind(kind: "atomic" | "meta"): SkillMeta[] {
  loadRegistry()
  const result: SkillMeta[] = []
  for (const skill of registry.skills.values()) {
    if (skill.kind === kind) {
      result.push(skill)
    }
  }
  return result
}

/**
 * Get all dispatch intents from registered skills
 *
 * Single source of truth for intent enum.
 * New skills with dispatch_intent in index.yml are automatically included.
 *
 * Returns deduplicated and sorted list.
 */
export function getIntentList(): string[] {
  loadRegistry()
  const intents = new Set<string>()

  // Collect all dispatch_intent from skills (Set handles deduplication)
  for (const skill of registry.skills.values()) {
    if (skill.dispatchIntent) {
      intents.add(skill.dispatchIntent)
    }
  }

  // Return sorted array for stable ordering
  return Array.from(intents).sort()
}

/**
 * Get all dispatch intents with their skill metadata
 *
 * Returns intent-skill mapping for reference.
 */
export function getIntentToSkillMap(): Map<string, SkillMeta> {
  loadRegistry()
  const result = new Map<string, SkillMeta>()
  for (const skill of registry.skills.values()) {
    if (skill.dispatchIntent) {
      result.set(skill.dispatchIntent, skill)
    }
  }
  return result
}