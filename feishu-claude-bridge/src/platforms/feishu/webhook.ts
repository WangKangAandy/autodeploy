import * as crypto from "node:crypto"
import type { Request, Response } from "express"
import type { FeishuMessageEvent, FeishuUrlVerification, FeishuWebhookHeaders } from "./types.js"
import { logger } from "../../utils/logger.js"

/**
 * Webhook signature verification parameters
 */
export interface SignatureParams {
  timestamp: string
  nonce: string
  body: string
  signature: string
  encryptKey: string
}

/**
 * Feishu Webhook Handler
 *
 * Handles webhook verification and event parsing for Feishu
 */
export class FeishuWebhook {
  private encryptKey: string
  private verificationToken: string

  constructor(encryptKey: string, verificationToken: string) {
    this.encryptKey = encryptKey
    this.verificationToken = verificationToken
  }

  /**
   * Verify webhook signature
   */
  verifySignature(params: SignatureParams): boolean {
    const { timestamp, nonce, body, signature } = params
    const expectedSignature = this.generateSignature(timestamp, nonce, body)
    return signature === expectedSignature
  }

  /**
   * Generate signature for verification
   */
  private generateSignature(timestamp: string, nonce: string, body: string): string {
    const signStr = timestamp + nonce + body + this.encryptKey
    return crypto.createHash("sha256").update(signStr).digest("hex")
  }

  /**
   * Extract webhook headers from request
   */
  extractHeaders(req: Request): FeishuWebhookHeaders | null {
    const timestamp = req.headers["x-lark-request-timestamp"] as string
    const nonce = req.headers["x-lark-request-nonce"] as string
    const signature = req.headers["x-lark-signature"] as string

    if (!timestamp || !nonce || !signature) {
      return null
    }

    return { "x-lark-request-timestamp": timestamp, "x-lark-request-nonce": nonce, "x-lark-signature": signature }
  }

  /**
   * Handle URL verification challenge
   */
  handleUrlVerification(req: Request, res: Response): boolean {
    const body = req.body as FeishuUrlVerification

    if (body.type !== "url_verification") {
      return false
    }

    // Verify token if configured
    if (this.verificationToken && body.token !== this.verificationToken) {
      logger.warn(`Invalid verification token: ${body.token}`)
      res.status(401).json({ error: "Invalid verification token" })
      return true
    }

    logger.info("Feishu URL verification successful")
    res.json({ challenge: body.challenge })
    return true
  }

  /**
   * Parse message event from request
   */
  parseMessageEvent(req: Request): FeishuMessageEvent | null {
    const body = req.body

    // Check if it's a message event
    if (body?.header?.event_type !== "im.message.receive_v1") {
      return null
    }

    return body as FeishuMessageEvent
  }

  /**
   * Verify request signature
   */
  verifyRequest(req: Request): boolean {
    const headers = this.extractHeaders(req)
    if (!headers) {
      logger.warn("Missing webhook headers")
      return false
    }

    const body = JSON.stringify(req.body)
    const isValid = this.verifySignature({
      timestamp: headers["x-lark-request-timestamp"],
      nonce: headers["x-lark-request-nonce"],
      body,
      signature: headers["x-lark-signature"],
      encryptKey: this.encryptKey
    })

    if (!isValid) {
      logger.warn("Invalid webhook signature")
    }

    return isValid
  }
}