import type {
  FeishuMessageEvent,
  ParsedMessage,
  MessageAttachment
} from "./types.js"
import { v4 as uuidv4 } from "uuid"
import * as fs from "node:fs"
import * as path from "node:path"

export class MessageProcessor {
  private messageQueueDir: string
  private responseQueueDir: string

  constructor(messageQueueDir: string, responseQueueDir: string) {
    this.messageQueueDir = messageQueueDir
    this.responseQueueDir = responseQueueDir
    this.ensureDirectories()
  }

  private ensureDirectories(): void {
    if (!fs.existsSync(this.messageQueueDir)) {
      fs.mkdirSync(this.messageQueueDir, { recursive: true })
    }
    if (!fs.existsSync(this.responseQueueDir)) {
      fs.mkdirSync(this.responseQueueDir, { recursive: true })
    }
  }

  parseEvent(event: FeishuMessageEvent): ParsedMessage {
    const { sender, message } = event.event

    let content = ""
    let messageType = message.message_type
    const attachments: MessageAttachment[] = []

    try {
      const parsedContent = JSON.parse(message.content)
      messageType = parsedContent.type || message.message_type

      // Handle different message types
      // 飞书文本消息格式: {"text":"消息内容"}
      if (messageType === "text") {
        content = parsedContent.text || ""
      } else if (messageType === "post") {
        content = this.parsePostContent(parsedContent.post)
      } else if (messageType === "image") {
        const imageKey = parsedContent.image?.key
        if (imageKey) {
          attachments.push({
            type: "image",
            content: imageKey
          })
        }
      } else if (messageType === "file") {
        const fileKey = parsedContent.file?.key
        const fileName = parsedContent.file?.name
        if (fileKey) {
          attachments.push({
            type: "file",
            content: fileKey,
            name: fileName
          })
        }
      } else if (messageType === "audio") {
        const fileKey = parsedContent.audio?.file_key
        if (fileKey) {
          attachments.push({
            type: "audio",
            content: fileKey
          })
        }
      } else if (messageType === "video") {
        const fileKey = parsedContent.video?.file_key
        if (fileKey) {
          attachments.push({
            type: "video",
            content: fileKey
          })
        }
      } else if (messageType === "media") {
        const fileKey = parsedContent.media?.file_key
        if (fileKey) {
          attachments.push({
            type: "video",
            content: fileKey
          })
        }
      }
    } catch (error) {
      content = message.content
    }

    return {
      messageId: message.message_id,
      chatId: message.chat_id,
      chatType: message.chat_type,
      senderId: sender.sender_id.open_id,
      messageType,
      content,
      attachments,
      mentions: (message.mentions || []).map((mention) => ({
        id: mention.id,
        idType: mention.id_type,
        key: mention.key,
        name: mention.name
      })),
      timestamp: message.create_time
    }
  }

  private parsePostContent(post: any): string {
    const zhCnContent = post?.zh_cn || {}
    const title = zhCnContent.title || ""
    const contentList = zhCnContent.content || []

    const paragraphs = contentList.map((section: any) => {
      if (section.tag === "text") {
        return section.text || ""
      } else if (section.tag === "a") {
        return `[${section.text || ""}](${section.href || ""})`
      } else if (section.tag === "img") {
        return `[图片: ${section.img_key || ""}]`
      } else if (section.tag === "at") {
        return `@${section.user_name || ""}`
      }
      return ""
    })

    return [title, ...paragraphs].filter(Boolean).join("\n")
  }

  extractMentionedBot(message: ParsedMessage, botOpenId: string): boolean {
    return message.mentions.some(
      (mention) => mention.id === botOpenId && mention.idType === "open_id"
    )
  }

  cleanMentions(content: string): string {
    return content.replace(/<at[^>]*>.*?<\/at>/g, "").trim()
  }

  isTextMessage(message: ParsedMessage): boolean {
    return message.messageType === "text" || message.messageType === "post"
  }

  isEmptyMessage(message: ParsedMessage): boolean {
    return !this.cleanMentions(message.content).trim() && !message.attachments?.length
  }

  queueForClaude(message: ParsedMessage, _botOpenId: string): string {
    const requestId = uuidv4()
    const claudeRequest = {
      requestId,
      userId: message.senderId,
      chatId: message.chatId,
      chatType: message.chatType,
      senderId: message.senderId,
      senderName: message.mentions.find(m => m.id === message.senderId)?.name,
      message: this.cleanMentions(message.content),
      attachments: message.attachments || [],
      timestamp: message.timestamp
    }

    const filename = `${requestId}.json`
    const filepath = path.join(this.messageQueueDir, filename)
    fs.writeFileSync(filepath, JSON.stringify(claudeRequest, null, 2))

    return requestId
  }

  pollForResponse(requestId: string, timeout: number = 120000): Promise<string | null> {
    return new Promise((resolve) => {
      const startTime = Date.now()
      const filepath = path.join(this.responseQueueDir, `${requestId}.json`)

      const checkForResponse = () => {
        if (Date.now() - startTime > timeout) {
          resolve(null)
          return
        }

        if (fs.existsSync(filepath)) {
          try {
            const response = JSON.parse(fs.readFileSync(filepath, "utf-8"))
            fs.unlinkSync(filepath) // Remove after reading
            resolve(response.content || null)
          } catch (error) {
            // Invalid response, try again
          }
        }

        setTimeout(checkForResponse, 1000) // Check every second
      }

      checkForResponse()
    })
  }

  getMessageQueue(): string[] {
    const files = fs.readdirSync(this.messageQueueDir)
    return files.filter(f => f.endsWith('.json'))
  }

  dequeueMessage(requestId: string): any | null {
    const filepath = path.join(this.messageQueueDir, `${requestId}.json`)
    if (fs.existsSync(filepath)) {
      try {
        const content = fs.readFileSync(filepath, "utf-8")
        fs.unlinkSync(filepath)
        return JSON.parse(content)
      } catch (error) {
        return null
      }
    }
    return null
  }

  sendResponse(requestId: string, content: string): boolean {
    const filepath = path.join(this.responseQueueDir, `${requestId}.json`)
    try {
      fs.writeFileSync(filepath, JSON.stringify({ content }, null, 2))
      return true
    } catch (error) {
      return false
    }
  }
}