import { describe, it, expect } from "vitest"
import { FeishuFormatter } from "../../../src/platforms/feishu/formatter.js"
import type { FeishuMessageEvent } from "../../../src/platforms/feishu/types.js"

describe("FeishuFormatter", () => {
  const formatter = new FeishuFormatter()

  describe("parseToUnified", () => {
    it("should parse private text message", () => {
      const event: FeishuMessageEvent = {
        header: {
          event_id: "evt-1",
          event_type: "im.message.receive_v1",
          tenantkey: "tenant-1",
          app_id: "app-1",
          create_time: "1700000000000",
          token: "token-1"
        },
        event: {
          sender: {
            sender_id: { open_id: "ou_xxx" },
            sender_type: "user"
          },
          message: {
            message_id: "msg-1",
            create_time: "1700000000000",
            chat_id: "oc_xxx",
            chat_type: "p2p",
            message_type: "text",
            content: JSON.stringify({ text: "Hello, bot!" }),
            mentions: []
          }
        }
      }

      const result = formatter.parseToUnified(event)

      expect(result.id).toBe("msg-1")
      expect(result.platform).toBe("feishu")
      expect(result.chat.type).toBe("private")
      expect(result.sender.id).toBe("ou_xxx")
      expect(result.content.text).toBe("Hello, bot!")
      expect(result.content.type).toBe("text")
    })

    it("should parse group message with mentions", () => {
      const event: FeishuMessageEvent = {
        header: {
          event_id: "evt-2",
          event_type: "im.message.receive_v1",
          tenantkey: "tenant-1",
          app_id: "app-1",
          create_time: "1700000000000",
          token: "token-1"
        },
        event: {
          sender: {
            sender_id: { open_id: "ou_user" },
            sender_type: "user"
          },
          message: {
            message_id: "msg-2",
            create_time: "1700000000000",
            chat_id: "oc_group",
            chat_type: "group",
            message_type: "text",
            content: JSON.stringify({ text: "@Bot Hello!" }),
            mentions: [
              { id: "ou_bot", id_type: "open_id", key: "@_user_1", name: "Bot" }
            ]
          }
        }
      }

      const result = formatter.parseToUnified(event)

      expect(result.chat.type).toBe("group")
      expect(result.content.mentions).toHaveLength(1)
      expect(result.content.mentions?.[0].id).toBe("ou_bot")
    })

    it("should parse post message", () => {
      const event: FeishuMessageEvent = {
        header: {
          event_id: "evt-3",
          event_type: "im.message.receive_v1",
          tenantkey: "tenant-1",
          app_id: "app-1",
          create_time: "1700000000000",
          token: "token-1"
        },
        event: {
          sender: {
            sender_id: { open_id: "ou_xxx" },
            sender_type: "user"
          },
          message: {
            message_id: "msg-3",
            create_time: "1700000000000",
            chat_id: "oc_xxx",
            chat_type: "p2p",
            message_type: "post",
            content: JSON.stringify({
              post: {
                zh_cn: {
                  title: "Title",
                  content: [
                    { tag: "text", text: "Hello" },
                    { tag: "a", text: "Link", href: "https://example.com" }
                  ]
                }
              }
            }),
            mentions: []
          }
        }
      }

      const result = formatter.parseToUnified(event)

      expect(result.content.text).toContain("Title")
      expect(result.content.text).toContain("Hello")
      expect(result.content.text).toContain("[Link](https://example.com)")
    })

    it("should parse image message", () => {
      const event: FeishuMessageEvent = {
        header: {
          event_id: "evt-4",
          event_type: "im.message.receive_v1",
          tenantkey: "tenant-1",
          app_id: "app-1",
          create_time: "1700000000000",
          token: "token-1"
        },
        event: {
          sender: {
            sender_id: { open_id: "ou_xxx" },
            sender_type: "user"
          },
          message: {
            message_id: "msg-4",
            create_time: "1700000000000",
            chat_id: "oc_xxx",
            chat_type: "p2p",
            message_type: "image",
            content: JSON.stringify({ image: { key: "img_key_xxx" } }),
            mentions: []
          }
        }
      }

      const result = formatter.parseToUnified(event)

      expect(result.content.type).toBe("image")
      expect(result.content.attachments).toHaveLength(1)
      expect(result.content.attachments?.[0].type).toBe("image")
      expect(result.content.attachments?.[0].content).toBe("img_key_xxx")
    })
  })

  describe("formatForSend", () => {
    it("should format text message", () => {
      const result = formatter.formatForSend("Hello")

      expect(result.msgType).toBe("text")
      expect(JSON.parse(result.content)).toEqual({ text: "Hello" })
    })

    it("should format markdown message", () => {
      const result = formatter.formatForSend("# Title\nContent", { type: "markdown" })

      expect(result.msgType).toBe("post")
      const parsed = JSON.parse(result.content)
      expect(parsed.zh_cn.title).toBe("")
    })

    it("should format card message", () => {
      const result = formatter.formatForSend("Card content", {
        type: "card",
        card: { title: "Card Title", buttons: [{ label: "Click", action: "https://example.com" }] }
      })

      expect(result.msgType).toBe("interactive")
      const parsed = JSON.parse(result.content)
      expect(parsed.type).toBe("template")
    })
  })

  describe("isBotMentioned", () => {
    it("should return true when bot is mentioned", () => {
      const message = {
        id: "msg-1",
        platform: "feishu" as const,
        chat: { id: "chat-1", type: "group" as const },
        sender: { id: "user-1" },
        content: {
          text: "@Bot hello",
          type: "text" as const,
          mentions: [{ id: "bot-open-id", idType: "open_id" }]
        },
        timestamp: Date.now(),
        raw: null
      }

      expect(formatter.isBotMentioned(message, "bot-open-id")).toBe(true)
    })

    it("should return false when bot is not mentioned", () => {
      const message = {
        id: "msg-1",
        platform: "feishu" as const,
        chat: { id: "chat-1", type: "group" as const },
        sender: { id: "user-1" },
        content: {
          text: "hello",
          type: "text" as const,
          mentions: []
        },
        timestamp: Date.now(),
        raw: null
      }

      expect(formatter.isBotMentioned(message, "bot-open-id")).toBe(false)
    })
  })

  describe("isEmptyMessage", () => {
    it("should return true for empty text", () => {
      const message = {
        id: "msg-1",
        platform: "feishu" as const,
        chat: { id: "chat-1", type: "private" as const },
        sender: { id: "user-1" },
        content: { text: "", type: "text" as const },
        timestamp: Date.now(),
        raw: null
      }

      expect(formatter.isEmptyMessage(message)).toBe(true)
    })

    it("should return false for text with content", () => {
      const message = {
        id: "msg-1",
        platform: "feishu" as const,
        chat: { id: "chat-1", type: "private" as const },
        sender: { id: "user-1" },
        content: { text: "Hello", type: "text" as const },
        timestamp: Date.now(),
        raw: null
      }

      expect(formatter.isEmptyMessage(message)).toBe(false)
    })
  })
})