export interface FeishuMessageEvent {
  header: {
    event_id: string
    event_type: string
    tenant_key: string
    app_id: string
    create_time: string
    token: string
  }
  event: {
    sender: {
      sender_id: {
        open_id: string
        union_id?: string
        user_id?: string | null
      }
      sender_type: "user" | "app"
      tenant_key?: string
    }
    message: {
      message_id: string
      root_id?: string | null
      parent_id?: string | null
      create_time: string
      chat_id: string
      chat_type: "group" | "p2p"
      message_type: string
      content: string
      mentions?: Array<{
        id: string
        id_type: string
        key: string
        name: string
        tenant_key?: string
      }>
      updated_by?: {
        id: string
        id_type: string
      }
      update_time?: string
    }
  }
}

export interface ParsedMessage {
  messageId: string
  chatId: string
  chatType: "group" | "p2p"
  senderId: string
  senderName?: string
  messageType: string
  content: string
  attachments?: MessageAttachment[]
  mentions: Array<{
    id: string
    idType: string
    key: string
    name: string
  }>
  timestamp: string
}

export interface MessageAttachment {
  type: "file" | "image" | "video" | "audio" | "document" | "bitable" | "docx" | "spreadsheet" | "url"
  content: string
  name?: string
  size?: number
  mimeType?: string
}

export interface QueuedMessage {
  id: string
  type: "user_message" | "bot_response"
  timestamp: number
  data: {
    userId: string
    chatId: string
    chatType: "group" | "p2p"
    message: ParsedMessage
  }
}

export interface ClaudeRequest {
  requestId: string
  userId: string
  chatId: string
  chatType: "group" | "p2p"
  senderId: string
  senderName?: string
  message: string
  attachments: MessageAttachment[]
  timestamp: string
}

export interface ClaudeResponse {
  requestId: string
  content: string
  attachments?: MessageAttachment[]
}