/**
 * Dispatcher Index Deep Tests
 *
 * Tests for dispatch() function, risk checks, operation lifecycle, and document loading.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import type { StateManager, Intent } from "../../src/core/state-manager.js"

// Create mock function references
const mockReadFile = vi.fn()

// Mocks
vi.mock("../../src/dispatcher/route-table.js", () => ({
  route: vi.fn(),
  getRiskLevel: vi.fn(),
}))

vi.mock("../../src/dispatcher/skill-registry.js", () => ({
  getIntentList: vi.fn(),
  getIntentToSkillMap: vi.fn(),
  getSkillMeta: vi.fn(),
  getSkillPath: vi.fn(),
}))

vi.mock("../../src/shared/trace.js", () => ({
  generateTraceId: vi.fn(() => "test-trace-123"),
  startSpan: vi.fn(() => ({ name: "test-span" })),
  finishSpan: vi.fn(),
}))

vi.mock("../../src/shared/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  })),
}))

vi.mock("../../src/shared/lark-ticket.js", () => ({
  getLarkTicket: vi.fn(() => null),
}))

vi.mock("fs", () => ({
  promises: {
    readFile: mockReadFile,
  },
}))

describe("dispatcher index", () => {
  let mockStateManager: StateManager

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    // Create mock StateManager
    mockStateManager = {
      getExecutionMode: vi.fn().mockResolvedValue("local"),
      startOperationIfNoConflict: vi.fn().mockResolvedValue({ started: true, operationId: "op_123" }),
      getOperation: vi.fn().mockResolvedValue(null),
      completeOperation: vi.fn().mockResolvedValue(undefined),
      getDefaultHost: vi.fn().mockResolvedValue(null),
      initialize: vi.fn().mockResolvedValue(undefined),
      isReady: vi.fn().mockReturnValue(true),
    } as any
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("dispatch", () => {
    describe("auto intent", () => {
      it("should reject auto intent with guidance", async () => {
        const { getIntentList, getIntentToSkillMap } = await import("../../src/dispatcher/skill-registry.js")
        vi.mocked(getIntentList).mockReturnValue([])
        vi.mocked(getIntentToSkillMap).mockReturnValue(new Map())

        const { getRiskLevel, route } = await import("../../src/dispatcher/route-table.js")
        vi.mocked(getRiskLevel).mockReturnValue("read_only")
        vi.mocked(route).mockReturnValue({ type: "error", params: {}, message: "Unknown" })

        const { dispatch } = await import("../../src/dispatcher/index.js")
        const result = await dispatch({ intent: "auto" as Intent }, mockStateManager)

        expect(result.success).toBe(false)
        expect(result.error).toBe("Could not determine intent. Please specify explicitly.")
        expect(result.guidance).toBe("")
      })
    })

    describe("risk check", () => {
      it("should block destructive intent without force", async () => {
        const { getIntentList, getIntentToSkillMap } = await import("../../src/dispatcher/skill-registry.js")
        vi.mocked(getIntentList).mockReturnValue(["deploy_env"])
        vi.mocked(getIntentToSkillMap).mockReturnValue(new Map())

        const { getRiskLevel, route } = await import("../../src/dispatcher/route-table.js")
        vi.mocked(getRiskLevel).mockReturnValue("destructive")
        vi.mocked(route).mockReturnValue({
          type: "skill",
          skillId: "deploy_musa_base_env",
          params: {},
          message: "Deploy env",
        })

        const { dispatch } = await import("../../src/dispatcher/index.js")
        const result = await dispatch(
          { intent: "deploy_env" as Intent, force: false },
          mockStateManager
        )

        expect(result.success).toBe(false)
        expect(result.error).toContain("destructive")
        expect(result.error).toContain("force=true")
      })

      it("should allow destructive intent with force=true", async () => {
        const { getIntentList, getIntentToSkillMap } = await import("../../src/dispatcher/skill-registry.js")
        vi.mocked(getIntentList).mockReturnValue(["deploy_env"])
        vi.mocked(getIntentToSkillMap).mockReturnValue(new Map())

        const { getRiskLevel, route } = await import("../../src/dispatcher/route-table.js")
        vi.mocked(getRiskLevel).mockReturnValue("destructive")
        vi.mocked(route).mockReturnValue({
          type: "skill",
          skillId: "deploy_musa_base_env",
          description: "Deploy environment",
          readPath: "/path/SKILL.md",
          params: {},
          message: "Deploy env",
        })

        const { dispatch } = await import("../../src/dispatcher/index.js")
        const result = await dispatch(
          { intent: "deploy_env" as Intent, force: true },
          mockStateManager
        )

        expect(result.success).toBe(true)
        expect(result.guidance).toContain("deploy_musa_base_env")
      })

      it("should allow read_only intent without force", async () => {
        const { getIntentList, getIntentToSkillMap } = await import("../../src/dispatcher/skill-registry.js")
        vi.mocked(getIntentList).mockReturnValue([])
        vi.mocked(getIntentToSkillMap).mockReturnValue(new Map())

        const { getRiskLevel, route } = await import("../../src/dispatcher/route-table.js")
        vi.mocked(getRiskLevel).mockReturnValue("read_only")
        vi.mocked(route).mockReturnValue({
          type: "tool",
          target: "musa_exec",
          params: { command: "mthreads-gmi" },
          message: "Execute via musa_exec",
        })

        const { dispatch } = await import("../../src/dispatcher/index.js")
        const result = await dispatch(
          { intent: "gpu_status" as Intent },
          mockStateManager
        )

        expect(result.success).toBe(true)
        expect(result.guidance).toContain("musa_exec")
      })

      it("should allow safe_write intent without force", async () => {
        const { getIntentList, getIntentToSkillMap } = await import("../../src/dispatcher/skill-registry.js")
        vi.mocked(getIntentList).mockReturnValue([])
        vi.mocked(getIntentToSkillMap).mockReturnValue(new Map())

        const { getRiskLevel, route } = await import("../../src/dispatcher/route-table.js")
        vi.mocked(getRiskLevel).mockReturnValue("safe_write")
        vi.mocked(route).mockReturnValue({
          type: "tool",
          target: "musa_sync",
          params: {},
          message: "Execute via musa_sync",
        })

        const { dispatch } = await import("../../src/dispatcher/index.js")
        const result = await dispatch(
          { intent: "sync" as Intent },
          mockStateManager
        )

        expect(result.success).toBe(true)
      })
    })

    describe("operation lifecycle", () => {
      it("should start operation for destructive intent", async () => {
        const { getIntentList, getIntentToSkillMap } = await import("../../src/dispatcher/skill-registry.js")
        vi.mocked(getIntentList).mockReturnValue(["deploy_env"])
        vi.mocked(getIntentToSkillMap).mockReturnValue(new Map())

        const { getRiskLevel, route } = await import("../../src/dispatcher/route-table.js")
        vi.mocked(getRiskLevel).mockReturnValue("destructive")
        vi.mocked(route).mockReturnValue({
          type: "orchestration",
          skillId: "deploy_musa_base_env",
          params: {},
          message: "Deploy",
          orchestration: { metaSkillId: "deploy_musa_base_env", steps: [] },
        })

        const { dispatch } = await import("../../src/dispatcher/index.js")
        const result = await dispatch(
          { intent: "deploy_env" as Intent, force: true },
          mockStateManager
        )

        expect(mockStateManager.startOperationIfNoConflict).toHaveBeenCalled()
        expect(result.operationId).toBe("op_123")
      })

      it("should not start operation for read_only intent", async () => {
        const { getIntentList, getIntentToSkillMap } = await import("../../src/dispatcher/skill-registry.js")
        vi.mocked(getIntentList).mockReturnValue([])
        vi.mocked(getIntentToSkillMap).mockReturnValue(new Map())

        const { getRiskLevel, route } = await import("../../src/dispatcher/route-table.js")
        vi.mocked(getRiskLevel).mockReturnValue("read_only")
        vi.mocked(route).mockReturnValue({
          type: "tool",
          target: "musa_exec",
          params: {},
          message: "GPU status",
        })

        const { dispatch } = await import("../../src/dispatcher/index.js")
        const result = await dispatch(
          { intent: "gpu_status" as Intent },
          mockStateManager
        )

        expect(mockStateManager.startOperationIfNoConflict).not.toHaveBeenCalled()
        expect(result.operationId).toBeNull()
      })

      it("should handle conflict detection", async () => {
        mockStateManager.startOperationIfNoConflict = vi.fn().mockResolvedValue({
          started: false,
          conflict: {
            id: "op_existing",
            intent: "deploy_env",
            execution: { status: "running" },
          },
        })

        const { getIntentList, getIntentToSkillMap } = await import("../../src/dispatcher/skill-registry.js")
        vi.mocked(getIntentList).mockReturnValue(["deploy_env"])
        vi.mocked(getIntentToSkillMap).mockReturnValue(new Map())

        const { getRiskLevel, route } = await import("../../src/dispatcher/route-table.js")
        vi.mocked(getRiskLevel).mockReturnValue("destructive")
        vi.mocked(route).mockReturnValue({
          type: "skill",
          skillId: "deploy_musa_base_env",
          params: {},
          message: "Deploy",
        })

        const { dispatch } = await import("../../src/dispatcher/index.js")
        const result = await dispatch(
          { intent: "deploy_env" as Intent, force: true },
          mockStateManager
        )

        expect(result.success).toBe(false)
        expect(result.error).toContain("Conflicting operation")
      })
    })

    describe("document handling", () => {
      it("should load document from path", async () => {
        const docContent = "# Deployment Guide\n\n1. Install driver\n2. Verify"
        mockReadFile.mockResolvedValueOnce(docContent)

        const { getIntentList, getIntentToSkillMap } = await import("../../src/dispatcher/skill-registry.js")
        vi.mocked(getIntentList).mockReturnValue([])
        vi.mocked(getIntentToSkillMap).mockReturnValue(new Map())

        const { getRiskLevel, route } = await import("../../src/dispatcher/route-table.js")
        vi.mocked(getRiskLevel).mockReturnValue("destructive")
        vi.mocked(route).mockReturnValue({
          type: "document",
          params: { path: "/docs/deploy.md" },
          message: "Execute document",
        })

        const { dispatch } = await import("../../src/dispatcher/index.js")
        const result = await dispatch(
          { intent: "execute_document" as Intent, context: { path: "/docs/deploy.md" }, force: true },
          mockStateManager
        )

        expect(result.success).toBe(true)
        expect(result.guidance).toContain("## Document Loaded")
        expect(result.guidance).toContain("**Source**: /docs/deploy.md")
        expect(result.guidance).toContain("Install driver")
      })

      it("should handle document from content parameter", async () => {
        const { getIntentList, getIntentToSkillMap } = await import("../../src/dispatcher/skill-registry.js")
        vi.mocked(getIntentList).mockReturnValue([])
        vi.mocked(getIntentToSkillMap).mockReturnValue(new Map())

        const { getRiskLevel, route } = await import("../../src/dispatcher/route-table.js")
        vi.mocked(getRiskLevel).mockReturnValue("destructive")
        vi.mocked(route).mockReturnValue({
          type: "document",
          params: { content: "Step 1: Run command" },
          message: "Execute document",
        })

        const { dispatch } = await import("../../src/dispatcher/index.js")
        const result = await dispatch(
          { intent: "execute_document" as Intent, context: { content: "Step 1: Run command" }, force: true },
          mockStateManager
        )

        expect(result.success).toBe(true)
        expect(result.guidance).toContain("pasted content")
        expect(result.guidance).toContain("Step 1: Run command")
      })

      it("should return error for missing path and content", async () => {
        const { getIntentList, getIntentToSkillMap } = await import("../../src/dispatcher/skill-registry.js")
        vi.mocked(getIntentList).mockReturnValue([])
        vi.mocked(getIntentToSkillMap).mockReturnValue(new Map())

        const { getRiskLevel, route } = await import("../../src/dispatcher/route-table.js")
        vi.mocked(getRiskLevel).mockReturnValue("destructive")
        vi.mocked(route).mockReturnValue({
          type: "document",
          params: {}, // No path or content
          message: "Execute document",
        })

        const { dispatch } = await import("../../src/dispatcher/index.js")
        const result = await dispatch(
          { intent: "execute_document" as Intent, context: {}, force: true },
          mockStateManager
        )

        expect(result.success).toBe(false)
        expect(result.guidance).toContain("Error: Provide path or content")
      })

      it("should handle file read error", async () => {
        mockReadFile.mockRejectedValueOnce(new Error("ENOENT"))

        const { getIntentList, getIntentToSkillMap } = await import("../../src/dispatcher/skill-registry.js")
        vi.mocked(getIntentList).mockReturnValue([])
        vi.mocked(getIntentToSkillMap).mockReturnValue(new Map())

        const { getRiskLevel, route } = await import("../../src/dispatcher/route-table.js")
        vi.mocked(getRiskLevel).mockReturnValue("destructive")
        vi.mocked(route).mockReturnValue({
          type: "document",
          params: { path: "/nonexistent.md" },
          message: "Execute document",
        })

        const { dispatch } = await import("../../src/dispatcher/index.js")
        const result = await dispatch(
          { intent: "execute_document" as Intent, context: { path: "/nonexistent.md" }, force: true },
          mockStateManager
        )

        expect(result.success).toBe(false)
        expect(result.guidance).toContain("Failed to read document")
      })
    })

    describe("error routing", () => {
      it("should handle error route result", async () => {
        const { getIntentList, getIntentToSkillMap } = await import("../../src/dispatcher/skill-registry.js")
        vi.mocked(getIntentList).mockReturnValue([])
        vi.mocked(getIntentToSkillMap).mockReturnValue(new Map())

        const { getRiskLevel, route } = await import("../../src/dispatcher/route-table.js")
        vi.mocked(getRiskLevel).mockReturnValue("read_only")
        vi.mocked(route).mockReturnValue({
          type: "error",
          params: {},
          message: "Unknown intent: bad_intent",
        })

        const { dispatch } = await import("../../src/dispatcher/index.js")
        const result = await dispatch(
          { intent: "bad_intent" as Intent },
          mockStateManager
        )

        expect(result.success).toBe(false)
        expect(result.error).toBe("Unknown intent: bad_intent")
      })
    })

    describe("guidance formatting", () => {
      it("should format skill route guidance", async () => {
        const { getIntentList, getIntentToSkillMap } = await import("../../src/dispatcher/skill-registry.js")
        vi.mocked(getIntentList).mockReturnValue([])
        vi.mocked(getIntentToSkillMap).mockReturnValue(new Map())

        const { getRiskLevel, route } = await import("../../src/dispatcher/route-table.js")
        vi.mocked(getRiskLevel).mockReturnValue("safe_write")
        vi.mocked(route).mockReturnValue({
          type: "skill",
          skillId: "prepare_model_artifacts",
          description: "Download and verify model files",
          readPath: "/path/skills/assets/model/SKILL.md",
          params: { MODEL_NAME: "llama-7b" },
          message: "Prepare model",
        })

        const { dispatch } = await import("../../src/dispatcher/index.js")
        const result = await dispatch(
          { intent: "prepare_model" as Intent, context: { MODEL_NAME: "llama-7b" } },
          mockStateManager
        )

        expect(result.success).toBe(true)
        expect(result.guidance).toContain("## Dispatch: prepare_model")
        expect(result.guidance).toContain("**Type**: skill")
        expect(result.guidance).toContain("**Skill**: prepare_model_artifacts")
        expect(result.guidance).toContain("**Description**: Download and verify model files")
        expect(result.guidance).toContain("**Skill file**")
        expect(result.guidance).toContain("**Params**")
        expect(result.guidance).toContain("MODEL_NAME")
      })

      it("should format orchestration route guidance", async () => {
        const { getIntentList, getIntentToSkillMap } = await import("../../src/dispatcher/skill-registry.js")
        vi.mocked(getIntentList).mockReturnValue([])
        vi.mocked(getIntentToSkillMap).mockReturnValue(new Map())

        const { getRiskLevel, route } = await import("../../src/dispatcher/route-table.js")
        vi.mocked(getRiskLevel).mockReturnValue("destructive")
        vi.mocked(route).mockReturnValue({
          type: "orchestration",
          skillId: "deploy_musa_base_env",
          description: "Complete MUSA deployment",
          params: {},
          message: "Orchestration steps",
          orchestration: {
            metaSkillId: "deploy_musa_base_env",
            steps: [
              { skillId: "ensure_system_dependencies", description: "Install deps" },
              { skillId: "ensure_musa_driver", description: "Install driver" },
              { skillId: "validate", description: "Validate env" },
            ],
          },
        })

        const { dispatch } = await import("../../src/dispatcher/index.js")
        const result = await dispatch(
          { intent: "deploy_env" as Intent, force: true },
          mockStateManager
        )

        expect(result.guidance).toContain("**Steps**:")
        expect(result.guidance).toContain("1. ensure_system_dependencies — Install deps")
        expect(result.guidance).toContain("2. ensure_musa_driver — Install driver")
        expect(result.guidance).toContain("3. validate — Validate env")
      })

      it("should format tool route guidance", async () => {
        const { getIntentList, getIntentToSkillMap } = await import("../../src/dispatcher/skill-registry.js")
        vi.mocked(getIntentList).mockReturnValue([])
        vi.mocked(getIntentToSkillMap).mockReturnValue(new Map())

        const { getRiskLevel, route } = await import("../../src/dispatcher/route-table.js")
        vi.mocked(getRiskLevel).mockReturnValue("read_only")
        vi.mocked(route).mockReturnValue({
          type: "tool",
          target: "musa_exec",
          params: { command: "mthreads-gmi" },
          message: "Execute via musa_exec",
        })

        const { dispatch } = await import("../../src/dispatcher/index.js")
        const result = await dispatch(
          { intent: "gpu_status" as Intent },
          mockStateManager
        )

        expect(result.guidance).toContain("**Tool**: musa_exec")
        expect(result.guidance).toContain("Execute via musa_exec")
      })

      it("should format direct route guidance", async () => {
        const { getIntentList, getIntentToSkillMap } = await import("../../src/dispatcher/skill-registry.js")
        vi.mocked(getIntentList).mockReturnValue([])
        vi.mocked(getIntentToSkillMap).mockReturnValue(new Map())

        const { getRiskLevel, route } = await import("../../src/dispatcher/route-table.js")
        vi.mocked(getRiskLevel).mockReturnValue("read_only")
        vi.mocked(route).mockReturnValue({
          type: "direct",
          params: {},
          message: "Run validation: 1) mthreads-gmi 2) docker run",
        })

        const { dispatch } = await import("../../src/dispatcher/index.js")
        const result = await dispatch(
          { intent: "validate" as Intent },
          mockStateManager
        )

        expect(result.guidance).toContain("Run validation:")
      })
    })

    describe("tracing", () => {
      it("should use lark ticket messageId as traceId when available", async () => {
        const { getLarkTicket } = await import("../../src/shared/lark-ticket.js")
        vi.mocked(getLarkTicket).mockReturnValue({
          messageId: "msg-lark-456",
          chatId: "chat-123",
        } as any)

        const { getIntentList, getIntentToSkillMap } = await import("../../src/dispatcher/skill-registry.js")
        vi.mocked(getIntentList).mockReturnValue([])
        vi.mocked(getIntentToSkillMap).mockReturnValue(new Map())

        const { getRiskLevel, route } = await import("../../src/dispatcher/route-table.js")
        vi.mocked(getRiskLevel).mockReturnValue("read_only")
        vi.mocked(route).mockReturnValue({
          type: "tool",
          target: "musa_exec",
          params: {},
          message: "Test",
        })

        const { startSpan, finishSpan } = await import("../../src/shared/trace.js")

        const { dispatch } = await import("../../src/dispatcher/index.js")
        await dispatch({ intent: "gpu_status" as Intent }, mockStateManager)

        expect(startSpan).toHaveBeenCalledWith("dispatch", { intent: "gpu_status" })
        expect(finishSpan).toHaveBeenCalled()
      })

      it("should generate traceId when no lark ticket", async () => {
        const { getLarkTicket } = await import("../../src/shared/lark-ticket.js")
        vi.mocked(getLarkTicket).mockReturnValue(null)

        const { getIntentList, getIntentToSkillMap } = await import("../../src/dispatcher/skill-registry.js")
        vi.mocked(getIntentList).mockReturnValue([])
        vi.mocked(getIntentToSkillMap).mockReturnValue(new Map())

        const { getRiskLevel, route } = await import("../../src/dispatcher/route-table.js")
        vi.mocked(getRiskLevel).mockReturnValue("read_only")
        vi.mocked(route).mockReturnValue({
          type: "tool",
          target: "musa_exec",
          params: {},
          message: "Test",
        })

        const { generateTraceId, startSpan } = await import("../../src/shared/trace.js")

        const { dispatch } = await import("../../src/dispatcher/index.js")
        await dispatch({ intent: "gpu_status" as Intent }, mockStateManager)

        expect(generateTraceId).toHaveBeenCalled()
      })
    })
  })

  describe("registerDispatcherTool", () => {
    it("should register musa_dispatch tool with correct schema", async () => {
      const mockApi = {
        registerTool: vi.fn(),
      }

      const { getIntentList, getIntentToSkillMap } = await import("../../src/dispatcher/skill-registry.js")
      vi.mocked(getIntentList).mockReturnValue(["deploy_env", "update_driver"])
      vi.mocked(getIntentToSkillMap).mockReturnValue(new Map([
        ["deploy_env", { id: "deploy_musa_base_env", description: "Deploy MUSA env" } as any],
        ["update_driver", { id: "update_musa_driver", description: "Update driver" } as any],
      ]))

      const { registerDispatcherTool } = await import("../../src/dispatcher/index.js")
      registerDispatcherTool(mockApi as any, mockStateManager)

      expect(mockApi.registerTool).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "musa_dispatch",
          description: expect.stringContaining("Task orchestrator"),
          parameters: expect.objectContaining({
            type: "object",
            properties: expect.objectContaining({
              intent: expect.objectContaining({
                type: "string",
                enum: expect.arrayContaining(["deploy_env", "update_driver", "auto"]),
              }),
              action: expect.objectContaining({
                enum: ["start", "status", "resume", "cancel"],
              }),
              force: expect.objectContaining({
                type: "boolean",
              }),
            }),
          }),
        })
      )
    })

    it("should build description from skill registry", async () => {
      const mockApi = {
        registerTool: vi.fn(),
      }

      const { getIntentList, getIntentToSkillMap } = await import("../../src/dispatcher/skill-registry.js")
      vi.mocked(getIntentList).mockReturnValue(["prepare_model", "prepare_dataset"])
      vi.mocked(getIntentToSkillMap).mockReturnValue(new Map([
        ["prepare_model", { id: "prepare_model_artifacts", description: "Download and verify model files" } as any],
        ["prepare_dataset", { id: "prepare_dataset_artifacts", description: "Download and verify dataset files" } as any],
      ]))

      const { registerDispatcherTool } = await import("../../src/dispatcher/index.js")
      registerDispatcherTool(mockApi as any, mockStateManager)

      const toolDef = mockApi.registerTool.mock.calls[0][0]
      expect(toolDef.description).toContain("prepare_model: Download and verify model files")
      expect(toolDef.description).toContain("prepare_dataset: Download and verify dataset files")
    })

    it("should include non-skill intents in enum", async () => {
      const mockApi = {
        registerTool: vi.fn(),
      }

      const { getIntentList, getIntentToSkillMap } = await import("../../src/dispatcher/skill-registry.js")
      vi.mocked(getIntentList).mockReturnValue(["deploy_env"])
      vi.mocked(getIntentToSkillMap).mockReturnValue(new Map())

      const { registerDispatcherTool } = await import("../../src/dispatcher/index.js")
      registerDispatcherTool(mockApi as any, mockStateManager)

      const toolDef = mockApi.registerTool.mock.calls[0][0]
      const intentEnum = toolDef.parameters.properties.intent.enum

      // Should include skill intents + non-skill intents + auto
      expect(intentEnum).toContain("deploy_env")
      expect(intentEnum).toContain("gpu_status")
      expect(intentEnum).toContain("validate")
      expect(intentEnum).toContain("sync")
      expect(intentEnum).toContain("execute_document")
      expect(intentEnum).toContain("auto")
    })

    it("should execute dispatch on tool call", async () => {
      const mockApi = {
        registerTool: vi.fn(),
      }

      const { getIntentList, getIntentToSkillMap } = await import("../../src/dispatcher/skill-registry.js")
      vi.mocked(getIntentList).mockReturnValue([])
      vi.mocked(getIntentToSkillMap).mockReturnValue(new Map())

      const { getRiskLevel, route } = await import("../../src/dispatcher/route-table.js")
      vi.mocked(getRiskLevel).mockReturnValue("read_only")
      vi.mocked(route).mockReturnValue({
        type: "tool",
        target: "musa_exec",
        params: {},
        message: "Test",
      })

      const { registerDispatcherTool } = await import("../../src/dispatcher/index.js")
      registerDispatcherTool(mockApi as any, mockStateManager)

      const toolDef = mockApi.registerTool.mock.calls[0][0]

      // Simulate tool execution
      const result = await toolDef.execute("tool-call-123", { intent: "gpu_status" })
      expect(result).toBeDefined()
    })
  })

  describe("re-exports", () => {
    it("should re-export route functions", async () => {
      const exports = await import("../../src/dispatcher/index.js")

      expect(exports.route).toBeDefined()
      expect(exports.getRiskLevel).toBeDefined()
      expect(exports.getSkillMeta).toBeDefined()
      expect(exports.getSkillPath).toBeDefined()
      expect(exports.getIntentList).toBeDefined()
      expect(exports.getIntentToSkillMap).toBeDefined()
    })
  })
})