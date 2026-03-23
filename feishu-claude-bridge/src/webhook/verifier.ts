import * as crypto from "node:crypto"

export interface WebhookSignatureParams {
  timestamp: string
  nonce: string
  body: string
  encryptKey: string
  signature: string
}

export class WebhookVerifier {
  private encryptKey: string

  constructor(encryptKey: string) {
    this.encryptKey = encryptKey
  }

  verify(params: WebhookSignatureParams): boolean {
    const { timestamp, nonce, body, signature } = params
    const expectedSignature = this.generateSignature(timestamp, nonce, body)

    return signature === expectedSignature
  }

  generateSignature(timestamp: string, nonce: string, body: string): string {
    const signStr = timestamp + nonce + body + this.encryptKey
    return crypto.createHash("sha256").update(signStr).digest("hex")
  }
}