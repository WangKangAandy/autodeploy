/**
 * Router Tests
 */

import { describe, it, expect } from "vitest"
import { routeToHandler, type RouterContext, type RouteResult } from "../../src/dispatcher/router"

// Mock state manager
const mockStateManager = {
  loadSnapshot: async () => ({ hosts: [], roles: {}, lastUpdated: new Date().toISOString() }),
  getOperation: async () => null,
  startOperation: async () => "op-123",
  startOperationIfNoConflict: async () => ({ started: true, operationId: "op-123" }),
  completeOperation: async () => {},
  addCheckpoint: async () => {},
} as any

describe("routeToHandler", () => {
  describe("deploy_env intent", () => {
    it("should return orchestration type for deploy_env", async () => {
      const ctx: RouterContext = {
        intent: "deploy_env",
        context: {},
        action: "start",
        stateManager: mockStateManager,
      }

      const result = await routeToHandler(ctx)

      expect(result.type).toBe("orchestration")
      expect(result.target).toContain("deploy_musa_base_env")
      expect(result.orchestration).toBeDefined()
      expect(result.orchestration?.steps).toHaveLength(5)
    })

    it("should return direct type for status action", async () => {
      const ctx: RouterContext = {
        intent: "deploy_env",
        context: {},
        action: "status",
        stateManager: mockStateManager,
      }

      const result = await routeToHandler(ctx)

      expect(result.type).toBe("direct")
      expect(result.target).toBe("check_deployment_status")
    })
  })

  describe("update_driver intent", () => {
    it("should return orchestration type for update_driver", async () => {
      const ctx: RouterContext = {
        intent: "update_driver",
        context: {},
        action: "start",
        stateManager: mockStateManager,
      }

      const result = await routeToHandler(ctx)

      expect(result.type).toBe("orchestration")
      expect(result.target).toContain("update_musa_driver")
      expect(result.orchestration).toBeDefined()
      expect(result.orchestration?.steps).toHaveLength(1)
    })
  })

  describe("gpu_status intent", () => {
    it("should return tool type for gpu_status", async () => {
      const ctx: RouterContext = {
        intent: "gpu_status",
        context: {},
        action: "start",
        stateManager: mockStateManager,
      }

      const result = await routeToHandler(ctx)

      expect(result.type).toBe("tool")
      expect(result.target).toBe("musa_exec")
      expect(result.params.command).toBe("mthreads-gmi")
    })
  })

  describe("run_container intent", () => {
    it("should return tool type for run_container", async () => {
      const ctx: RouterContext = {
        intent: "run_container",
        context: { image: "test:latest", command: "bash" },
        action: "start",
        stateManager: mockStateManager,
      }

      const result = await routeToHandler(ctx)

      expect(result.type).toBe("tool")
      expect(result.target).toBe("musa_docker")
    })
  })

  describe("validate intent", () => {
    it("should return direct type for validate", async () => {
      const ctx: RouterContext = {
        intent: "validate",
        context: {},
        action: "start",
        stateManager: mockStateManager,
      }

      const result = await routeToHandler(ctx)

      expect(result.type).toBe("direct")
      expect(result.target).toBe("validation_sequence")
      expect(result.message).toContain("mthreads-gmi")
    })
  })

  describe("sync intent", () => {
    it("should return tool type for sync", async () => {
      const ctx: RouterContext = {
        intent: "sync",
        context: {},
        action: "start",
        stateManager: mockStateManager,
      }

      const result = await routeToHandler(ctx)

      expect(result.type).toBe("tool")
      expect(result.target).toBe("musa_sync")
    })
  })

  describe("execute_document intent", () => {
    it("should return direct type for execute_document", async () => {
      const ctx: RouterContext = {
        intent: "execute_document",
        context: {},
        action: "start",
        stateManager: mockStateManager,
      }

      const result = await routeToHandler(ctx)

      expect(result.type).toBe("direct")
      expect(result.target).toBe("document_executor")
    })
  })

  describe("skill ID routing", () => {
    it("should return error for internal skill in user mode", async () => {
      const ctx: RouterContext = {
        intent: "ensure_system_dependencies",
        context: {},
        action: "start",
        stateManager: mockStateManager,
      }

      const result = await routeToHandler(ctx)

      // Internal skills should be rejected in user mode
      expect(result.type).toBe("error")
      expect(result.message).toContain("internal")
    })

    it("should route to orchestration for meta skill ID (user-exposed)", async () => {
      const ctx: RouterContext = {
        intent: "deploy_musa_base_env",
        context: {},
        action: "start",
        stateManager: mockStateManager,
      }

      const result = await routeToHandler(ctx)

      expect(result.type).toBe("orchestration")
      expect(result.orchestration?.steps).toHaveLength(5)
    })
  })

  describe("internal mode", () => {
    it("should route skill by ID in internal mode", async () => {
      const ctx: RouterContext = {
        intent: "ensure_musa_driver",
        context: { MT_GPU_DRIVER_VERSION: "3.3.5-server" },
        action: "start",
        stateManager: mockStateManager,
        internalMode: true,
      }

      const result = await routeToHandler(ctx)

      expect(result.type).toBe("skill")
      expect(result.target).toContain("ensure_musa_driver")
    })

    it("should allow internal skills in internal mode", async () => {
      const ctx: RouterContext = {
        intent: "ensure_system_dependencies",
        context: {},
        action: "start",
        stateManager: mockStateManager,
        internalMode: true,
      }

      const result = await routeToHandler(ctx)

      expect(result.type).toBe("skill")
      expect(result.target).toContain("ensure_system_dependencies")
    })
  })

  describe("exposure boundaries", () => {
    it("should include skillMeta in route result", async () => {
      const ctx: RouterContext = {
        intent: "deploy_musa_base_env",
        context: {},
        action: "start",
        stateManager: mockStateManager,
      }

      const result = await routeToHandler(ctx)

      expect(result.skillMeta).toBeDefined()
      expect(result.skillMeta?.kind).toBe("meta")
      expect(result.skillMeta?.exposure).toBe("user")
    })
  })

  describe("error cases", () => {
    it("should return error for auto intent without query", async () => {
      const ctx: RouterContext = {
        intent: "auto",
        context: {},
        action: "start",
        stateManager: mockStateManager,
      }

      const result = await routeToHandler(ctx)

      expect(result.type).toBe("error")
      expect(result.message).toContain("Could not determine intent")
    })

    it("should return error for unknown intent", async () => {
      const ctx: RouterContext = {
        intent: "unknown_intent" as any,
        context: {},
        action: "start",
        stateManager: mockStateManager,
      }

      const result = await routeToHandler(ctx)

      expect(result.type).toBe("error")
    })
  })
})

