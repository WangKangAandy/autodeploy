/**
 * Skill Registry Unit Tests
 *
 * Tests for skill-registry.ts covering:
 * - YAML loading and normalization
 * - Error handling (missing file, parse error, duplicate intent)
 * - Skill metadata queries
 * - Intent mapping
 * - Access control (exposure, kind)
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  resetRegistry,
  loadRegistryFromData,
  getSkillMeta,
  getSkillByIntent,
  getSkillPath,
  getSkillCategory,
  isMetaSkill,
  isUserExposed,
  canCallSkill,
  getSkillsByExposure,
  getSkillsByKind,
  getIntentList,
  getIntentToSkillMap,
} from "../../src/dispatcher/skill-registry.js"

// Helper to create valid skill data
function createSkill(overrides: Partial<{
  id: string
  name: string
  path: string
  description: string
  category: "env" | "assets" | "workload" | "benchmark" | "migration"
  kind: "atomic" | "meta"
  exposure: "user" | "internal"
  risk_level: "safe" | "destructive" | "idempotent"
  dispatch_intent?: string
  depends_on?: string[]
}> = {}) {
  return {
    id: "test_skill",
    name: "Test Skill",
    path: "test/SKILL.md",
    description: "A test skill",
    category: "env" as const,
    kind: "atomic" as const,
    exposure: "user" as const,
    risk_level: "safe" as const,
    ...overrides,
  }
}

describe("skill-registry", () => {
  // Reset registry before each test for isolation
  beforeEach(() => {
    resetRegistry()
    vi.clearAllMocks()
  })

  describe("loadRegistryFromData", () => {
    it("should load skills from valid data", () => {
      loadRegistryFromData({
        skills: [
          createSkill({ id: "skill_a", dispatch_intent: "deploy_env" }),
          createSkill({ id: "skill_b", category: "assets" }),
        ],
      })

      expect(getSkillMeta("skill_a")).not.toBeNull()
      expect(getSkillMeta("skill_b")).not.toBeNull()
    })

    it("should handle empty skills array", () => {
      loadRegistryFromData({ skills: [] })

      expect(getIntentList()).toEqual([])
      expect(getSkillMeta("any")).toBeNull()
    })

    it("should handle missing skills field", () => {
      loadRegistryFromData({})

      expect(getIntentList()).toEqual([])
    })

    it("should throw for duplicate dispatch_intent", () => {
      expect(() =>
        loadRegistryFromData({
          skills: [
            createSkill({ id: "skill_a", dispatch_intent: "duplicate_intent" }),
            createSkill({ id: "skill_b", dispatch_intent: "duplicate_intent" }),
          ],
        })
      ).toThrow(/Duplicate dispatch_intent.*skill_a.*skill_b/)
    })

    it("should warn for unknown dispatch_intent values", () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

      loadRegistryFromData({
        skills: [createSkill({ dispatch_intent: "unknown_intent_type" })],
      })

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Unknown dispatch_intent")
      )

      consoleSpy.mockRestore()
    })

    it("should normalize snake_case fields to camelCase", () => {
      loadRegistryFromData({
        skills: [
          {
            id: "norm_skill",
            name: "Normalize Skill",
            path: "norm/SKILL.md",
            description: "Test normalization",
            category: "env",
            kind: "meta",
            exposure: "user",
            risk_level: "destructive", // snake_case
            dispatch_intent: "deploy_env", // snake_case
            depends_on: ["dep_a", "dep_b"], // snake_case
          },
        ],
      })

      const skill = getSkillMeta("norm_skill")
      expect(skill?.riskLevel).toBe("destructive") // normalized
      expect(skill?.dispatchIntent).toBe("deploy_env") // normalized
      expect(skill?.dependsOn).toEqual(["dep_a", "dep_b"]) // normalized
    })

    it("should allow same intent after reset", () => {
      loadRegistryFromData({
        skills: [createSkill({ id: "skill_a", dispatch_intent: "deploy_env" })],
      })

      resetRegistry()

      // Should not throw - registry was reset
      expect(() =>
        loadRegistryFromData({
          skills: [createSkill({ id: "skill_b", dispatch_intent: "deploy_env" })],
        })
      ).not.toThrow()
    })
  })

  describe("getSkillMeta", () => {
    it("should return null for non-existent skill", () => {
      loadRegistryFromData({ skills: [createSkill()] })
      expect(getSkillMeta("nonexistent_skill")).toBeNull()
    })

    it("should return skill metadata for existing skill", () => {
      loadRegistryFromData({
        skills: [
          createSkill({
            id: "existing",
            name: "Existing Skill",
            description: "An existing skill",
            category: "assets",
          }),
        ],
      })

      const skill = getSkillMeta("existing")
      expect(skill).not.toBeNull()
      expect(skill?.name).toBe("Existing Skill")
      expect(skill?.category).toBe("assets")
      expect(skill?.description).toBe("An existing skill")
    })
  })

  describe("getSkillByIntent", () => {
    it("should return null for unmapped intent", () => {
      loadRegistryFromData({ skills: [createSkill()] })
      expect(getSkillByIntent("unknown_intent")).toBeNull()
    })

    it("should return skill for mapped intent", () => {
      loadRegistryFromData({
        skills: [createSkill({ id: "intent_skill", dispatch_intent: "prepare_model" })],
      })

      const skill = getSkillByIntent("prepare_model")
      expect(skill).not.toBeNull()
      expect(skill?.id).toBe("intent_skill")
    })

    it("should return same skill from getSkillMeta and getSkillByIntent", () => {
      loadRegistryFromData({
        skills: [createSkill({ id: "sync_skill", dispatch_intent: "sync" })],
      })

      const byId = getSkillMeta("sync_skill")
      const byIntent = getSkillByIntent("sync")

      expect(byId).toBe(byIntent)
    })
  })

  describe("getSkillPath", () => {
    it("should return null for unknown skill", () => {
      loadRegistryFromData({ skills: [] })
      expect(getSkillPath("unknown")).toBeNull()
    })

    it("should return absolute path for known skill", () => {
      loadRegistryFromData({
        skills: [createSkill({ id: "path_skill", path: "env/deploy/SKILL.md" })],
      })

      const skillPath = getSkillPath("path_skill")
      expect(skillPath).not.toBeNull()
      expect(skillPath).toContain("skills")
      expect(skillPath).toContain("env/deploy/SKILL.md")
    })
  })

  describe("getSkillCategory", () => {
    it("should return correct category", () => {
      loadRegistryFromData({
        skills: [
          createSkill({ id: "env_skill", category: "env" }),
          createSkill({ id: "assets_skill", category: "assets" }),
          createSkill({ id: "workload_skill", category: "workload" }),
        ],
      })

      expect(getSkillCategory("env_skill")).toBe("env")
      expect(getSkillCategory("assets_skill")).toBe("assets")
      expect(getSkillCategory("workload_skill")).toBe("workload")
    })

    it("should return null for unknown skill", () => {
      expect(getSkillCategory("unknown")).toBeNull()
    })
  })

  describe("isMetaSkill", () => {
    it("should return true for meta skill", () => {
      loadRegistryFromData({
        skills: [createSkill({ id: "meta_skill", kind: "meta" })],
      })
      expect(isMetaSkill("meta_skill")).toBe(true)
    })

    it("should return false for atomic skill", () => {
      loadRegistryFromData({
        skills: [createSkill({ id: "atomic_skill", kind: "atomic" })],
      })
      expect(isMetaSkill("atomic_skill")).toBe(false)
    })

    it("should return false for unknown skill", () => {
      expect(isMetaSkill("unknown")).toBe(false)
    })
  })

  describe("isUserExposed", () => {
    it("should return true for user-exposed skill", () => {
      loadRegistryFromData({
        skills: [createSkill({ id: "user_skill", exposure: "user" })],
      })
      expect(isUserExposed("user_skill")).toBe(true)
    })

    it("should return false for internal skill", () => {
      loadRegistryFromData({
        skills: [createSkill({ id: "internal_skill", exposure: "internal" })],
      })
      expect(isUserExposed("internal_skill")).toBe(false)
    })

    it("should return false for unknown skill", () => {
      expect(isUserExposed("unknown")).toBe(false)
    })
  })

  describe("canCallSkill", () => {
    it("should allow user skill in any mode", () => {
      loadRegistryFromData({
        skills: [createSkill({ id: "user_skill", exposure: "user" })],
      })

      expect(canCallSkill("user_skill", false)).toBe(true)
      expect(canCallSkill("user_skill", true)).toBe(true)
    })

    it("should restrict internal skill to internal mode only", () => {
      loadRegistryFromData({
        skills: [createSkill({ id: "internal_skill", exposure: "internal" })],
      })

      expect(canCallSkill("internal_skill", false)).toBe(false)
      expect(canCallSkill("internal_skill", true)).toBe(true)
    })

    it("should deny unknown skill in user mode", () => {
      // Unknown skills have undefined exposure, isUserExposed returns false
      expect(canCallSkill("unknown", false)).toBe(false)
      expect(canCallSkill("unknown", true)).toBe(true)
    })
  })

  describe("getSkillsByExposure", () => {
    it("should filter skills by exposure level", () => {
      loadRegistryFromData({
        skills: [
          createSkill({ id: "user_a", exposure: "user" }),
          createSkill({ id: "internal_b", exposure: "internal" }),
          createSkill({ id: "user_c", exposure: "user" }),
        ],
      })

      const userSkills = getSkillsByExposure("user")
      const internalSkills = getSkillsByExposure("internal")

      expect(userSkills.length).toBe(2)
      expect(internalSkills.length).toBe(1)
      expect(userSkills.map((s) => s.id)).toEqual(["user_a", "user_c"])
      expect(internalSkills[0].id).toBe("internal_b")
    })
  })

  describe("getSkillsByKind", () => {
    it("should filter skills by kind", () => {
      loadRegistryFromData({
        skills: [
          createSkill({ id: "atomic_1", kind: "atomic" }),
          createSkill({ id: "meta_1", kind: "meta" }),
          createSkill({ id: "atomic_2", kind: "atomic" }),
        ],
      })

      const atomicSkills = getSkillsByKind("atomic")
      const metaSkills = getSkillsByKind("meta")

      expect(atomicSkills.length).toBe(2)
      expect(metaSkills.length).toBe(1)
      expect(metaSkills[0].id).toBe("meta_1")
    })
  })

  describe("getIntentList", () => {
    it("should return sorted unique intents from skills", () => {
      loadRegistryFromData({
        skills: [
          createSkill({ dispatch_intent: "intent_z" }),
          createSkill({ id: "skill_b", dispatch_intent: "intent_a" }),
          createSkill({ id: "skill_c", dispatch_intent: "intent_m" }),
          createSkill({ id: "skill_no_intent" }), // No dispatch_intent
        ],
      })

      const intents = getIntentList()

      // Should be sorted
      expect(intents).toEqual(["intent_a", "intent_m", "intent_z"])
    })

    it("should return empty array when no intents defined", () => {
      loadRegistryFromData({
        skills: [
          createSkill({ id: "no_intent_1" }),
          createSkill({ id: "no_intent_2" }),
        ],
      })

      expect(getIntentList()).toEqual([])
    })
  })

  describe("getIntentToSkillMap", () => {
    it("should return intent-to-skill mapping", () => {
      loadRegistryFromData({
        skills: [
          createSkill({ id: "env_skill", dispatch_intent: "deploy_env" }),
          createSkill({ id: "driver_skill", dispatch_intent: "update_driver" }),
        ],
      })

      const map = getIntentToSkillMap()

      expect(map.size).toBe(2)
      expect(map.get("deploy_env")?.id).toBe("env_skill")
      expect(map.get("update_driver")?.id).toBe("driver_skill")
    })

    it("should return empty map when no intents defined", () => {
      loadRegistryFromData({
        skills: [createSkill({ id: "no_intent" })],
      })

      expect(getIntentToSkillMap().size).toBe(0)
    })
  })

  describe("lazy loading", () => {
    it("should auto-load on first query", () => {
      // Don't call loadRegistryFromData - use reset state
      resetRegistry()

      // First query triggers load (from real file)
      getSkillMeta("any")

      // Second query should not re-load (singleton)
      // We can't easily verify this without more invasive testing
      // But the behavior is implicit - no crash, returns data
    })
  })
})

/**
 * Integration tests with real skills/index.yml
 * These tests validate the actual data file
 */
describe("skill-registry integration (real index.yml)", () => {
  beforeEach(() => {
    resetRegistry()
  })

  it("should load real skills/index.yml successfully", () => {
    // This will load from the real file
    const skill = getSkillMeta("deploy_musa_base_env")
    expect(skill).not.toBeNull()
    expect(skill?.kind).toBe("meta")
    expect(skill?.exposure).toBe("user")
  })

  it("should have valid dependency references in real data", () => {
    const deploy = getSkillMeta("deploy_musa_base_env")
    expect(deploy?.dependsOn).toBeDefined()
    expect(deploy?.dependsOn?.length).toBeGreaterThan(0)

    for (const depId of deploy?.dependsOn || []) {
      const dep = getSkillMeta(depId)
      expect(dep).not.toBeNull(`Dependency ${depId} should exist`)
    }
  })

  it("should have all required intents mapped", () => {
    const intents = getIntentList()

    const expectedIntents = [
      "deploy_env",
      "update_driver",
      "prepare_model",
      "prepare_dataset",
      "prepare_package",
      "prepare_repo",
    ]

    for (const intent of expectedIntents) {
      expect(intents).toContain(intent)
    }
  })
})