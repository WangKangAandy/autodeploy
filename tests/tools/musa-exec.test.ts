/**
 * musa-exec Tools Tests
 *
 * Tests for:
 * - Case 5: musa_get_mode reads from StateManager and sanitizes output
 * - Case 6: setDefaultHost validates hostId and doesn't corrupt state on error
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

describe("musa-exec tools", () => {
  let toolHandlers: Map<string, Function>
  let capturedState: { stateManager: any }

  beforeEach(async () => {
    vi.resetModules()
    toolHandlers = new Map()
    capturedState = { stateManager: null }

    // Mock executor module
    vi.doMock("../../src/core/executor", () => ({
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
      sanitizeSensitive: vi.fn().mockImplementation((obj: any) => {
        if (!obj || typeof obj !== "object") return obj
        const result: any = {}
        for (const [k, v] of Object.entries(obj)) {
          if (["password", "sudoPasswd"].includes(k)) {
            result[k] = "***"
          } else {
            result[k] = v
          }
        }
        return result
      }),
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

  function createMockStateManagerWithHost() {
    return {
      isReady: vi.fn().mockReturnValue(true),
      assertReady: vi.fn().mockReturnValue(undefined),
      getExecutionMode: vi.fn().mockResolvedValue("remote"),
      getRemoteConfig: vi.fn().mockResolvedValue({
        host: "10.0.0.1",
        user: "testuser",
        password: "secretPassword123", // Should be sanitized
        sudoPasswd: "sudoPassword456", // Should be sanitized
        port: 22,
      }),
      getDefaultHost: vi.fn().mockResolvedValue({
        id: "host_123",
        host: "10.0.0.1",
        user: "testuser",
        password: "secretPassword123",
        sudoPasswd: "sudoPassword456",
        port: 22,
        isDefault: true,
        status: "online",
        environment: { dockerAvailable: true, toolkitInstalled: true, mthreadsGmiAvailable: true },
      }),
      registerHost: vi.fn().mockResolvedValue("host_123"),
      setDefaultHost: vi.fn().mockResolvedValue(undefined),
      clearDefaultHost: vi.fn().mockResolvedValue(undefined),
      loadState: vi.fn().mockResolvedValue([]),
    }
  }

  // ============================================================================
  // Case 5: musa_get_mode 脱敏测试
  // ============================================================================

  describe("Case 5: musa_get_mode sanitization", () => {
    it("should return remote mode info WITHOUT password/sudoPasswd", async () => {
      const mockSM = createMockStateManagerWithHost()
      const mockApi = createMockApi()

      const musaExec = await import("../../src/tools/musa-exec")
      musaExec.registerMusaGetModeTool(mockApi)
      musaExec.registerMusaSetModeTool(mockApi, mockSM)

      const getModeHandler = toolHandlers.get("musa_get_mode")
      const result = await getModeHandler!("tool-call-1", {})

      // Verify result structure
      expect(result.details.mode).toBe("remote")
      expect(result.details.connection).toBeDefined()
      expect(result.details.connection.host).toBe("10.0.0.1")
      expect(result.details.connection.user).toBe("testuser")

      // Critical: passwords should NOT be in the result
      expect(result.details.connection.password).toBeUndefined()
      expect(result.details.connection.sudoPasswd).toBeUndefined()
    })

    it("should read from StateManager (not executor cache) as primary source", async () => {
      const mockSM = createMockStateManagerWithHost()
      const mockApi = createMockApi()

      const musaExec = await import("../../src/tools/musa-exec")
      musaExec.registerMusaGetModeTool(mockApi)
      musaExec.registerMusaSetModeTool(mockApi, mockSM)

      const getModeHandler = toolHandlers.get("musa_get_mode")
      await getModeHandler!("tool-call-1", {})

      // Verify it called StateManager methods
      expect(mockSM.getExecutionMode).toHaveBeenCalled()
      expect(mockSM.getDefaultHost).toHaveBeenCalled()
    })

    it("should return local mode when no default host", async () => {
      const mockSM = {
        isReady: vi.fn().mockReturnValue(true),
        assertReady: vi.fn().mockReturnValue(undefined),
        getExecutionMode: vi.fn().mockResolvedValue("local"),
        getDefaultHost: vi.fn().mockResolvedValue(null),
        loadState: vi.fn().mockResolvedValue([]),
      }
      const mockApi = createMockApi()

      const musaExec = await import("../../src/tools/musa-exec")
      musaExec.registerMusaGetModeTool(mockApi)
      musaExec.registerMusaSetModeTool(mockApi, mockSM)

      const getModeHandler = toolHandlers.get("musa_get_mode")
      const result = await getModeHandler!("tool-call-1", {})

      expect(result.details.mode).toBe("local")
      expect(result.details.ready).toBe(true)
    })
  })

  // ============================================================================
  // Case 6: setDefaultHost 校验测试
  // ============================================================================

  describe("Case 6: setDefaultHost validation", () => {
    it("should return error when setDefaultHost throws (host not found)", async () => {
      const mockSM = {
        isReady: vi.fn().mockReturnValue(true),
        assertReady: vi.fn().mockReturnValue(undefined),
        registerHost: vi.fn().mockResolvedValue("host_new"),
        setDefaultHost: vi.fn().mockRejectedValue(
          new Error('Cannot set default host: host with ID "non_existent" not found')
        ),
      }
      const mockApi = createMockApi()

      const musaExec = await import("../../src/tools/musa-exec")
      musaExec.registerMusaSetModeTool(mockApi, mockSM)

      const setModeHandler = toolHandlers.get("musa_set_mode")

      const result = await setModeHandler!("tool-call-1", {
        mode: "remote",
        host: "10.0.0.99",
        user: "newuser",
        password: "newpass",
      })

      // Should return error
      expect(result.details.error).toContain("not found")
    })
  })

  // ============================================================================
  // Additional: musa_set_mode basic tests
  // ============================================================================

  describe("musa_set_mode basic functionality", () => {
    it("should set remote mode successfully with valid params", async () => {
      const mockSM = createMockStateManagerWithHost()
      const mockApi = createMockApi()

      const musaExec = await import("../../src/tools/musa-exec")
      musaExec.registerMusaSetModeTool(mockApi, mockSM)

      const setModeHandler = toolHandlers.get("musa_set_mode")

      const result = await setModeHandler!("tool-call-1", {
        mode: "remote",
        host: "10.0.0.1",
        user: "testuser",
        password: "testpass",
      })

      expect(result.details.success).toBe(true)
      expect(result.details.mode).toBe("remote")
      expect(mockSM.registerHost).toHaveBeenCalled()
      expect(mockSM.setDefaultHost).toHaveBeenCalled()
    })

    it("should return error when remote mode params missing", async () => {
      const mockApi = createMockApi()

      const musaExec = await import("../../src/tools/musa-exec")
      musaExec.registerMusaSetModeTool(mockApi, null)

      const setModeHandler = toolHandlers.get("musa_set_mode")

      const result = await setModeHandler!("tool-call-1", {
        mode: "remote",
        // missing host, user, password
      })

      expect(result.details.error).toContain("requires host, user, and password")
    })

    it("should set local mode successfully", async () => {
      const mockSM = {
        isReady: vi.fn().mockReturnValue(true),
        assertReady: vi.fn().mockReturnValue(undefined),
        clearDefaultHost: vi.fn().mockResolvedValue(undefined),
      }
      const mockApi = createMockApi()

      const musaExec = await import("../../src/tools/musa-exec")
      musaExec.registerMusaSetModeTool(mockApi, mockSM)

      const setModeHandler = toolHandlers.get("musa_set_mode")

      const result = await setModeHandler!("tool-call-1", {
        mode: "local",
      })

      expect(result.details.success).toBe(true)
      expect(result.details.mode).toBe("local")
      expect(mockSM.clearDefaultHost).toHaveBeenCalled()
    })

    it("should return error when StateManager not available for remote mode", async () => {
      const mockApi = createMockApi()

      const musaExec = await import("../../src/tools/musa-exec")
      musaExec.registerMusaSetModeTool(mockApi, null)

      const setModeHandler = toolHandlers.get("musa_set_mode")

      const result = await setModeHandler!("tool-call-1", {
        mode: "remote",
        host: "10.0.0.1",
        user: "testuser",
        password: "testpass",
      })

      expect(result.details.error).toContain("StateManager not available")
    })
  })
})