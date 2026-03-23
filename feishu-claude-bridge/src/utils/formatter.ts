import type { ClaudeRequest } from "../message/types.js"

/**
 * Format a request for Claude processing
 */
export function formatRequestForClaude(request: ClaudeRequest): string {
  let message = ""

  // Add context header
  message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`
  message += `来自飞书的消息\n`
  message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`

  // Add user info
  message += `👤 用户: ${request.senderName || request.userId}\n`
  message += `💬 会话: ${request.chatType === "group" ? "群聊" : "私聊"}\n`
  message += `⏰ 时间: ${request.timestamp}\n\n`

  // Add message content
  if (request.message) {
    message += `📝 消息:\n${request.message}\n\n`
  }

  // Add attachments
  if (request.attachments && request.attachments.length > 0) {
    message += `📎 附件:\n`
    request.attachments.forEach((att, index) => {
      const typeIcons: Record<string, string> = {
        image: "🖼️",
        file: "📄",
        video: "🎥",
        audio: "🎵",
        document: "📋",
        bitable: "📊",
        docx: "📝",
        spreadsheet: "📈",
        url: "🔗"
      }
      const icon = typeIcons[att.type] || "📦"
      message += `  ${index + 1}. ${icon} ${att.name || att.content}\n`
    })
    message += "\n"
  }

  // Add instructions
  message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`
  message += `请回复用户的消息。如果包含附件，请先询问用户是否需要分析附件。\n`
  message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`

  return message
}