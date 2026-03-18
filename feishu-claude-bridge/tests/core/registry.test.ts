import { describe, it, expect, beforeEach } from "vitest"
import { registry } from "../../src/core/registry.js"
import { BaseAdapter } from "../../src/platforms/base.js"
import type { Request, Response } from "express"
import type {
  PlatformAdapter,
  SendOptions,
  MessageResult
} from "../../src/core/types.js"

// Mock adapter for testing
class MockAdapter extends BaseAdapter {
  readonly id = "mock"
  readonly name = "Mock Platform"

  protected async onInitialize(): Promise<void> {
    this.botInfo = { id: "mock-bot", name: "Mock Bot" }
  }

  getWebhookPath(): string {
    return "mock"
  }

  async handleWebhook(_req: Request, _res: Response): Promise<void> {}

  async sendMessage(_targetId: string, _content: string, _options?: SendOptions): Promise<MessageResult> {
    return { success: true, messageId: "mock-msg-id" }
  }
}

describe("Platform Registry", () => {
  beforeEach(() => {
    registry.clear()
  })

  it("should register a platform adapter", () => {
    registry.register("mock", MockAdapter)
    expect(registry.has("mock")).toBe(true)
    expect(registry.getRegisteredPlatforms()).toContain("mock")
  })

  it("should create and initialize an adapter", async () => {
    registry.register("mock", MockAdapter)
    const adapter = await registry.createAdapter("mock", {})

    expect(adapter).toBeInstanceOf(MockAdapter)
    expect(adapter.id).toBe("mock")
    expect(adapter.name).toBe("Mock Platform")
    expect(registry.getEnabledPlatforms()).toContain("mock")
  })

  it("should throw error for unknown platform", async () => {
    await expect(registry.createAdapter("unknown", {})).rejects.toThrow("Unknown platform: unknown")
  })

  it("should return existing adapter if already initialized", async () => {
    registry.register("mock", MockAdapter)
    const adapter1 = await registry.createAdapter("mock", {})
    const adapter2 = registry.getAdapter("mock")

    expect(adapter1).toBe(adapter2)
  })

  it("should initialize multiple platforms from config", async () => {
    registry.register("mock1", MockAdapter)
    registry.register("mock2", MockAdapter)

    const configs = [
      { type: "mock1", enabled: true },
      { type: "mock2", enabled: true },
      { type: "mock3", enabled: false }
    ]

    const adapters = await registry.initializeFromConfig(configs)

    expect(adapters.length).toBe(2)
    expect(registry.getEnabledPlatforms()).toContain("mock1")
    expect(registry.getEnabledPlatforms()).toContain("mock2")
    expect(registry.getEnabledPlatforms()).not.toContain("mock3")
  })

  it("should dispose all adapters", async () => {
    registry.register("mock", MockAdapter)
    await registry.createAdapter("mock", {})

    await registry.disposeAll()

    expect(registry.getEnabledPlatforms().length).toBe(0)
  })
})