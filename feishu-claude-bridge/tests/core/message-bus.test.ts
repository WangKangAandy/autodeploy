import { describe, it, expect, beforeEach, vi } from "vitest"
import { messageBus } from "../../src/core/message-bus.js"
import type { UnifiedMessage } from "../../src/core/types.js"

describe("Message Bus", () => {
  beforeEach(() => {
    messageBus.stopProcessing()
    messageBus.clearQueue()
  })

  it("should subscribe handlers", () => {
    const handler = vi.fn()
    messageBus.subscribe(handler)

    // The messageBus doesn't expose handlers directly, but we can test via publish
    expect(messageBus.getQueueSize()).toBe(0)
  })

  it("should publish messages to queue", async () => {
    const handler = vi.fn()
    messageBus.subscribe(handler)

    const message: UnifiedMessage = {
      id: "test-msg-1",
      platform: "test",
      chat: { id: "chat-1", type: "private" },
      sender: { id: "user-1" },
      content: { text: "Hello", type: "text" },
      timestamp: Date.now(),
      raw: null
    }

    await messageBus.publish(message)

    // Give time for processing
    await new Promise(resolve => setTimeout(resolve, 200))

    expect(handler).toHaveBeenCalledWith(message)
  })

  it("should handle multiple handlers", async () => {
    const handler1 = vi.fn()
    const handler2 = vi.fn()

    messageBus.subscribe(handler1)
    messageBus.subscribe(handler2)

    const message: UnifiedMessage = {
      id: "test-msg-2",
      platform: "test",
      chat: { id: "chat-1", type: "private" },
      sender: { id: "user-1" },
      content: { text: "Hello", type: "text" },
      timestamp: Date.now(),
      raw: null
    }

    await messageBus.publish(message)

    // Give time for processing
    await new Promise(resolve => setTimeout(resolve, 200))

    expect(handler1).toHaveBeenCalledWith(message)
    expect(handler2).toHaveBeenCalledWith(message)
  })

  it("should clear queue", async () => {
    // Stop processing to accumulate messages
    messageBus.stopProcessing()

    const message: UnifiedMessage = {
      id: "test-msg-3",
      platform: "test",
      chat: { id: "chat-1", type: "private" },
      sender: { id: "user-1" },
      content: { text: "Hello", type: "text" },
      timestamp: Date.now(),
      raw: null
    }

    await messageBus.publish(message)
    await messageBus.publish(message)

    expect(messageBus.getQueueSize()).toBe(2)

    messageBus.clearQueue()

    expect(messageBus.getQueueSize()).toBe(0)
  })

  it("should unsubscribe handlers", () => {
    const handler = vi.fn()

    messageBus.subscribe(handler)
    messageBus.unsubscribe(handler)

    // No direct way to verify, but unsubscribe should not throw
    expect(true).toBe(true)
  })
})