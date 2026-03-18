type LogLevel = "info" | "warn" | "error" | "debug"

class Logger {
  private prefix = "[FeishuBridge]"

  info(message: string, ...args: unknown[]): void {
    this.log("info", message, ...args)
  }

  warn(message: string, ...args: unknown[]): void {
    this.log("warn", message, ...args)
  }

  error(message: string, ...args: unknown[]): void {
    this.log("error", message, ...args)
  }

  debug(message: string, ...args: unknown[]): void {
    if (process.env.NODE_ENV === "development") {
      this.log("debug", message, ...args)
    }
  }

  private log(level: LogLevel, message: string, ...args: unknown[]): void {
    const timestamp = new Date().toISOString()
    const prefix = `${this.prefix} [${level.toUpperCase()}] ${timestamp}`
    const logMessage = `${prefix} ${message}`

    switch (level) {
      case "error":
        console.error(logMessage, ...args)
        break
      case "warn":
        console.warn(logMessage, ...args)
        break
      case "debug":
        console.debug(logMessage, ...args)
        break
      default:
        console.log(logMessage, ...args)
    }
  }
}

export const logger = new Logger()