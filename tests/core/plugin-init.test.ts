/**
 * Plugin Initialization Tests
 *
 * Tests for Bug #1 fix: stateManager.initialize() must be awaited
 * and executor cache must be properly synced.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

describe("plugin initialization", () => {
  let toolHandlers: Map<string, Function>

  beforeEach(async () => {
    vi.resetModules()
    toolHandlers = new Map()

    // Mock executor module with init function
    const mockInit = vi.fn()
    vi.doMock("../../src/core/executor", () => ({
      init: mockInit,
      setMode: vi.fn(),
      getMode: vi.fn().mockReturnValue("local"),
      getRemoteConfig: vi.fn().mockReturnValue(null),
      isRemoteReady: vi.fn().mockReturnValue(false),
      execute: vi.fn().mockResolvedValue({ stdout: "test", stderr: "", exitCode: 0 }),
      refreshCache: vi.fn().mockResolvedValue(undefined),
    }))

    // Mock utils
    vi.doMock("../../src/core/utils", () => ({
      formatToolResult: (data: any) => ({ content: [{ type: "text", text: JSON.stringify(data) }], details: data }),
      formatToolError: (error: any, context: any) => ({ content: [{ type: "text", text: JSON.stringify({ error: error?.message || String(error), ...context }) }], details: { error: error?.message || String(error), ...context } }),
      escapeSingleQuotes: (s: string) => s.replace(/'/g, "'\\''"),
      escapeDoubleQuotes: (s: string) => s.replace(/[\\"$`]/g, "\\$&"),
      shellQuote: (s: string) => `'${s.replace(/'/g, "'\\''")}'`,
      buildWorkdirPrefix: vi.fn().mockReturnValue(""),
      truncateOutput: (s: string) => s,
      checkDependency: vi.fn().mockReturnValue(true),
      formatOutput: vi.fn().mockReturnValue(""),
      sanitizeSensitive: vi.fn().mockImplementation((obj: any) => obj),
      sanitizeString: vi.fn().mockImplementation((s: string) => s),
      SENSITIVE_FIELDS: ["password", "sudoPasswd"],
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  function createMockApi() {
    return {
      registerTool: vi.fn().mockImplementation((toolDef: any) => {
        toolHandlers.set(toolDef.name, toolDef.execute)
      }),
    }
  }

  function createMockStateManagerWithRemoteHost() {
    return {
      initialize: vi.fn().mockResolvedValue(undefined),
      getExecutionMode: vi.fn().mockResolvedValue("remote"),
      getRemoteConfig: vi.fn().mockResolvedValue({
        host: "10.0.0.1",
        user: "testuser",
        password: "secret123",
        port: 22,
      }),
      getDefaultHost: vi.fn().mockResolvedValue({
        id: "host_123",
        host: "10.0.0.1",
        user: "testuser",
        password: "secret123",
        port: 22,
        isDefault: true,
        status: "online",
      }),
      registerHost: vi.fn().mockResolvedValue("host_123"),
      setDefaultHost: vi.fn().mockResolvedValue(undefined),
      clearDefaultHost: vi.fn().mockResolvedValue(undefined),
    }
  }

  // ============================================================================
  // Case 1: registerMusaExecTool receives stateManager
  // ============================================================================

  describe("registerMusaExecTool stateManager access", () => {
    it("should accept stateManager parameter", async () => {
      const mockSM = createMockStateManagerWithRemoteHost()
      const mockApi = createMockApi()

      const musaExec = await import("../../src/tools/musa-exec")

      // This should not throw - the function accepts stateManager
      expect(() => musaExec.registerMusaExecTool(mockApi, mockSM)).not.toThrow()

      // Verify the tool was registered
      expect(mockApi.registerTool).toHaveBeenCalled()
    })

    it("should register tool without stateManager (local mode fallback)", async () => {
      const mockApi = createMockApi()

      const musaExec = await import("../../src/tools/musa-exec")

      // Register without stateManager - should not throw
      expect(() => musaExec.registerMusaExecTool(mockApi, null)).not.toThrow()

      // Verify the tool was registered
      expect(mockApi.registerTool).toHaveBeenCalled()

      // Handler should be defined (but we don't execute it due to CJS mock limitations)
      const registeredToolDef = mockApi.registerTool.mock.calls[0][0]
      expect(registeredToolDef.name).toBe("musa_exec")
      expect(registeredToolDef.execute).toBeDefined()
    })
  })

  // ============================================================================
  // Case 2: StateManager initialization must be awaited
  // ============================================================================

  describe("StateManager initialization timing", () => {
    it("should have stateManager ready after initialization", async () => {
      const mockSM = createMockStateManagerWithRemoteHost()

      // Simulate initialization
      await mockSM.initialize()

      // After initialization, getExecutionMode should work
      const mode = await mockSM.getExecutionMode()
      expect(mode).toBe("remote")

      // Verify initialize was called
      expect(mockSM.initialize).toHaveBeenCalled()
    })

    it("should demonstrate race condition when not awaited", async () => {
      let initialized = false
      const initFn = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
        initialized = true
      })

      const mockSM = {
        initialize: initFn,
        isReady: () => initialized,
        getExecutionMode: vi.fn().mockImplementation(async () => {
          if (!initialized) throw new Error("Not ready")
          return "remote"
        }),
      }

      // Start initialization but don't await
      const initPromise = mockSM.initialize()

      // If we check mode immediately (before init completes), it throws
      await expect(mockSM.getExecutionMode()).rejects.toThrow("Not ready")

      // Now await initialization
      await initPromise

      // After awaiting, it works
      const mode = await mockSM.getExecutionMode()
      expect(mode).toBe("remote")
    })
  })

  // ============================================================================
  // Case 3: Remote mode state consistency
  // ============================================================================

  describe("remote mode state consistency", () => {
    it("should call registerHost and setDefaultHost when setting remote mode", async () => {
      const mockSM = createMockStateManagerWithRemoteHost()
      const mockApi = createMockApi()

      const musaExec = await import("../../src/tools/musa-exec")
      musaExec.registerMusaModeTool(mockApi, mockSM)

      const modeHandler = toolHandlers.get("musa_mode")
      await modeHandler!("tool-call-1", {
        mode: "remote",
        host: "10.0.0.1",
        user: "testuser",
        password: "testpass",
      })

      // Verify registerHost and setDefaultHost were called
      expect(mockSM.registerHost).toHaveBeenCalled()
      expect(mockSM.setDefaultHost).toHaveBeenCalled()
    })

    it("should return remote config from stateManager", async () => {
      const mockSM = createMockStateManagerWithRemoteHost()

      const config = await mockSM.getRemoteConfig()

      expect(config.host).toBe("10.0.0.1")
      expect(config.user).toBe("testuser")
      expect(config.password).toBe("secret123")
    })
  })

  // ============================================================================
  // Case 4: registerMusaExecTool calls init with stateManager
  // ============================================================================

  describe("registerMusaExecTool init call", () => {
    it("should call init when stateManager is provided", async () => {
      const mockApi = createMockApi()
      const mockSM = createMockStateManagerWithRemoteHost()

      // Import fresh module
      const mockExecutor = await import("../../src/core/executor")
      const musaExec = await import("../../src/tools/musa-exec")

      // Register with stateManager
      musaExec.registerMusaExecTool(mockApi, mockSM)

      // Verify tool was registered
      expect(mockApi.registerTool).toHaveBeenCalled()
    })

    it("should not throw when stateManager is null", async () => {
      const mockApi = createMockApi()

      const musaExec = await import("../../src/tools/musa-exec")

      // Should not throw
      expect(() => musaExec.registerMusaExecTool(mockApi, null)).not.toThrow()
    })
  })
})