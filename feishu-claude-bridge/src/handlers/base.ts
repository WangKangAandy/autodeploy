import type { FeishuMessageEvent } from "../message/types.js"
import type { MessageProcessor } from "../message/processor.js"
import type { MessageFormatter } from "../message/formatter.js"

export abstract class BaseHandler {
  constructor(
    protected messageProcessor: MessageProcessor,
    protected messageFormatter: MessageFormatter,
    protected botOpenId: string
  ) {}

  abstract handle(event: FeishuMessageEvent): Promise<void>
}