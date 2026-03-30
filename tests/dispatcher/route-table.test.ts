/**
 * Route Table Deep Tests
 *
 * Tests for intent routing, risk level determination, and orchestration building.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import * as fs from "fs"
import {
  route,
  getRiskLevel,
  type RouteResult,
  type OrchestrationInfo,
} from "../../src/dispatcher/route-table.js"
import type { Intent } from "../../src/core/state-manager.js"

// Mock skill-registry
vi.mock("../../src/dispatcher/skill-registry.js", () => ({
  loadRegistry: vi.fn(),
  getIntentToSkillMap: vi.fn(),
  getSkillMeta: vi.fn(),
  getSkillPath: vi.fn(),
  isMetaSkill: vi.fn(),
}))

describe("route-table", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  describe("getRiskLevel", () => {
    it("should return read_only for gpu_status", async () => {
      const { getSkillMeta, getIntentToSkillMap, loadRegistry } = await import("../../src/dispatcher/skill-registry.js")
      vi.mocked(loadRegistry).mockImplementation(() => {})
      vi.mocked(getIntentToSkillMap).mockReturnValue(new Map())
      vi.mocked(getSkillMeta).mockReturnValue(null)

      const { getRiskLevel } = await import("../../src/dispatcher/route-table.js")
      expect(getRiskLevel("gpu_status")).toBe("read_only")
    })

    it("should return read_only for validate", async () => {
      const { getSkillMeta, getIntentToSkillMap, loadRegistry } = await import("../../src/dispatcher/skill-registry.js")
      vi.mocked(loadRegistry).mockImplementation(() => {})
      vi.mocked(getIntentToSkillMap).mockReturnValue(new Map())
      vi.mocked(getSkillMeta).mockReturnValue(null)

      const { getRiskLevel } = await import("../../src/dispatcher/route-table.js")
      expect(getRiskLevel("validate")).toBe("read_only")
    })

    it("should return safe_write for sync", async () => {
      const { getSkillMeta, getIntentToSkillMap, loadRegistry } = await import("../../src/dispatcher/skill-registry.js")
      vi.mocked(loadRegistry).mockImplementation(() => {})
      vi.mocked(getIntentToSkillMap).mockReturnValue(new Map())
      vi.mocked(getSkillMeta).mockReturnValue(null)

      const { getRiskLevel } = await import("../../src/dispatcher/route-table.js")
      expect(getRiskLevel("sync")).toBe("safe_write")
    })

    it("should return safe_write for run_container", async () => {
      const { getSkillMeta, getIntentToSkillMap, loadRegistry } = await import("../../src/dispatcher/skill-registry.js")
      vi.mocked(loadRegistry).mockImplementation(() => {})
      vi.mocked(getIntentToSkillMap).mockReturnValue(new Map())
      vi.mocked(getSkillMeta).mockReturnValue(null)

      const { getRiskLevel } = await import("../../src/dispatcher/route-table.js")
      expect(getRiskLevel("run_container")).toBe("safe_write")
    })

    it("should return destructive for execute_document", async () => {
      const { getSkillMeta, getIntentToSkillMap, loadRegistry } = await import("../../src/dispatcher/skill-registry.js")
      vi.mocked(loadRegistry).mockImplementation(() => {})
      vi.mocked(getIntentToSkillMap).mockReturnValue(new Map())
      vi.mocked(getSkillMeta).mockReturnValue(null)

      const { getRiskLevel } = await import("../../src/dispatcher/route-table.js")
      expect(getRiskLevel("execute_document")).toBe("destructive")
    })

    it("should derive risk from skill registry when available", async () => {
      const skillMeta = {
        id: "deploy_env",
        name: "Deploy Env",
        path: "env/deploy/SKILL.md",
        description: "Deploy environment",
        category: "env",
        kind: "meta",
        exposure: "user",
        riskLevel: "destructive",
      }

      const { getSkillMeta, getIntentToSkillMap, loadRegistry } = await import("../../src/dispatcher/skill-registry.js")
      vi.mocked(loadRegistry).mockImplementation(() => {})
      vi.mocked(getIntentToSkillMap).mockReturnValue(new Map([["deploy_env", skillMeta as any]]))
      vi.mocked(getSkillMeta).mockReturnValue(skillMeta as any)

      const { getRiskLevel } = await import("../../src/dispatcher/route-table.js")
      expect(getRiskLevel("deploy_env")).toBe("destructive")
    })

    it("should map safe skill risk_level to read_only", async () => {
      const skillMeta = {
        id: "validate_skill",
        name: "Validate",
        path: "validate/SKILL.md",
        description: "Validation skill",
        category: "env",
        kind: "atomic",
        exposure: "internal",
        riskLevel: "safe", // YAML risk_level: safe → read_only
      }

      const { getSkillMeta, getIntentToSkillMap, loadRegistry } = await import("../../src/dispatcher/skill-registry.js")
      vi.mocked(loadRegistry).mockImplementation(() => {})
      vi.mocked(getIntentToSkillMap).mockReturnValue(new Map([["validate_env", skillMeta as any]]))
      vi.mocked(getSkillMeta).mockReturnValue(skillMeta as any)

      const { getRiskLevel } = await import("../../src/dispatcher/route-table.js")
      expect(getRiskLevel("validate_env")).toBe("read_only")
    })

    it("should map idempotent skill risk_level to safe_write", async () => {
      const skillMeta = {
        id: "prepare_model",
        name: "Prepare Model",
        path: "prepare/SKILL.md",
        description: "Prepare model artifacts",
        category: "assets",
        kind: "atomic",
        exposure: "user",
        riskLevel: "idempotent", // YAML risk_level: idempotent → safe_write
      }

      const { getSkillMeta, getIntentToSkillMap, loadRegistry } = await import("../../src/dispatcher/skill-registry.js")
      vi.mocked(loadRegistry).mockImplementation(() => {})
      vi.mocked(getIntentToSkillMap).mockReturnValue(new Map([["prepare_model", skillMeta as any]]))
      vi.mocked(getSkillMeta).mockReturnValue(skillMeta as any)

      const { getRiskLevel } = await import("../../src/dispatcher/route-table.js")
      expect(getRiskLevel("prepare_model")).toBe("safe_write")
    })

    it("should default to safe_write for unknown intents", async () => {
      const { getSkillMeta, getIntentToSkillMap, loadRegistry } = await import("../../src/dispatcher/skill-registry.js")
      vi.mocked(loadRegistry).mockImplementation(() => {})
      vi.mocked(getIntentToSkillMap).mockReturnValue(new Map())
      vi.mocked(getSkillMeta).mockReturnValue(null)

      const { getRiskLevel } = await import("../../src/dispatcher/route-table.js")
      expect(getRiskLevel("unknown_intent")).toBe("safe_write")
    })
  })

  describe("route", () => {
    describe("document route", () => {
      it("should route execute_document to document type", async () => {
        const { getSkillMeta, getIntentToSkillMap, loadRegistry } = await import("../../src/dispatcher/skill-registry.js")
        vi.mocked(loadRegistry).mockImplementation(() => {})
        vi.mocked(getIntentToSkillMap).mockReturnValue(new Map())
        vi.mocked(getSkillMeta).mockReturnValue(null)

        const { route } = await import("../../src/dispatcher/route-table.js")
        const result = route("execute_document", { path: "/test/doc.md" })

        expect(result.type).toBe("document")
        expect(result.message).toBe("Execute deployment from document.")
        expect(result.params).toEqual({ path: "/test/doc.md" })
      })

      it("should handle document with content parameter", async () => {
        const { getSkillMeta, getIntentToSkillMap, loadRegistry } = await import("../../src/dispatcher/skill-registry.js")
        vi.mocked(loadRegistry).mockImplementation(() => {})
        vi.mocked(getIntentToSkillMap).mockReturnValue(new Map())
        vi.mocked(getSkillMeta).mockReturnValue(null)

        const { route } = await import("../../src/dispatcher/route-table.js")
        const result = route("execute_document", { content: "# Deployment Steps\n1. Step one" })

        expect(result.type).toBe("document")
        expect(result.params.content).toBe("# Deployment Steps\n1. Step one")
      })
    })

    describe("tool routes", () => {
      it("should route gpu_status to musa_exec tool", async () => {
        const { getSkillMeta, getIntentToSkillMap, loadRegistry } = await import("../../src/dispatcher/skill-registry.js")
        vi.mocked(loadRegistry).mockImplementation(() => {})
        vi.mocked(getIntentToSkillMap).mockReturnValue(new Map())
        vi.mocked(getSkillMeta).mockReturnValue(null)

        const { route } = await import("../../src/dispatcher/route-table.js")
        const result = route("gpu_status", {})

        expect(result.type).toBe("tool")
        expect(result.target).toBe("musa_exec")
        expect(result.params).toEqual({ command: "mthreads-gmi" })
        expect(result.message).toBe("Execute via musa_exec")
      })

      it("should route sync to musa_sync tool", async () => {
        const { getSkillMeta, getIntentToSkillMap, loadRegistry } = await import("../../src/dispatcher/skill-registry.js")
        vi.mocked(loadRegistry).mockImplementation(() => {})
        vi.mocked(getIntentToSkillMap).mockReturnValue(new Map())
        vi.mocked(getSkillMeta).mockReturnValue(null)

        const { route } = await import("../../src/dispatcher/route-table.js")
        const result = route("sync", { localPath: "/local", remotePath: "/remote", direction: "upload" })

        expect(result.type).toBe("tool")
        expect(result.target).toBe("musa_sync")
        expect(result.params.localPath).toBe("/local")
        expect(result.params.direction).toBe("upload")
      })

      it("should route run_container to musa_docker tool", async () => {
        const { getSkillMeta, getIntentToSkillMap, loadRegistry } = await import("../../src/dispatcher/skill-registry.js")
        vi.mocked(loadRegistry).mockImplementation(() => {})
        vi.mocked(getIntentToSkillMap).mockReturnValue(new Map())
        vi.mocked(getSkillMeta).mockReturnValue(null)

        const { route } = await import("../../src/dispatcher/route-table.js")
        const result = route("run_container", { image: "test:latest", name: "container1" })

        expect(result.type).toBe("tool")
        expect(result.target).toBe("musa_docker")
        expect(result.params.image).toBe("test:latest")
        expect(result.params.name).toBe("container1")
      })

      it("should merge context with defaultParams for tool routes", async () => {
        const { getSkillMeta, getIntentToSkillMap, loadRegistry } = await import("../../src/dispatcher/skill-registry.js")
        vi.mocked(loadRegistry).mockImplementation(() => {})
        vi.mocked(getIntentToSkillMap).mockReturnValue(new Map())
        vi.mocked(getSkillMeta).mockReturnValue(null)

        const { route } = await import("../../src/dispatcher/route-table.js")
        const result = route("gpu_status", { extraParam: "value" })

        expect(result.params.command).toBe("mthreads-gmi") // defaultParam
        expect(result.params.extraParam).toBe("value") // from context
      })
    })

    describe("direct routes", () => {
      it("should route validate to direct type with instructions", async () => {
        const { getSkillMeta, getIntentToSkillMap, loadRegistry } = await import("../../src/dispatcher/skill-registry.js")
        vi.mocked(loadRegistry).mockImplementation(() => {})
        vi.mocked(getIntentToSkillMap).mockReturnValue(new Map())
        vi.mocked(getSkillMeta).mockReturnValue(null)

        const { route } = await import("../../src/dispatcher/route-table.js")
        const result = route("validate", {})

        expect(result.type).toBe("direct")
        expect(result.message).toContain("mthreads-gmi")
        expect(result.message).toContain("docker run")
        expect(result.message).toContain("torch.musa.is_available")
      })
    })

    describe("skill routes", () => {
      it("should route skill intent to skill type", async () => {
        const skillMeta = {
          id: "prepare_model",
          name: "Prepare Model",
          path: "assets/prepare_model/SKILL.md",
          description: "Prepare model artifacts",
          category: "assets",
          kind: "atomic",
          exposure: "user",
          riskLevel: "idempotent",
          dispatchIntent: "prepare_model",
        }

        const { getSkillMeta, getIntentToSkillMap, loadRegistry, getSkillPath } = await import("../../src/dispatcher/skill-registry.js")
        vi.mocked(loadRegistry).mockImplementation(() => {})
        vi.mocked(getIntentToSkillMap).mockReturnValue(new Map([["prepare_model", skillMeta as any]]))
        vi.mocked(getSkillMeta).mockReturnValue(skillMeta as any)
        vi.mocked(getSkillPath).mockReturnValue("/abs/path/skills/assets/prepare_model/SKILL.md")

        const { route } = await import("../../src/dispatcher/route-table.js")
        const result = route("prepare_model", { MODEL_NAME: "llama-7b" })

        expect(result.type).toBe("skill")
        expect(result.skillId).toBe("prepare_model")
        expect(result.description).toBe("Prepare model artifacts")
        expect(result.readPath).toBe("/abs/path/skills/assets/prepare_model/SKILL.md")
        expect(result.params.MODEL_NAME).toBe("llama-7b")
      })

      it("should route unknown intent to error", async () => {
        const { getSkillMeta, getIntentToSkillMap, loadRegistry, getSkillPath } = await import("../../src/dispatcher/skill-registry.js")
        vi.mocked(loadRegistry).mockImplementation(() => {})
        vi.mocked(getIntentToSkillMap).mockReturnValue(new Map())
        vi.mocked(getSkillMeta).mockReturnValue(null)
        vi.mocked(getSkillPath).mockReturnValue(null)

        const { route } = await import("../../src/dispatcher/route-table.js")
        const result = route("completely_unknown", {})

        expect(result.type).toBe("error")
        expect(result.message).toBe("Unknown intent: completely_unknown")
      })
    })

    describe("orchestration routes", () => {
      it("should route meta skill to orchestration type with steps", async () => {
        const metaSkill = {
          id: "deploy_musa_base_env",
          name: "Deploy Base Env",
          path: "env/deploy/SKILL.md",
          description: "Complete MUSA deployment",
          category: "env",
          kind: "meta",
          exposure: "user",
          riskLevel: "destructive",
          dispatchIntent: "deploy_env",
          dependsOn: [
            "ensure_system_dependencies",
            "ensure_musa_driver",
            "validate_musa_container_environment",
          ],
        }

        const atomicSkill1 = {
          id: "ensure_system_dependencies",
          name: "System Deps",
          path: "env/system/SKILL.md",
          description: "Ensure system dependencies",
          category: "env",
          kind: "atomic",
          exposure: "internal",
          riskLevel: "destructive",
        }

        const atomicSkill2 = {
          id: "ensure_musa_driver",
          name: "MUSA Driver",
          path: "env/driver/SKILL.md",
          description: "Ensure MUSA driver",
          category: "env",
          kind: "atomic",
          exposure: "internal",
          riskLevel: "destructive",
        }

        const atomicSkill3 = {
          id: "validate_musa_container_environment",
          name: "Validate",
          path: "env/validate/SKILL.md",
          description: "Validate container",
          category: "env",
          kind: "atomic",
          exposure: "internal",
          riskLevel: "safe",
        }

        const { getSkillMeta, getIntentToSkillMap, loadRegistry, getSkillPath, isMetaSkill } = await import("../../src/dispatcher/skill-registry.js")
        vi.mocked(loadRegistry).mockImplementation(() => {})
        vi.mocked(getIntentToSkillMap).mockReturnValue(new Map([["deploy_env", metaSkill as any]]))
        vi.mocked(getSkillMeta)
          .mockImplementation((id: string) => {
            if (id === "deploy_musa_base_env") return metaSkill as any
            if (id === "ensure_system_dependencies") return atomicSkill1 as any
            if (id === "ensure_musa_driver") return atomicSkill2 as any
            if (id === "validate_musa_container_environment") return atomicSkill3 as any
            return null
          })
        vi.mocked(getSkillPath).mockReturnValue("/path/skills/env/deploy/SKILL.md")
        vi.mocked(isMetaSkill).mockImplementation((id: string) => id === "deploy_musa_base_env")

        const { route } = await import("../../src/dispatcher/route-table.js")
        const result = route("deploy_env", { MUSA_SDK_VERSION: "4.3.5" })

        expect(result.type).toBe("orchestration")
        expect(result.skillId).toBe("deploy_musa_base_env")
        expect(result.orchestration).not.toBeNull()
        expect(result.orchestration?.steps.length).toBe(3)
        expect(result.orchestration?.steps[0].skillId).toBe("ensure_system_dependencies")
        expect(result.orchestration?.steps[1].skillId).toBe("ensure_musa_driver")
        expect(result.orchestration?.steps[2].skillId).toBe("validate_musa_container_environment")
        expect(result.orchestration?.steps[0].description).toBe("Ensure system dependencies")
      })

      it("should handle meta skill without dependsOn", async () => {
        const metaSkillNoDeps = {
          id: "empty_meta",
          name: "Empty Meta",
          path: "meta/empty/SKILL.md",
          description: "Meta skill with no deps",
          category: "env",
          kind: "meta",
          exposure: "user",
          riskLevel: "safe",
          dispatchIntent: "empty_meta_intent",
          dependsOn: [], // Empty
        }

        const { getSkillMeta, getIntentToSkillMap, loadRegistry, getSkillPath, isMetaSkill } = await import("../../src/dispatcher/skill-registry.js")
        vi.mocked(loadRegistry).mockImplementation(() => {})
        vi.mocked(getIntentToSkillMap).mockReturnValue(new Map([["empty_meta_intent", metaSkillNoDeps as any]]))
        vi.mocked(getSkillMeta).mockReturnValue(metaSkillNoDeps as any)
        vi.mocked(getSkillPath).mockReturnValue("/path/skills/meta/empty/SKILL.md")
        vi.mocked(isMetaSkill).mockReturnValue(true)

        const { route } = await import("../../src/dispatcher/route-table.js")
        const result = route("empty_meta_intent", {})

        expect(result.type).toBe("orchestration")
        expect(result.orchestration).toBeNull() // No steps
        expect(result.message).toBe("Execute meta skill: empty_meta")
      })
    })

    describe("direct skill ID routing", () => {
      it("should accept direct skill ID as intent", async () => {
        const skillMeta = {
          id: "prepare_dataset",
          name: "Prepare Dataset",
          path: "assets/dataset/SKILL.md",
          description: "Prepare dataset",
          category: "assets",
          kind: "atomic",
          exposure: "user",
          riskLevel: "idempotent",
        }

        const { getSkillMeta, getIntentToSkillMap, loadRegistry, getSkillPath, isMetaSkill } = await import("../../src/dispatcher/skill-registry.js")
        vi.mocked(loadRegistry).mockImplementation(() => {})
        vi.mocked(getIntentToSkillMap).mockReturnValue(new Map()) // Not mapped by intent
        vi.mocked(getSkillMeta).mockReturnValue(skillMeta as any)
        vi.mocked(getSkillPath).mockReturnValue("/abs/path/skills/assets/dataset/SKILL.md")
        vi.mocked(isMetaSkill).mockReturnValue(false)

        const { route } = await import("../../src/dispatcher/route-table.js")
        // Use skill ID directly instead of dispatch_intent
        const result = route("prepare_dataset", { DATASET_NAME: "imagenet" })

        expect(result.type).toBe("skill")
        expect(result.skillId).toBe("prepare_dataset")
        expect(result.readPath).toBe("/abs/path/skills/assets/dataset/SKILL.md")
      })

      it("should route direct meta skill ID to orchestration", async () => {
        const metaSkill = {
          id: "update_musa_driver",
          name: "Update Driver",
          path: "env/update/SKILL.md",
          description: "Update driver",
          category: "env",
          kind: "meta",
          exposure: "user",
          riskLevel: "destructive",
          dependsOn: ["ensure_musa_driver"],
        }

        const atomicSkill = {
          id: "ensure_musa_driver",
          name: "Driver",
          path: "env/driver/SKILL.md",
          description: "Ensure driver",
          category: "env",
          kind: "atomic",
          exposure: "internal",
          riskLevel: "destructive",
        }

        const { getSkillMeta, getIntentToSkillMap, loadRegistry, getSkillPath, isMetaSkill } = await import("../../src/dispatcher/skill-registry.js")
        vi.mocked(loadRegistry).mockImplementation(() => {})
        vi.mocked(getIntentToSkillMap).mockReturnValue(new Map())
        vi.mocked(getSkillMeta)
          .mockImplementation((id: string) => {
            if (id === "update_musa_driver") return metaSkill as any
            if (id === "ensure_musa_driver") return atomicSkill as any
            return null
          })
        vi.mocked(getSkillPath).mockReturnValue("/path/skills/env/update/SKILL.md")
        vi.mocked(isMetaSkill).mockImplementation((id: string) => id === "update_musa_driver")

        const { route } = await import("../../src/dispatcher/route-table.js")
        const result = route("update_musa_driver", {})

        expect(result.type).toBe("orchestration")
        expect(result.skillId).toBe("update_musa_driver")
        expect(result.orchestration?.steps.length).toBe(1)
      })
    })
  })
})