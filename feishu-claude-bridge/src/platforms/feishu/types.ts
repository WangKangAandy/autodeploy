/**
 * Feishu (Lark) specific types
 *
 * These types match the Feishu Open Platform API structures
 */

/** Feishu message event structure */
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

/** URL verification request from Feishu */
export interface FeishuUrlVerification {
  type: "url_verification"
  challenge: string
  token: string
}

/** Feishu API response structure */
export interface FeishuApiResponse<T = unknown> {
  code: number
  msg?: string
  data?: T
}

/** Feishu bot info */
export interface FeishuBotInfo {
  open_id: string
  union_id?: string
  app_id?: string
}

/** Feishu message content types */
export interface FeishuTextContent {
  text: string
}

export interface FeishuPostContent {
  post: {
    zh_cn?: {
      title?: string
      content: Array<{
        tag: string
        text?: string
        href?: string
        img_key?: string
        user_name?: string
      }>
    }
  }
}

export interface FeishuImageContent {
  image: {
    key: string
  }
}

export interface FeishuFileContent {
  file: {
    key: string
    name?: string
  }
}

export interface FeishuAudioContent {
  audio: {
    file_key: string
  }
}

export interface FeishuVideoContent {
  video: {
    file_key: string
  }
}

export interface FeishuMediaContent {
  media: {
    file_key: string
  }
}

/** Feishu app access token response */
export interface FeishuTokenResponse {
  app_access_token: string
  expire: number
}

/** Feishu send message request */
export interface FeishuSendMessageRequest {
  receive_id: string
  msg_type: string
  content: string
}

/** Feishu webhook headers */
export interface FeishuWebhookHeaders {
  "x-lark-request-timestamp": string
  "x-lark-request-nonce": string
  "x-lark-signature": string
}