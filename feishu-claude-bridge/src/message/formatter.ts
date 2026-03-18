import type { MessageAttachment } from "./types.js"

export interface FormattedMessage {
  msgType: "text" | "interactive" | "image" | "file" | "post"
  content: string
}

export class MessageFormatter {
  formatAsText(content: string): FormattedMessage {
    return {
      msgType: "text",
      content: JSON.stringify({
        text: content
      })
    }
  }

  formatAsPost(content: string, attachments?: MessageAttachment[]): FormattedMessage {
    const contentList: any[] = []

    // Add text content
    if (content.trim()) {
      const lines = content.split('\n')
      lines.forEach(line => {
        if (line.trim()) {
          contentList.push({
            tag: "text",
            text: line
          })
        }
      })
    }

    // Add attachments
    attachments?.forEach(attachment => {
      if (attachment.type === "image" && attachment.content) {
        contentList.push({
          tag: "img",
          img_key: attachment.content,
          alt: {
            tag: "plain_text",
            content: attachment.name || "图片"
          }
        })
      } else if (attachment.type === "url" && attachment.content) {
        contentList.push({
          tag: "a",
          text: attachment.name || attachment.content,
          href: attachment.content
        })
      }
    })

    return {
      msgType: "post",
      content: JSON.stringify({
        post: {
          zh_cn: {
            title: "",
            content: contentList
          }
        }
      })
    }
  }

  formatAsMarkdown(content: string): FormattedMessage {
    return {
      msgType: "interactive",
      content: JSON.stringify({
        config: {
          wide_screen_mode: true
        },
        elements: [
          {
            tag: "div",
            text: {
              tag: "lark_md",
              content: content
            }
          }
        ]
      })
    }
  }

  formatAsCard(
    title: string,
    content: string,
    timestamp?: string
  ): FormattedMessage {
    const elements: any[] = [
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: content
        }
      }
    ]

    if (timestamp) {
      elements.push({
        tag: "div",
        text: {
          tag: "plain_text",
          content: `时间: ${timestamp}`
        }
      })
    }

    return {
      msgType: "interactive",
      content: JSON.stringify({
        config: {
          wide_screen_mode: true
        },
        header: {
          template: "blue",
          title: {
            content: title,
            tag: "plain_text"
          }
        },
        elements
      })
    }
  }

  escapeMarkdown(text: string): string {
    return text
      .replace(/\\/g, "\\\\")
      .replace(/\*/g, "\\*")
      .replace(/_/g, "\\_")
      .replace(/\[/g, "\\[")
      .replace(/\]/g, "\\]")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)")
      .replace(/#/g, "\\#")
      .replace(/\+/g, "\\+")
      .replace(/-/g, "\\-")
      .replace(/\./g, "\\.")
      .replace(/!/g, "\\!")
      .replace(/\|/g, "\\|")
  }

  truncateText(text: string, maxLength: number = 2000): string {
    if (text.length <= maxLength) {
      return text
    }
    return text.substring(0, maxLength - 3) + "..."
  }

  formatAttachments(attachments: MessageAttachment[]): string {
    if (!attachments || attachments.length === 0) {
      return ""
    }

    const parts: string[] = []

    attachments.forEach((attachment, index) => {
      if (attachment.type === "image") {
        parts.push(`[图片 ${index + 1}]`)
      } else if (attachment.type === "file") {
        parts.push(`[文件: ${attachment.name || "未知文件"}]`)
      } else if (attachment.type === "video") {
        parts.push(`[视频 ${index + 1}]`)
      } else if (attachment.type === "audio") {
        parts.push(`[音频 ${index + 1}]`)
      } else if (attachment.type === "url") {
        parts.push(`[链接: ${attachment.name || attachment.content}]`)
      } else {
        parts.push(`[${attachment.type} ${index + 1}]`)
      }
    })

    return parts.join("\n")
  }
}