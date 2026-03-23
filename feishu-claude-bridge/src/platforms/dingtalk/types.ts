/**
 * DingTalk (钉钉) specific types
 *
 * These types match the DingTalk Open Platform API structures
 */

/** DingTalk message event structure (from callback) */
export interface DingTalkMessageEvent {
  /** Event type for URL verification */
  Type?: "url_verification"

  /** URL for verification response */
  Url?: string

  /** Conversation type: 1 = single, 2 = group */
  ConversationType: "1" | "2"

  /** Conversation ID */
  ConversationId: string

  /** Chat title (for group) */
  ConversationTitle?: string

  /** Sender ID */
  SenderId: string

  /** Sender nick name */
  SenderNick?: string

  /** Sender corp ID */
  SenderCorpId?: string

  /** Message ID */
  MsgId: string

  /** Message type */
  MsgType: string

  /** Message content (varies by type) */
  Content: string

  /** Create time */
  CreateTime: string

  /** At users list */
  AtUsers?: Array<{
    DingTalkId: string
    StaffId?: string
  }>
}

/** DingTalk encrypted callback */
export interface DingTalkEncryptedCallback {
  encrypt: string
  msg_signature: string
  timeStamp: string
  nonce: string
}

/** DingTalk URL verification response */
export interface DingTalkUrlVerification {
  Type: "url_verification"
  Url: string
}

/** DingTalk API response structure */
export interface DingTalkApiResponse<T = unknown> {
  errcode: number
  errmsg?: string
  result?: T
}

/** DingTalk access token response */
export interface DingTalkTokenResponse {
  access_token: string
  expires_in: number
}

/** DingTalk user info */
export interface DingTalkUserInfo {
  userid: string
  name?: string
  avatar?: string
  mobile?: string
  email?: string
}

/** DingTalk robot info */
export interface DingTalkRobotInfo {
  robot_code: string
  robot_name?: string
}

/** DingTalk send message request */
export interface DingTalkSendMessageRequest {
  /** Robot code */
  robotCode?: string

  /** User IDs (for private chat) */
  userIds?: string[]

  /** Chat ID (for group chat) */
  chatId?: string

  /** Message type */
  msgtype: string

  /** Message content (varies by type) */
  [key: string]: unknown
}

/** DingTalk text message content */
export interface DingTalkTextContent {
  content: string
}

/** DingTalk markdown message content */
export interface DingTalkMarkdownContent {
  title: string
  text: string
}

/** DingTalk action card content */
export interface DingTalkActionCardContent {
  title: string
  text: string
  btnOrientation?: "0" | "1"
  singleTitle?: string
  singleURL?: string
  btns?: Array<{
    title: string
    actionURL: string
  }>
}

/** DingTalk webhook headers */
export interface DingTalkWebhookHeaders {
  "timestamp": string
  "sign": string
}

/**
 * Extended message types for DingTalk Stream mode
 */
export type DingTalkStreamMessageType =
  | "text"
  | "interactiveCard"
  | "richText"
  | "picture"
  | "file"
  | "audio"
  | "video"
  | string

/**
 * Extended RobotMessage type for Stream mode
 * Supports additional message types not in the official SDK types
 */
export interface ExtendedRobotMessage {
  conversationId: string
  chatbotCorpId: string
  chatbotUserId: string
  msgId: string
  senderNick: string
  isAdmin: boolean
  senderStaffId: string
  sessionWebhookExpiredTime: number
  createAt: number
  senderCorpId: string
  conversationType: "1" | "2"
  senderId: string
  sessionWebhook: string
  robotCode: string
  msgtype: DingTalkStreamMessageType

  // Text message content
  text?: {
    content: string
  }

  // Interactive card content (document links, etc.)
  content?: {
    biz_custom_action_url?: string
    downloadURL?: string
    picURL?: string
    richText?: string
    fileName?: string
    [key: string]: unknown
  }

  // Additional fields
  [key: string]: unknown
}