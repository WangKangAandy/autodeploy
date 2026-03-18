import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the logger
vi.mock('../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }
}))

// Mock the agent-tools module
vi.mock('../../agent-tools/dist/core/executors.js', () => ({
  execRemote: vi.fn(),
  execDocker: vi.fn(),
  syncFiles: vi.fn(),
  formatOutput: vi.fn((stdout, stderr, exitCode) => {
    let output = ""
    if (stdout.trim()) output += stdout
    if (stderr.trim()) output += (output ? "\n" : "") + `STDERR:\n${stderr}`
    output += `\nEXIT CODE: ${exitCode}`
    return output
  }),
}))

import { ToolClient } from '../src/tool-client.js'

describe('ToolClient', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
    vi.clearAllMocks()
  })

  describe('fromEnv', () => {
    it('should create from environment variables', () => {
      process.env.GPU_HOST = "192.168.1.1"
      process.env.GPU_USER = "testuser"
      process.env.GPU_SSH_PASSWD = "testpass"
      process.env.GPU_PORT = "22"

      const client = ToolClient.fromEnv()
      expect(client.getHostInfo()).toBe("testuser@192.168.1.1:22")
    })

    it('should use default port 22 when GPU_PORT not set', () => {
      process.env.GPU_HOST = "192.168.1.1"
      process.env.GPU_USER = "testuser"
      process.env.GPU_SSH_PASSWD = "testpass"
      delete process.env.GPU_PORT

      const client = ToolClient.fromEnv()
      expect(client.getHostInfo()).toBe("testuser@192.168.1.1:22")
    })

    it('should throw error when GPU_HOST missing', () => {
      delete process.env.GPU_HOST
      process.env.GPU_USER = "testuser"
      process.env.GPU_SSH_PASSWD = "testpass"

      expect(() => ToolClient.fromEnv()).toThrow("Missing required")
    })

    it('should throw error when GPU_USER missing', () => {
      process.env.GPU_HOST = "192.168.1.1"
      delete process.env.GPU_USER
      process.env.GPU_SSH_PASSWD = "testpass"

      expect(() => ToolClient.fromEnv()).toThrow("Missing required")
    })

    it('should throw error when GPU_SSH_PASSWD missing', () => {
      process.env.GPU_HOST = "192.168.1.1"
      process.env.GPU_USER = "testuser"
      delete process.env.GPU_SSH_PASSWD

      expect(() => ToolClient.fromEnv()).toThrow("Missing required")
    })
  })

  describe('fromCredentials', () => {
    it('should create with dynamic credentials', () => {
      const client = ToolClient.fromCredentials("10.0.0.1", "admin", "secret")
      expect(client.getCredentialsSource()).toBe("dynamic")
      expect(client.isValid()).toBe(true)
    })

    it('should create with custom port', () => {
      const client = ToolClient.fromCredentials("10.0.0.1", "admin", "secret", "2222")
      expect(client.getHostInfo()).toBe("admin@10.0.0.1:2222")
    })

    it('should use default port 22 when not specified', () => {
      const client = ToolClient.fromCredentials("10.0.0.1", "admin", "secret")
      expect(client.getHostInfo()).toBe("admin@10.0.0.1:22")
    })
  })

  describe('isValid', () => {
    it('should return true when all required fields present', () => {
      const client = ToolClient.fromCredentials("10.0.0.1", "admin", "secret")
      expect(client.isValid()).toBe(true)
    })

    it('should return false when host is empty', () => {
      const client = new ToolClient({ host: "", user: "admin", password: "secret" }, "test")
      expect(client.isValid()).toBe(false)
    })

    it('should return false when user is empty', () => {
      const client = new ToolClient({ host: "10.0.0.1", user: "", password: "secret" }, "test")
      expect(client.isValid()).toBe(false)
    })

    it('should return false when password is empty', () => {
      const client = new ToolClient({ host: "10.0.0.1", user: "admin", password: "" }, "test")
      expect(client.isValid()).toBe(false)
    })
  })

  describe('getHostInfo', () => {
    it('should return formatted host info', () => {
      const client = ToolClient.fromCredentials("192.168.1.100", "testuser", "pass123", "2222")
      expect(client.getHostInfo()).toBe("testuser@192.168.1.100:2222")
    })
  })

  describe('getCredentialsSource', () => {
    it('should return "env" when created from environment', () => {
      process.env.GPU_HOST = "192.168.1.1"
      process.env.GPU_USER = "testuser"
      process.env.GPU_SSH_PASSWD = "testpass"

      const client = ToolClient.fromEnv()
      expect(client.getCredentialsSource()).toBe("env")
    })

    it('should return "dynamic" when created from credentials', () => {
      const client = ToolClient.fromCredentials("10.0.0.1", "admin", "secret")
      expect(client.getCredentialsSource()).toBe("dynamic")
    })

    it('should return custom source when provided', () => {
      const client = new ToolClient(
        { host: "10.0.0.1", user: "admin", password: "secret" },
        "custom"
      )
      expect(client.getCredentialsSource()).toBe("custom")
    })
  })
})