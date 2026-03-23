import type {
  UnifiedMessage,
  SendOptions,
  Attachment,
  Mention
} from "../../core/types.js"
import type { DingTalkMessageEvent } from "./types.js"

/**
 * DingTalk Message Formatter
 *
 * Converts between DingTalk message format and unified format
 */
export class DingTalkFormatter {
  /**
   * Parse DingTalk message event to unified format
   */
  parseToUnified(event: DingTalkMessageEvent): UnifiedMessage {
    const isGroup = event.ConversationType === "2"
    const mentions: Mention[] = event.AtUsers?.map((u) => ({
      id: u.DingTalkId,
      idType: "dingtalk_id",
    })) || []

    const attachments: Attachment[] = []

    // Parse content based on message type
    let text = ""
    let contentType: "text" | "image" | "file" | "audio" | "video" | "mixed" = "text"

    switch (event.MsgType) {
      case "text":
        text = event.Content || ""
        break

      case "picture":
        contentType = "image"
        attachments.push({ type: "image", content: event.Content })
        break

      case "file":
        contentType = "file"
        attachments.push({ type: "file", content: event.Content })
        break

      case "audio":
        contentType = "audio"
        attachments.push({ type: "audio", content: event.Content })
        break

      case "video":
        contentType = "video"
        attachments.push({ type: "video", content: event.Content })
        break

      default:
        text = event.Content || ""
    }

    return {
      id: event.MsgId,
      platform: "dingtalk",
      chat: {
        id: event.ConversationId,
        type: isGroup ? "group" : "private",
        name: event.ConversationTitle,
      },
      sender: {
        id: event.SenderId,
        name: event.SenderNick,
      },
      content: {
        text,
        type: contentType,
        attachments,
        mentions,
      },
      timestamp: parseInt(event.CreateTime, 10) * 1000,
      raw: event,
    }
  }

  /**
   * Format message for sending via DingTalk API
   */
  formatForSend(
    content: string,
    options?: SendOptions
  ): { msgType: string; content: unknown } {
    switch (options?.type) {
      case "markdown":
        return {
          msgType: "markdown",
          content: {
            title: options.card?.title || "消息",
            text: this.formatMarkdown(content),
          },
        }

      case "card":
        return {
          msgType: "actionCard",
          content: this.createActionCard(content, options.card),
        }

      case "image":
        return {
          msgType: "image",
          content: {
            media_id: content,
          },
        }

      case "text":
      default:
        return {
          msgType: "text",
          content: {
            content: this.formatText(content, options?.mentions),
          },
        }
    }
  }

  /**
   * Format text content with mentions
   */
  private formatText(text: string, mentions?: string[]): string {
    if (!mentions || mentions.length === 0) {
      return text
    }

    // DingTalk uses @username format
    const mentionText = mentions.map((id) => `@${id}`).join(" ")
    return `${mentionText} ${text}`
  }

  /**
   * Format markdown for DingTalk
   */
  private formatMarkdown(content: string): string {
    // DingTalk has limited markdown support
    // Convert common formats
    return content
      .replace(/\*\*(.+?)\*\*/g, "**$1**") // Bold
      .replace(/\*(.+?)\*/g, "*$1*") // Italic
      .replace(/`(.+?)`/g, "`$1`") // Code
      .replace(/\n/g, "\n\n") // Paragraphs
  }

  /**
   * Create DingTalk action card
   */
  private createActionCard(
    content: string,
    card?: import("../../core/types.js").CardContent
  ): unknown {
    const buttons = card?.buttons || []

    if (buttons.length === 1) {
      // Single button card
      return {
        title: card?.title || "",
        text: content,
        singleTitle: buttons[0].label,
        singleURL: buttons[0].action,
      }
    }

    // Multi-button card
    return {
      title: card?.title || "",
      text: content,
      btnOrientation: "0",
      btns: buttons.map((btn) => ({
        title: btn.label,
        actionURL: btn.action,
      })),
    }
  }

  /**
   * Clean mentions from message content
   */
  cleanMentions(content: string): string {
    return content.replace(/@\S+\s?/g, "").trim()
  }

  /**
   * Check if bot is mentioned
   */
  isBotMentioned(message: UnifiedMessage, botId: string): boolean {
    return message.content.mentions?.some((m) => m.id === botId) || false
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