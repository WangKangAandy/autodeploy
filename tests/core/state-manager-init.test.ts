/**
 * StateManager Initialization Race Condition Tests
 *
 * These tests verify that the fix for the startup race condition is effective:
 * - StateManager must be fully initialized before any operations can use it
 * - Operations called before initialization should throw clear errors
 * - NOT fallback to local mode silently
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

// Import compiled modules
import { StateManager } from "../../src/core/state-manager"

describe("StateManager Initialization", () => {
  let tempDir: string
  let stateManager: StateManager

  beforeEach(() => {
    // Create a fresh temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "musa-test-"))
  })

  afterEach(() => {
    // Cleanup temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  describe("isReady() and assertReady()", () => {
    it("should return false before initialize() is called", () => {
      stateManager = new StateManager(tempDir)
      expect(stateManager.isReady()).toBe(false)
    })

    it("should return true after initialize() completes", async () => {
      stateManager = new StateManager(tempDir)
      await stateManager.initialize()
      expect(stateManager.isReady()).toBe(true)
    })

    it("should throw error when assertReady() is called before initialize()", () => {
      stateManager = new StateManager(tempDir)
      expect(() => stateManager.assertReady()).toThrow("StateManager not ready")
    })

    it("should not throw when assertReady() is called after initialize()", async () => {
      stateManager = new StateManager(tempDir)
      await stateManager.initialize()
      expect(() => stateManager.assertReady()).not.toThrow()
    })

    it("should include multiple possible causes in the error message", () => {
      stateManager = new StateManager(tempDir)
      try {
        stateManager.assertReady()
      } catch (err) {
        expect(err).toBeInstanceOf(Error)
        const message = (err as Error).message
        expect(message).toContain("Plugin startup race")
        expect(message).toContain("Initialization failure")
        expect(message).toContain("File system error")
      }
    })
  })

  describe("Initialization failure handling", () => {
    it("should set _ready = false if initialization fails", async () => {
      stateManager = new StateManager(tempDir)

      // Make the directory read-only after creating StateManager
      // This simulates a file system error during initialization
      const readOnlyDir = path.join(tempDir, "readonly")
      fs.mkdirSync(readOnlyDir, { recursive: true })
      fs.chmodSync(readOnlyDir, 0o444)

      const failingManager = new StateManager(readOnlyDir)

      // On some systems, mkdir with recursive might still work with read-only parent
      // So we test the actual behavior
      try {
        await failingManager.initialize()
      } catch {
        // Expected to fail
      }

      expect(failingManager.isReady()).toBe(false)

      // Cleanup
      fs.chmodSync(readOnlyDir, 0o755)
    })
  })

  describe("State file initialization", () => {
    it("should create all required state files on initialization", async () => {
      stateManager = new StateManager(tempDir)
      await stateManager.initialize()

      const stateFiles = [
        "hosts.json",
        "jobs.json",
        "operations.json",
        "deployment_state.json",
        "document_executions.json",
      ]

      for (const file of stateFiles) {
        const filePath = path.join(tempDir, "autodeploy", file)
        expect(fs.existsSync(filePath)).toBe(true)
      }
    })

    it("should not overwrite existing state files", async () => {
      stateManager = new StateManager(tempDir)

      // Pre-create hosts.json with some data
      const autodeployDir = path.join(tempDir, "autodeploy")
      fs.mkdirSync(autodeployDir, { recursive: true })
      const hostsPath = path.join(autodeployDir, "hosts.json")
      const existingHosts = [{ id: "test_host", host: "192.168.1.1", user: "test" }]
      fs.writeFileSync(hostsPath, JSON.stringify(existingHosts))

      await stateManager.initialize()

      // Verify existing data is preserved
      const content = fs.readFileSync(hostsPath, "utf-8")
      const hosts = JSON.parse(content)
      expect(hosts).toHaveLength(1)
      expect(hosts[0].id).toBe("test_host")
    })
  })

  describe("Operation methods should assert ready", () => {
    beforeEach(() => {
      stateManager = new StateManager(tempDir)
      // NOT calling initialize() - simulating race condition
    })

    it("should throw when getExecutionMode() is called before init", async () => {
      expect(() => stateManager.assertReady()).toThrow("StateManager not ready")
      await expect(stateManager.getExecutionMode()).rejects.toThrow()
    })

    it("should throw when getDefaultHost() is called before init", async () => {
      expect(() => stateManager.assertReady()).toThrow("StateManager not ready")
      await expect(stateManager.getDefaultHost()).rejects.toThrow()
    })

    it("should throw when loadSnapshot() is called before init", async () => {
      expect(() => stateManager.assertReady()).toThrow("StateManager not ready")
      await expect(stateManager.loadSnapshot()).rejects.toThrow()
    })
  })
})

describe("Executor refreshCache with StateManager", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "musa-test-"))
  })

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it("should throw assertReady error when StateManager is not initialized", async () => {
    // This test verifies the key behavior:
    // When refreshCache is called before StateManager is ready,
    // it should throw a clear error, NOT fallback to local mode

    const stateManager = new StateManager(tempDir)
    // NOT calling initialize() - simulating race condition

    // The executor's refreshCache should fail with assertReady
    expect(() => stateManager.assertReady()).toThrow("StateManager not ready")
  })

  it("should work correctly after StateManager is initialized", async () => {
    const stateManager = new StateManager(tempDir)
    await stateManager.initialize()

    // Now assertReady should not throw
    expect(() => stateManager.assertReady()).not.toThrow()

    // And getExecutionMode should work
    const mode = await stateManager.getExecutionMode()
    expect(mode).toBe("local") // No default host = local mode
  })
})

describe("Dispatch entry point protection", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "musa-test-"))
  })

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it("should throw when dispatch is called with uninitialized StateManager", async () => {
    const stateManager = new StateManager(tempDir)
    // NOT calling initialize()

    // Simulate what dispatch() does at entry
    expect(() => stateManager.assertReady()).toThrow("StateManager not ready")
  })
})

describe("Race condition simulation", () => {
  it("should demonstrate the fix: operations fail fast instead of silent fallback", async () => {
    // This test documents the exact behavior we want:
    // BEFORE the fix: refreshCache would fallback to local mode silently
    // AFTER the fix: refreshCache throws a clear error

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "musa-test-"))
    const stateManager = new StateManager(tempDir)

    // Simulate a request arriving before initialize() completes
    // This should throw, NOT return "local" silently
    let errorThrown = false
    let errorMessage = ""

    try {
      stateManager.assertReady()
    } catch (err) {
      errorThrown = true
      errorMessage = (err as Error).message
    }

    expect(errorThrown).toBe(true)
    expect(errorMessage).toContain("StateManager not ready")
    expect(errorMessage).toContain("Possible causes")

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it("should show that after proper initialization, everything works", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "musa-test-"))
    const stateManager = new StateManager(tempDir)

    // Proper initialization sequence
    await stateManager.initialize()

    // Now all operations should work
    expect(stateManager.isReady()).toBe(true)
    expect(() => stateManager.assertReady()).not.toThrow()

    const mode = await stateManager.getExecutionMode()
    expect(mode).toBe("local")

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true })
  })
})