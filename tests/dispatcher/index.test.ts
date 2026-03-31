/**
 * Dispatcher Tests
 *
 * Tests for the simplified dispatcher (operation lifecycle manager).
 *
 * The dispatcher handles:
 * - Operation lifecycle (start/status/resume/cancel)
 * - Destructive operation confirmation (force=true)
 * - Conflict detection (concurrent operations on same host)
 * - Document execution contract building
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import type { StateManager, Intent } from "../../src/core/state-manager.js"

// Mock modules
const mockReadFile = vi.fn()

vi.mock("fs", () => ({
  promises: {
    readFile: mockReadFile,
  },
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

describe("dispatcher", () => {
  let mockStateManager: StateManager

  beforeEach(() => {
    vi.clearAllMocks()

    mockStateManager = {
      getExecutionMode: vi.fn().mockResolvedValue("local"),
      startOperationIfNoConflict: vi.fn().mockResolvedValue({ started: true, operationId: "op_123" }),
      getOperation: vi.fn().mockResolvedValue(null),
      completeOperation: vi.fn().mockResolvedValue(undefined),
      resumeOperation: vi.fn().mockResolvedValue(true),
      getDefaultHost: vi.fn().mockResolvedValue(null),
      initialize: vi.fn().mockResolvedValue(undefined),
      isReady: vi.fn().mockReturnValue(true),
    } as any
  })

  describe("dispatch", () => {
    describe("destructive intent confirmation", () => {
      it("should block destructive intent without force", async () => {
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
        const { dispatch } = await import("../../src/dispatcher/index.js")

        const result = await dispatch(
          { intent: "deploy_env" as Intent, force: true },
          mockStateManager
        )

        expect(result.success).toBe(true)
      })

      it("should block update_driver without force", async () => {
        const { dispatch } = await import("../../src/dispatcher/index.js")

        const result = await dispatch(
          { intent: "update_driver" as Intent },
          mockStateManager
        )

        expect(result.success).toBe(false)
        expect(result.error).toContain("force=true")
      })

      it("should block execute_document without force", async () => {
        const { dispatch } = await import("../../src/dispatcher/index.js")

        const result = await dispatch(
          { intent: "execute_document" as Intent, context: { content: "test" } },
          mockStateManager
        )

        expect(result.success).toBe(false)
        expect(result.error).toContain("force=true")
      })

      it("should allow non-destructive intent without force", async () => {
        const { dispatch } = await import("../../src/dispatcher/index.js")

        const result = await dispatch(
          { intent: "gpu_status" as Intent },
          mockStateManager
        )

        expect(result.success).toBe(true)
      })
    })

    describe("conflict detection", () => {
      it("should start operation for destructive intent", async () => {
        const { dispatch } = await import("../../src/dispatcher/index.js")

        await dispatch(
          { intent: "deploy_env" as Intent, force: true },
          mockStateManager
        )

        expect(mockStateManager.startOperationIfNoConflict).toHaveBeenCalled()
      })

      it("should fail on conflicting operation", async () => {
        mockStateManager.startOperationIfNoConflict = vi.fn().mockResolvedValue({
          started: false,
          conflict: { id: "op_existing", intent: "deploy_env" },
        })

        const { dispatch } = await import("../../src/dispatcher/index.js")

        const result = await dispatch(
          { intent: "deploy_env" as Intent, force: true },
          mockStateManager
        )

        expect(result.success).toBe(false)
        expect(result.error).toContain("Conflicting operation")
      })

      it("should not start operation for non-destructive intent", async () => {
        const { dispatch } = await import("../../src/dispatcher/index.js")

        await dispatch(
          { intent: "gpu_status" as Intent },
          mockStateManager
        )

        expect(mockStateManager.startOperationIfNoConflict).not.toHaveBeenCalled()
      })
    })

    describe("lifecycle actions", () => {
      describe("status", () => {
        it("should require operationId", async () => {
          const { dispatch } = await import("../../src/dispatcher/index.js")

          const result = await dispatch(
            { intent: "deploy_env" as Intent, action: "status" },
            mockStateManager
          )

          expect(result.success).toBe(false)
          expect(result.error).toContain("operationId required")
        })

        it("should return operation status", async () => {
          mockStateManager.getOperation = vi.fn().mockResolvedValue({
            id: "op_123",
            intent: "deploy_env",
            execution: { status: "running" },
          })

          const { dispatch } = await import("../../src/dispatcher/index.js")

          const result = await dispatch(
            { intent: "deploy_env" as Intent, action: "status", context: { operationId: "op_123" } },
            mockStateManager
          )

          expect(result.success).toBe(true)
          expect(result.guidance).toContain("op_123")
          expect(result.guidance).toContain("running")
        })

        it("should fail for non-existent operation", async () => {
          mockStateManager.getOperation = vi.fn().mockResolvedValue(null)

          const { dispatch } = await import("../../src/dispatcher/index.js")

          const result = await dispatch(
            { intent: "deploy_env" as Intent, action: "status", context: { operationId: "op_nonexistent" } },
            mockStateManager
          )

          expect(result.success).toBe(false)
          expect(result.error).toContain("not found")
        })
      })

      describe("resume", () => {
        it("should require operationId", async () => {
          const { dispatch } = await import("../../src/dispatcher/index.js")

          const result = await dispatch(
            { intent: "deploy_env" as Intent, action: "resume" },
            mockStateManager
          )

          expect(result.success).toBe(false)
          expect(result.error).toContain("operationId required")
        })

        it("should resume operation", async () => {
          mockStateManager.resumeOperation = vi.fn().mockResolvedValue(true)

          const { dispatch } = await import("../../src/dispatcher/index.js")

          const result = await dispatch(
            { intent: "deploy_env" as Intent, action: "resume", context: { operationId: "op_123" } },
            mockStateManager
          )

          expect(result.success).toBe(true)
          expect(result.guidance).toContain("resumed")
        })

        it("should fail if cannot resume", async () => {
          mockStateManager.resumeOperation = vi.fn().mockResolvedValue(false)

          const { dispatch } = await import("../../src/dispatcher/index.js")

          const result = await dispatch(
            { intent: "deploy_env" as Intent, action: "resume", context: { operationId: "op_123" } },
            mockStateManager
          )

          expect(result.success).toBe(false)
          expect(result.error).toContain("Cannot resume")
        })
      })

      describe("cancel", () => {
        it("should require operationId", async () => {
          const { dispatch } = await import("../../src/dispatcher/index.js")

          const result = await dispatch(
            { intent: "deploy_env" as Intent, action: "cancel" },
            mockStateManager
          )

          expect(result.success).toBe(false)
          expect(result.error).toContain("operationId required")
        })

        it("should cancel operation", async () => {
          const { dispatch } = await import("../../src/dispatcher/index.js")

          const result = await dispatch(
            { intent: "deploy_env" as Intent, action: "cancel", context: { operationId: "op_123" } },
            mockStateManager
          )

          expect(result.success).toBe(true)
          expect(result.guidance).toContain("cancelled")
          expect(mockStateManager.completeOperation).toHaveBeenCalledWith(
            "op_123",
            expect.objectContaining({ success: false })
          )
        })
      })

      it("should fail for unknown action", async () => {
        const { dispatch } = await import("../../src/dispatcher/index.js")

        const result = await dispatch(
          { intent: "deploy_env" as Intent, action: "unknown" as any },
          mockStateManager
        )

        expect(result.success).toBe(false)
        expect(result.error).toContain("Unknown action")
      })
    })
  })

  describe("document guidance", () => {
    it("should load document from path", async () => {
      const docContent = "# Deployment Guide\n\n1. Install driver\n2. Verify"
      mockReadFile.mockResolvedValueOnce(docContent)

      const { dispatch } = await import("../../src/dispatcher/index.js")

      const result = await dispatch(
        { intent: "execute_document" as Intent, context: { path: "/docs/deploy.md" }, force: true },
        mockStateManager
      )

      expect(result.success).toBe(true)
      expect(result.guidance).toContain("Execution Contract")
      expect(result.guidance).toContain("/docs/deploy.md")
      expect(result.guidance).toContain("Install driver")
    })

    it("should handle document from content parameter", async () => {
      const { dispatch } = await import("../../src/dispatcher/index.js")

      const result = await dispatch(
        { intent: "execute_document" as Intent, context: { content: "Step 1: Run command" }, force: true },
        mockStateManager
      )

      expect(result.success).toBe(true)
      expect(result.guidance).toContain("pasted content")
      expect(result.guidance).toContain("Step 1: Run command")
    })

    it("should return error in guidance for missing path and content", async () => {
      const { dispatch } = await import("../../src/dispatcher/index.js")

      const result = await dispatch(
        { intent: "execute_document" as Intent, context: {}, force: true },
        mockStateManager
      )

      // Dispatcher returns success=true but guidance contains error message
      expect(result.success).toBe(true)
      expect(result.guidance).toContain("Error:")
      expect(result.guidance).toContain("Provide 'path' or 'content'")
    })

    it("should return error in guidance for file read error", async () => {
      mockReadFile.mockRejectedValueOnce(new Error("ENOENT"))

      const { dispatch } = await import("../../src/dispatcher/index.js")

      const result = await dispatch(
        { intent: "execute_document" as Intent, context: { path: "/nonexistent.md" }, force: true },
        mockStateManager
      )

      // Dispatcher returns success=true but guidance contains error message
      expect(result.success).toBe(true)
      expect(result.guidance).toContain("Error:")
      expect(result.guidance).toContain("Failed to read document")
    })
  })

  describe("execution contract", () => {
    it("should include execution rules", async () => {
      const { dispatch } = await import("../../src/dispatcher/index.js")

      const result = await dispatch(
        { intent: "execute_document" as Intent, context: { content: "Test document" }, force: true },
        mockStateManager
      )

      expect(result.guidance).toContain("No early exit")
      expect(result.guidance).toContain("Fix before giving up")
      expect(result.guidance).toContain("Verify each step")
      expect(result.guidance).toContain("Adapt paths")
    })

    it("should include stop conditions", async () => {
      const { dispatch } = await import("../../src/dispatcher/index.js")

      const result = await dispatch(
        { intent: "execute_document" as Intent, context: { content: "Test document" }, force: true },
        mockStateManager
      )

      expect(result.guidance).toContain("Stop conditions")
      expect(result.guidance).toContain("Remote machine is unreachable")
      expect(result.guidance).toContain("User explicitly says")
    })

    it("should include completion reporting requirement", async () => {
      const { dispatch } = await import("../../src/dispatcher/index.js")

      const result = await dispatch(
        { intent: "execute_document" as Intent, context: { content: "Test document" }, force: true },
        mockStateManager
      )

      expect(result.guidance).toContain("After completion")
      expect(result.guidance).toContain("Report")
    })
  })

  describe("operation guidance", () => {
    it("should build guidance for non-document intent", async () => {
      const { dispatch } = await import("../../src/dispatcher/index.js")

      const result = await dispatch(
        { intent: "prepare_model" as Intent, context: { MODEL_NAME: "llama-7b" } },
        mockStateManager
      )

      expect(result.success).toBe(true)
      expect(result.guidance).toContain("Operation: prepare_model")
      expect(result.guidance).toContain("started")
      expect(result.guidance).toContain("Check available skills")
      expect(result.guidance).toContain("MODEL_NAME: llama-7b")
    })

    it("should handle empty context", async () => {
      const { dispatch } = await import("../../src/dispatcher/index.js")

      const result = await dispatch(
        { intent: "gpu_status" as Intent },
        mockStateManager
      )

      expect(result.success).toBe(true)
      expect(result.guidance).toContain("Operation: gpu_status")
    })
  })

  describe("registerDispatcherTool", () => {
    it("should register musa_dispatch tool with correct schema", async () => {
      const mockApi = {
        registerTool: vi.fn(),
      }

      const { registerDispatcherTool } = await import("../../src/dispatcher/index.js")
      registerDispatcherTool(mockApi as any, mockStateManager)

      expect(mockApi.registerTool).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "musa_dispatch",
          description: expect.stringContaining("lifecycle"),
          parameters: expect.objectContaining({
            type: "object",
            properties: expect.objectContaining({
              intent: expect.objectContaining({
                type: "string",
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

    it("should include all intents in description", async () => {
      const mockApi = {
        registerTool: vi.fn(),
      }

      const { registerDispatcherTool } = await import("../../src/dispatcher/index.js")
      registerDispatcherTool(mockApi as any, mockStateManager)

      const toolDef = mockApi.registerTool.mock.calls[0][0]
      expect(toolDef.parameters.properties.intent.description).toContain("deploy_env")
      expect(toolDef.parameters.properties.intent.description).toContain("execute_document")
    })

    it("should execute dispatch on tool call", async () => {
      const mockApi = {
        registerTool: vi.fn(),
      }

      const { registerDispatcherTool } = await import("../../src/dispatcher/index.js")
      registerDispatcherTool(mockApi as any, mockStateManager)

      const toolDef = mockApi.registerTool.mock.calls[0][0]

      const result = await toolDef.execute("tool-call-123", { intent: "gpu_status" })
      expect(result).toBeDefined()

      const parsed = JSON.parse(result)
      expect(parsed.success).toBe(true)
    })
  })

  describe("tracing", () => {
    it("should use lark ticket messageId as traceId when available", async () => {
      const { getLarkTicket } = await import("../../src/shared/lark-ticket.js")
      vi.mocked(getLarkTicket).mockReturnValue({
        messageId: "msg-lark-456",
        chatId: "chat-123",
      } as any)

      const { dispatch } = await import("../../src/dispatcher/index.js")

      const result = await dispatch(
        { intent: "gpu_status" as Intent },
        mockStateManager
      )

      expect(result.traceId).toBe("msg-lark-456")
    })

    it("should generate traceId when no lark ticket", async () => {
      const { getLarkTicket } = await import("../../src/shared/lark-ticket.js")
      vi.mocked(getLarkTicket).mockReturnValue(null)

      const { dispatch } = await import("../../src/dispatcher/index.js")

      const result = await dispatch(
        { intent: "gpu_status" as Intent },
        mockStateManager
      )

      expect(result.traceId).toBe("test-trace-123")
    })
  })
})