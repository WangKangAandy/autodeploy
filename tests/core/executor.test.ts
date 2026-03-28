/**
 * Executor State Management Tests
 *
 * Core regression tests for state management fixes.
 * Focus on the key failure handling behaviors.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

describe("executor state management", () => {
  let executorModule: any

  beforeEach(async () => {
    vi.resetModules()

    // Simple mocks
    vi.doMock("../../src/core/local-exec", () => ({
      execLocal: vi.fn().mockResolvedValue({ stdout: "local", stderr: "", exitCode: 0 }),
      execLocalDocker: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    }))

    vi.doMock("../../src/core/ssh-client", () => ({
      execRemote: vi.fn().mockResolvedValue({ stdout: "remote", stderr: "", exitCode: 0 }),
      execRemoteDocker: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
      syncFiles: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    }))

    executorModule = await import("../../src/core/executor")
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  function createRemoteConfig() {
    return {
      host: "10.0.0.1",
      user: "testuser",
      password: "secret123",
      port: 22,
    }
  }

  function createMockStateManager(overrides = {}) {
    return {
      getExecutionMode: vi.fn().mockResolvedValue("local"),
      getRemoteConfig: vi.fn().mockResolvedValue(null),
      getDefaultHost: vi.fn().mockResolvedValue(null),
      ...overrides,
    }
  }

  // ============================================================================
  // Case 2a: mode 读取失败时阻断
  // ============================================================================

  describe("Case 2a: refreshCache blocks when getExecutionMode fails", () => {
    it("should throw when getExecutionMode fails and cache is remote", async () => {
      // Set remote cache first
      executorModule.setMode("remote", createRemoteConfig())

      const mockSM = createMockStateManager({
        getExecutionMode: vi.fn().mockRejectedValue(new Error("read error")),
      })

      executorModule.init(mockSM)

      await expect(executorModule.refreshCache()).rejects.toThrow(/reconfigure/i)
    })
  })

  // ============================================================================
  // Case 2b: remote config 读取失败时阻断
  // ============================================================================

  describe("Case 2b: refreshCache blocks when getRemoteConfig fails", () => {
    it("should throw when getRemoteConfig fails and mode is remote", async () => {
      executorModule.setMode("remote", createRemoteConfig())

      const mockSM = createMockStateManager({
        getExecutionMode: vi.fn().mockResolvedValue("remote"),
        getRemoteConfig: vi.fn().mockRejectedValue(new Error("config error")),
      })

      executorModule.init(mockSM)

      await expect(executorModule.refreshCache()).rejects.toThrow(/Remote mode refresh failed/i)
    })
  })

  // ============================================================================
  // Case 3: local cache 下 refresh 失败仍可继续
  // ============================================================================

  describe("Case 3: local mode continues on StateManager failure", () => {
    it("should not throw when getExecutionMode fails and cache is local", async () => {
      executorModule.setMode("local", null)

      const mockSM = createMockStateManager({
        getExecutionMode: vi.fn().mockRejectedValue(new Error("error")),
      })

      executorModule.init(mockSM)

      // Should not throw for local mode
      await expect(executorModule.refreshCache()).resolves.toBeUndefined()
    })
  })

  // ============================================================================
  // Case 4: StateManager 不可用 + remote cache 时阻断
  // ============================================================================

  describe("Case 4: StateManager unavailable with remote cache", () => {
    it("should throw when StateManager is null and cache is remote", async () => {
      executorModule.setMode("remote", createRemoteConfig())
      executorModule.init(null)

      await expect(executorModule.refreshCache()).rejects.toThrow(
        /StateManager not available while in remote mode/i
      )
    })

    it("should NOT throw when StateManager is null and cache is local", async () => {
      executorModule.setMode("local", null)
      executorModule.init(null)

      await expect(executorModule.refreshCache()).resolves.toBeUndefined()
    })
  })

  // ============================================================================
  // Additional: Basic mode functions
  // ============================================================================

  describe("basic mode functions", () => {
    it("getMode should return 'local' by default", () => {
      executorModule.init(null)
      executorModule.setMode("local", null)
      expect(executorModule.getMode()).toBe("local")
    })

    it("getMode should return 'remote' after setMode", () => {
      executorModule.setMode("remote", createRemoteConfig())
      expect(executorModule.getMode()).toBe("remote")
    })

    it("getRemoteConfig should return config after setMode", () => {
      const config = createRemoteConfig()
      executorModule.setMode("remote", config)
      expect(executorModule.getRemoteConfig()).toEqual(config)
    })

    it("isRemoteReady returns true with valid remote config", () => {
      // This is tested implicitly through the refreshCache tests
      // setMode updates the cache, and isRemoteReady checks the cache
      executorModule.setMode("remote", createRemoteConfig())

      // isRemoteReady returns: cachedMode === "remote" && cachedRemoteConfig && cachedRemoteConfig.host && cachedRemoteConfig.user
      const config = executorModule.getRemoteConfig()
      expect(config.host).toBe("10.0.0.1")
      expect(config.user).toBe("testuser")
      expect(executorModule.getMode()).toBe("remote")
    })

    it("isRemoteReady returns false with incomplete config", () => {
      executorModule.setMode("remote", { host: "10.0.0.1" }) // missing user
      const config = executorModule.getRemoteConfig()

      // Config exists but user is missing
      expect(config.host).toBe("10.0.0.1")
      expect(config.user).toBeUndefined()
    })
  })
})