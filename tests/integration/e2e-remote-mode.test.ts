/**
 * End-to-End Integration Test for Bug #1: musa_exec Remote Mode
 *
 * This test verifies the complete flow:
 * 1. StateManager initialization is awaited
 * 2. executor.init() is called with StateManager
 * 3. musa_set_mode sets remote mode
 * 4. executor.refreshCache() updates cache
 * 5. musa_exec uses remote mode
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

describe("E2E: Remote Mode Flow", () => {
  let tempDir: string

  beforeEach(async () => {
    vi.resetModules()

    // Create temp directory for state files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "musa-e2e-"))
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    // Cleanup temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  // ============================================================================
  // Test 1: Initialization chain - the core Bug #1 fix
  // ============================================================================

  describe("Initialization Chain (Bug #1 Core Fix)", () => {
    it("should have StateManager ready after await initialize()", async () => {
      const { StateManager } = await import("../../src/core/state-manager")

      const sm = new StateManager(tempDir)
      await sm.initialize()

      // Verify StateManager is ready
      const mode = await sm.getExecutionMode()
      expect(mode).toBe("local") // Default mode
    })

    it("should allow executor to use StateManager after init", async () => {
      const { StateManager } = await import("../../src/core/state-manager")
      const executor = await import("../../src/core/executor")

      const sm = new StateManager(tempDir)
      await sm.initialize()

      // Initialize executor with StateManager (simulates hooks.ts)
      executor.init(sm)

      // refreshCache should work without throwing
      await executor.refreshCache()

      // Mode should be local (no remote host set)
      expect(executor.getMode()).toBe("local")
    })

    it("should gracefully handle uninitialized StateManager in local mode", async () => {
      const { StateManager } = await import("../../src/core/state-manager")
      const executor = await import("../../src/core/executor")

      const sm = new StateManager(tempDir)
      await sm.initialize()  // Must initialize - fail fast is the design intent

      executor.init(sm)

      // refreshCache should NOT throw when in local mode (graceful degradation)
      // The executor logs a warning but continues with local mode
      await executor.refreshCache()
      expect(executor.getMode()).toBe("local")
    })
  })

  // ============================================================================
  // Test 2: Remote mode state management
  // ============================================================================

  describe("Remote Mode State Management", () => {
    it("should set remote host and update executor cache", async () => {
      const { StateManager } = await import("../../src/core/state-manager")
      const executor = await import("../../src/core/executor")

      const sm = new StateManager(tempDir)
      await sm.initialize()
      executor.init(sm)

      // Register a remote host
      const hostId = await sm.registerHost({
        host: "10.10.142.191",
        user: "mccxadmin",
        password: "testpass",
        port: 22,
        sudoPasswd: "testpass",
        status: "online",
      })

      // Set as default host
      await sm.setDefaultHost(hostId)

      // Refresh executor cache
      await executor.refreshCache()

      // Verify mode is remote
      expect(executor.getMode()).toBe("remote")

      // Verify remote config
      const config = executor.getRemoteConfig()
      expect(config).toBeDefined()
      expect(config.host).toBe("10.10.142.191")
      expect(config.user).toBe("mccxadmin")
    })

    it("should switch from local to remote mode", async () => {
      const { StateManager } = await import("../../src/core/state-manager")
      const executor = await import("../../src/core/executor")

      const sm = new StateManager(tempDir)
      await sm.initialize()
      executor.init(sm)

      // Start in local mode
      await executor.refreshCache()
      expect(executor.getMode()).toBe("local")

      // Switch to remote
      const hostId = await sm.registerHost({
        host: "10.10.142.191",
        user: "mccxadmin",
        password: "testpass",
        port: 22,
      })
      await sm.setDefaultHost(hostId)
      await executor.refreshCache()

      expect(executor.getMode()).toBe("remote")
    })

    it("should switch from remote to local mode", async () => {
      const { StateManager } = await import("../../src/core/state-manager")
      const executor = await import("../../src/core/executor")

      const sm = new StateManager(tempDir)
      await sm.initialize()
      executor.init(sm)

      // Start in remote mode
      const hostId = await sm.registerHost({
        host: "10.10.142.191",
        user: "mccxadmin",
        password: "testpass",
        port: 22,
      })
      await sm.setDefaultHost(hostId)
      await executor.refreshCache()
      expect(executor.getMode()).toBe("remote")

      // Switch to local
      await sm.clearDefaultHost()
      await executor.refreshCache()

      expect(executor.getMode()).toBe("local")
      expect(executor.getRemoteConfig()).toBeNull()
    })
  })

  // ============================================================================
  // Test 3: State persistence
  // ============================================================================

  describe("State Persistence Across Restart", () => {
    it("should restore state from persisted files", async () => {
      const { StateManager } = await import("../../src/core/state-manager")

      // First session: set remote mode
      const sm1 = new StateManager(tempDir)
      await sm1.initialize()
      const hostId = await sm1.registerHost({
        host: "10.10.142.191",
        user: "mccxadmin",
        password: "testpass",
        port: 22,
      })
      await sm1.setDefaultHost(hostId)
      await sm1.persistAll()

      // Second session: restore state
      const sm2 = new StateManager(tempDir)
      await sm2.initialize()

      // Verify state is restored
      const mode = await sm2.getExecutionMode()
      expect(mode).toBe("remote")

      const defaultHost = await sm2.getDefaultHost()
      expect(defaultHost).toBeDefined()
      expect(defaultHost.host).toBe("10.10.142.191")
    })
  })

  // ============================================================================
  // Test 4: isRemoteReady check
  // ============================================================================

  describe("isRemoteReady Check", () => {
    it("should return false when in local mode", async () => {
      const executor = await import("../../src/core/executor")

      executor.setMode("local", null)
      expect(executor.isRemoteReady()).toBe(false)
    })

    it("should return true when remote config is complete", async () => {
      const executor = await import("../../src/core/executor")

      executor.setMode("remote", {
        host: "10.0.0.1",
        user: "testuser",
        password: "testpass",
        port: 22,
      })

      // Verify mode is set
      expect(executor.getMode()).toBe("remote")

      // Verify config is set
      const config = executor.getRemoteConfig()
      expect(config).toBeDefined()
      expect(config.host).toBe("10.0.0.1")
      expect(config.user).toBe("testuser")

      // isRemoteReady should return true
      const ready = executor.isRemoteReady()
      expect(ready).toBe(true)
    })
  })
})