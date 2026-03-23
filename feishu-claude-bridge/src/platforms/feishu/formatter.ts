import type {
  UnifiedMessage,
  SendOptions,
  Attachment,
  Mention
} from "../../core/types.js"
import type { FeishuMessageEvent } from "./types.js"

/**
 * Feishu Message Formatter
 *
 * Converts between Feishu message format and unified format
 */
export class FeishuFormatter {
  /**
   * Parse Feishu message event to unified format
   */
  parseToUnified(event: FeishuMessageEvent): UnifiedMessage {
    const { sender, message } = event.event

    const { text, attachments, mentions } = this.parseContent(
      message.content,
      message.message_type,
      message.mentions
    )

    return {
      id: message.message_id,
      platform: "feishu",
      chat: {
        id: message.chat_id,
        type: message.chat_type === "p2p" ? "private" : "group",
      },
      sender: {
        id: sender.sender_id.open_id,
      },
      content: {
        text,
        type: this.getMessageType(message.message_type),
        attachments,
        mentions,
      },
      timestamp: parseInt(message.create_time, 10),
      raw: event,
    }
  }

  /**
   * Parse message content based on type
   */
  private parseContent(
    content: string,
    messageType: string,
    mentions?: FeishuMessageEvent["event"]["message"]["mentions"]
  ): { text: string; attachments: Attachment[]; mentions: Mention[] } {
    let text = ""
    const attachments: Attachment[] = []
    const parsedMentions: Mention[] = mentions?.map((m) => ({
      id: m.id,
      idType: m.id_type,
      key: m.key,
      name: m.name,
    })) || []

    try {
      const parsed = JSON.parse(content)
      const actualType = parsed.type || messageType

      switch (actualType) {
        case "text":
          text = parsed.text || ""
          break

        case "post":
          text = this.parsePostContent(parsed.post)
          break

        case "image":
          if (parsed.image?.key) {
            attachments.push({ type: "image", content: parsed.image.key })
          }
          break

        case "file":
          if (parsed.file?.key) {
            attachments.push({
              type: "file",
              content: parsed.file.key,
              name: parsed.file.name,
            })
          }
          break

        case "audio":
          if (parsed.audio?.file_key) {
            attachments.push({ type: "audio", content: parsed.audio.file_key })
          }
          break

        case "video":
          if (parsed.video?.file_key) {
            attachments.push({ type: "video", content: parsed.video.file_key })
          }
          break

        case "media":
          if (parsed.media?.file_key) {
            attachments.push({ type: "video", content: parsed.media.file_key })
          }
          break

        default:
          text = content
      }
    } catch {
      text = content
    }

    return { text, attachments, mentions: parsedMentions }
  }

  /**
   * Parse post (rich text) content
   */
  private parsePostContent(post: any): string {
    const zhCnContent = post?.zh_cn || {}
    const title = zhCnContent.title || ""
    const contentList = zhCnContent.content || []

    const paragraphs = contentList.map((section: any) => {
      switch (section.tag) {
        case "text":
          return section.text || ""
        case "a":
          return `[${section.text || ""}](${section.href || ""})`
        case "img":
          return `[图片: ${section.img_key || ""}]`
        case "at":
          return `@${section.user_name || ""}`
        default:
          return ""
      }
    })

    return [title, ...paragraphs].filter(Boolean).join("\n")
  }

  /**
   * Get unified message type from Feishu type
   */
  private getMessageType(feishuType: string): "text" | "image" | "file" | "audio" | "video" | "mixed" {
    const typeMap: Record<string, "text" | "image" | "file" | "audio" | "video" | "mixed"> = {
      text: "text",
      post: "text",
      image: "image",
      file: "file",
      audio: "audio",
      video: "video",
      media: "video",
    }
    return typeMap[feishuType] || "text"
  }

  /**
   * Format message for sending via Feishu API
   */
  formatForSend(content: string, options?: SendOptions): { msgType: string; content: string } {
    switch (options?.type) {
      case "markdown":
        return {
          msgType: "post",
          content: JSON.stringify({
            zh_cn: {
              title: options.card?.title || "",
              content: this.markdownToFeishuPost(content),
            },
          }),
        }

      case "card":
        return {
          msgType: "interactive",
          content: JSON.stringify(this.createCard(content, options.card)),
        }

      case "image":
        return {
          msgType: "image",
          content: JSON.stringify({ image_key: content }),
        }

      case "text":
      default:
        return {
          msgType: "text",
          content: JSON.stringify({ text: content }),
        }
    }
  }

  /**
   * Convert markdown to Feishu post format
   */
  private markdownToFeishuPost(markdown: string): any[] {
    // Simple conversion - split by newlines
    const lines = markdown.split("\n")
    return lines.map((line) => ({
      tag: "text",
      text: line,
    }))
  }

  /**
   * Create Feishu interactive card
   */
  private createCard(content: string, card?: import("../../core/types.js").CardContent): any {
    return {
      type: "template",
      data: {
        template_type: "blue",
        card_data: {
          title: card?.title || "",
          content: content,
          buttons: card?.buttons?.map((btn) => ({
            text: btn.label,
            url: btn.action,
          })) || [],
        },
      },
    }
  }

  /**
   * Clean mentions from message content
   */
  cleanMentions(content: string): string {
    return content.replace(/<at[^>]*>.*?<\/at>/g, "").trim()
  }

  /**
   * Check if bot is mentioned
   */
  isBotMentioned(message: UnifiedMessage, botOpenId: string): boolean {
    return message.content.mentions?.some(
      (m) => m.id === botOpenId && m.idType === "open_id"
    ) || false
  }

  /**
   * Check if message is text type
   */
  isTextMessage(message: UnifiedMessage): boolean {
    return message.content.type === "text"
  }

  /**
   * Check if message is empty (after cleaning mentions)
   */
  isEmptyMessage(message: UnifiedMessage): boolean {
    return !this.cleanMentions(message.content.text).trim() && !message.content.attachments?.length
  }
}