import * as crypto from "node:crypto"
import type { Request, Response } from "express"
import type { DingTalkMessageEvent, DingTalkEncryptedCallback } from "./types.js"
import { logger } from "../../utils/logger.js"

/**
 * DingTalk Webhook Handler
 *
 * Handles webhook verification and event parsing for DingTalk.
 * DingTalk uses AES encryption for callback data.
 */
export class DingTalkWebhook {
  private appKey: string
  private appSecret: string
  private aesKey: Buffer

  constructor(appKey: string, appSecret: string, encodingAESKey: string) {
    this.appKey = appKey
    this.appSecret = appSecret

    // Decode AES key (DingTalk provides base64 encoded key with = padding)
    // Need to decode and handle the key properly
    try {
      // The encodingAESKey is base64 encoded, add padding if needed
      let key = encodingAESKey
      if (key.length % 4 !== 0) {
        key = key + "=".repeat(4 - (key.length % 4))
      }
      this.aesKey = Buffer.from(key, "base64")
    } catch (error) {
      throw new Error(`Invalid encodingAESKey: ${error}`)
    }
  }

  /**
   * Verify webhook signature
   */
  verifySignature(timestamp: string, nonce: string, encrypt: string, signature: string): boolean {
    const arr = [this.appSecret, timestamp, nonce, encrypt].sort()
    const sha1 = crypto.createHash("sha1").update(arr.join("")).digest("hex")
    return sha1 === signature
  }

  /**
   * Decrypt AES encrypted content from DingTalk
   */
  decrypt(encrypted: string): string {
    try {
      const decipher = crypto.createDecipheriv(
        "aes-256-cbc",
        this.aesKey,
        this.aesKey.slice(0, 16)
      )
      decipher.setAutoPadding(false)

      let decrypted = Buffer.concat([
        decipher.update(Buffer.from(encrypted, "base64")),
        decipher.final(),
      ])

      // Remove PKCS7 padding
      const pad = decrypted[decrypted.length - 1]
      decrypted = decrypted.slice(0, decrypted.length - pad)

      // DingTalk format: random(16) + msg_len(4) + msg + appKey
      // Skip random bytes and length
      const msgLen = decrypted.readUInt32BE(16)
      const msg = decrypted.slice(20, 20 + msgLen).toString("utf8")

      return msg
    } catch (error) {
      logger.error(`DingTalk decrypt error: ${error}`)
      throw new Error(`Failed to decrypt DingTalk message: ${error}`)
    }
  }

  /**
   * Encrypt content for DingTalk (for URL verification response)
   */
  encrypt(content: string): string {
    // Generate random 16 bytes
    const random = crypto.randomBytes(16)

    // Content buffer
    const contentBuffer = Buffer.from(content, "utf8")
    const lenBuffer = Buffer.alloc(4)
    lenBuffer.writeUInt32BE(contentBuffer.length, 0)

    // AppKey buffer
    const appKeyBuffer = Buffer.from(this.appKey, "utf8")

    // Combine: random + len + content + appKey
    const data = Buffer.concat([random, lenBuffer, contentBuffer, appKeyBuffer])

    // PKCS7 padding
    const blockSize = 32
    const padLen = blockSize - (data.length % blockSize)
    const padded = Buffer.concat([data, Buffer.alloc(padLen, padLen)])

    // Encrypt
    const cipher = crypto.createCipheriv(
      "aes-256-cbc",
      this.aesKey,
      this.aesKey.slice(0, 16)
    )
    cipher.setAutoPadding(false)

    const encrypted = Buffer.concat([cipher.update(padded), cipher.final()])

    return encrypted.toString("base64")
  }

  /**
   * Handle URL verification challenge
   */
  handleUrlVerification(req: Request, res: Response): boolean {
    const body = req.body as DingTalkEncryptedCallback

    if (!body.encrypt) {
      return false
    }

    try {
      const decrypted = this.decrypt(body.encrypt)
      const event = JSON.parse(decrypted)

      if (event.Type === "url_verification") {
        logger.info("DingTalk URL verification request received")

        // Return the encrypted URL
        const response = JSON.stringify({ msg: event.Url })
        const encryptedResponse = this.encrypt(response)

        res.json({
          msg: encryptedResponse,
        })
        return true
      }
    } catch (error) {
      logger.error(`DingTalk URL verification error: ${error}`)
    }

    return false
  }

  /**
   * Parse message event from request
   */
  parseMessageEvent(req: Request): DingTalkMessageEvent | null {
    const body = req.body as DingTalkEncryptedCallback

    if (!body.encrypt) {
      return null
    }

    try {
      const decrypted = this.decrypt(body.encrypt)
      const event = JSON.parse(decrypted) as DingTalkMessageEvent

      // Skip URL verification
      if (event.Type === "url_verification") {
        return null
      }

      return event
    } catch (error) {
      logger.error(`Failed to parse DingTalk message: ${error}`)
      return null
    }
  }

  /**
   * Verify request signature
   */
  verifyRequest(req: Request): boolean {
    const body = req.body as DingTalkEncryptedCallback

    // Get signature from query params
    const signature = req.query["msg_signature"] as string
    const timestamp = req.query["timestamp"] as string
    const nonce = req.query["nonce"] as string

    if (!signature || !timestamp || !nonce || !body.encrypt) {
      logger.warn("Missing DingTalk webhook signature parameters")
      return false
    }

    const isValid = this.verifySignature(timestamp, nonce, body.encrypt, signature)

    if (!isValid) {
      logger.warn("Invalid DingTalk webhook signature")
    }

    return isValid
  }
}