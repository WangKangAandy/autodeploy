/**
 * Credential Parser - Parse SSH credentials from user messages
 */
import { logger } from "./utils/logger.js"

export interface ParsedCredentials {
  host: string
  user: string
  password: string
  port?: string
}

/**
 * Parse SSH credentials from user message
 * Supports formats like:
 * - user@host 密码password
 * - user@host password
 * - 访问 user@host，密码 password
 */
export function parseCredentials(message: string): ParsedCredentials | null {
  // Pattern 1: user@host 密码xxx or user@host password xxx
  const pattern1 = /(\w+)@([\d.]+)\s*(?:密码|password|passwd)\s*[：:!]?\s*(\S+)/i

  // Pattern 2: host user xxx password xxx
  const pattern2 = /(?:访问|连接|登录)?\s*[\@]?\s*(\w+)\s*[\@]\s*([\d.]+).*?(?:密码|password|passwd)\s*[：:!]?\s*(\S+)/i

  // Pattern 3: user@192.168.x.x with explicit port
  const pattern3 = /(\w+)@([\d.]+):?(\d+)?\s*(?:密码|password|passwd)?\s*[：:!]?\s*(\S+)?/i

  let match = message.match(pattern1)
  if (match) {
    const creds = {
      user: match[1],
      host: match[2],
      password: match[3],
    }
    logger.info(`Parsed credentials: ${creds.user}@${creds.host}`)
    return creds
  }

  match = message.match(pattern2)
  if (match) {
    const creds = {
      user: match[1],
      host: match[2],
      password: match[3],
    }
    logger.info(`Parsed credentials: ${creds.user}@${creds.host}`)
    return creds
  }

  match = message.match(pattern3)
  if (match && match[4]) {
    const creds: ParsedCredentials = {
      user: match[1],
      host: match[2],
      password: match[4],
    }
    if (match[3]) {
      creds.port = match[3]
    }
    logger.info(`Parsed credentials: ${creds.user}@${creds.host}:${creds.port || 22}`)
    return creds
  }

  return null
}

/**
 * Extract specific SSH info from message
 */
export function extractHost(message: string): string | null {
  const match = message.match(/@?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/)
  return match ? match[1] : null
}

export function extractUser(message: string): string | null {
  const match = message.match(/(\w+)@/)
  return match ? match[1] : null
}

export function extractPassword(message: string): string | null {
  // Match password after 密码/password/passwd keywords
  const match = message.match(/(?:密码|password|passwd)\s*[：:!]?\s*(\S+)/i)
  return match ? match[1] : null
}