describe("Route paths", () => {
  it("should use new directory structure for deploy_env", async () => {
    const ctx: RouterContext = {
      intent: "deploy_env",
      context: {},
      action: "start",
      stateManager: mockStateManager,
    }

    const result = await routeToHandler(ctx)

    expect(result.target).toContain("env/deploy_musa_base_env")
  })

  it("should use new directory structure for update_driver", async () => {
    const ctx: RouterContext = {
      intent: "update_driver",
      context: {},
      action: "start",
      stateManager: mockStateManager,
    }

    const result = await routeToHandler(ctx)

    expect(result.target).toContain("env/update_musa_driver")
  })
})

describe("assets intent routing", () => {
  describe("prepare_model intent", () => {
    it("should return skill type for prepare_model", async () => {
      const ctx: RouterContext = {
        intent: "prepare_model",
        context: { MODEL_NAME: "Qwen/Qwen2-7B" },
        action: "start",
        stateManager: mockStateManager,
      }

      const result = await routeToHandler(ctx)

      expect(result.type).toBe("skill")
      expect(result.target).toContain("prepare_model_artifacts")
      expect(result.skillMeta).toBeDefined()
      expect(result.skillMeta?.exposure).toBe("user")
    })

    it("should include risk level in message", async () => {
      const ctx: RouterContext = {
        intent: "prepare_model",
        context: { MODEL_NAME: "test-model" },
        action: "start",
        stateManager: mockStateManager,
      }

      const result = await routeToHandler(ctx)

      expect(result.message).toContain("Risk:")
      expect(result.message).toContain("Exposure:")
    })
  })

  describe("prepare_dataset intent", () => {
    it("should return skill type for prepare_dataset", async () => {
      const ctx: RouterContext = {
        intent: "prepare_dataset",
        context: { DATASET_NAME: "alpaca" },
        action: "start",
        stateManager: mockStateManager,
      }

      const result = await routeToHandler(ctx)

      expect(result.type).toBe("skill")
      expect(result.target).toContain("prepare_dataset_artifacts")
    })
  })

  describe("prepare_package intent", () => {
    it("should return skill type for prepare_package", async () => {
      const ctx: RouterContext = {
        intent: "prepare_package",
        context: { PACKAGE_TYPE: "driver", VERSION: "3.3.5" },
        action: "start",
        stateManager: mockStateManager,
      }

      const result = await routeToHandler(ctx)

      expect(result.type).toBe("skill")
      expect(result.target).toContain("prepare_musa_package")
    })
  })

  describe("manage_images intent", () => {
    it("should return skill type for manage_images", async () => {
      const ctx: RouterContext = {
        intent: "manage_images",
        context: { action: "pull", image: "test:latest" },
        action: "start",
        stateManager: mockStateManager,
      }

      const result = await routeToHandler(ctx)

      expect(result.type).toBe("skill")
      expect(result.target).toContain("manage_container_images")
    })
  })

  describe("prepare_repo intent", () => {
    it("should return skill type for prepare_repo", async () => {
      const ctx: RouterContext = {
        intent: "prepare_repo",
        context: { REPO_URL: "https://github.com/test/repo.git" },
        action: "start",
        stateManager: mockStateManager,
      }

      const result = await routeToHandler(ctx)

      expect(result.type).toBe("skill")
      expect(result.target).toContain("prepare_dependency_repo")
    })
  })

  describe("buildSkillMessage from metadata", () => {
    it("should generate message with description and risk/exposure", async () => {
      const ctx: RouterContext = {
        intent: "prepare_model",
        context: {},
        action: "start",
        stateManager: mockStateManager,
      }

      const result = await routeToHandler(ctx)

      // Should contain description from index.yml
      expect(result.message).toContain("model")
      // Should contain risk/exposure
      expect(result.message).toMatch(/Risk:.*Exposure:/)
      expect(result.message).toContain("idempotent")
      expect(result.message).toContain("user")
    })
  })
})