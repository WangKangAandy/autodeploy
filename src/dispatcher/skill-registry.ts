/**
 * Skill Registry
 *
 * Loads and caches skill metadata from skills/index.yml.
 * Provides single source of truth for skill path, category, kind, exposure.
 */

import * as fs from "fs"
import * as path from "path"

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
 * Parsed index.yml structure
 */
interface IndexYaml {
  skills?: SkillMeta[]
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
 * Load skill registry from index.yml
 */
export function loadRegistry(): void {
  if (registry.loaded) {
    return
  }

  try {
    const indexPath = getIndexPath()
    const content = fs.readFileSync(indexPath, "utf-8")
    // Simple YAML parsing for index.yml structure
    // We only need to extract skill entries, so a minimal parser works
    const data = parseSimpleYaml(content) as IndexYaml

    if (data.skills) {
      for (const skill of data.skills) {
        registry.skills.set(skill.id, skill)

        // Map dispatch_intent to skill id
        if (skill.dispatchIntent) {
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
 * Simple YAML parser for index.yml
 * Only handles the subset of YAML we need
 */
function parseSimpleYaml(content: string): IndexYaml {
  const result: IndexYaml = { skills: [] }
  const lines = content.split("\n")

  let currentSkill: Partial<SkillMeta> | null = null
  let inSkillsArray = false
  let currentIndent = 0

  for (const line of lines) {
    // Skip comments and empty lines
    if (line.trim().startsWith("#") || line.trim() === "") continue

    // Check for skills: array start
    if (line.trim() === "skills:") {
      inSkillsArray = true
      continue
    }

    // Stop parsing skills when we hit references: or configs:
    if (line.trim() === "references:" || line.trim() === "configs:") {
      inSkillsArray = false
      // Save last skill before exiting skills section
      if (currentSkill && currentSkill.id) {
        result.skills!.push(currentSkill as SkillMeta)
        currentSkill = null
      }
      continue
    }

    if (!inSkillsArray) continue

    // Check for new skill entry (starts with "- id:")
    if (line.match(/^\s*-\s+id:\s*(.+)$/)) {
      // Save previous skill
      if (currentSkill && currentSkill.id) {
        result.skills!.push(currentSkill as SkillMeta)
      }
      currentSkill = { id: line.match(/^\s*-\s+id:\s*(.+)$/)?.[1]?.trim() }
      currentIndent = line.search(/\S/)
      continue
    }

    // Parse skill properties
    if (currentSkill) {
      const match = line.match(/^(\s*)(\w+):\s*(.*)$/)
      if (match) {
        const [, indent, key, value] = match
        // Skip if this line is not a property of current skill (less indent than skill entry)
        if (indent.length <= currentIndent) continue

        if (key && value !== undefined) {
          // Convert snake_case to camelCase for known fields
          const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())

          // Handle different value types
          if (value.startsWith("[")) {
            // Array value (simplified)
            (currentSkill as Record<string, unknown>)[camelKey] = value
              .replace(/^\[|\]$/g, "")
              .split(",")
              .map(s => s.trim().replace(/^['"]|['"]$/g, ""))
          } else if (value === "true" || value === "false") {
            (currentSkill as Record<string, unknown>)[camelKey] = value === "true"
          } else {
            (currentSkill as Record<string, unknown>)[camelKey] = value.replace(/^['"]|['"]$/g, "")
          }
        }
      }
    }
  }

  // Save last skill (if not already saved)
  if (currentSkill && currentSkill.id) {
    result.skills!.push(currentSkill as SkillMeta)
  }

  return result
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