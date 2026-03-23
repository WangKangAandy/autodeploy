type LogLevel = "debug" | "info" | "warn" | "error"

class Logger {
  private prefix = "[FeishuBridge]"
  private level: LogLevel
  private levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
  }

  constructor() {
    // Read log level from environment variable, default to "info"
    const envLevel = process.env.LOG_LEVEL as LogLevel
    this.level = this.isValidLevel(envLevel) ? envLevel : "info"
  }

  private isValidLevel(level: string | undefined): level is LogLevel {
    return level !== undefined && level in this.levelPriority
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levelPriority[level] >= this.levelPriority[this.level]
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog("info")) {
      this.log("info", message, ...args)
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog("warn")) {
      this.log("warn", message, ...args)
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog("error")) {
      this.log("error", message, ...args)
    }
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog("debug")) {
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