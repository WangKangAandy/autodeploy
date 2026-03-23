#!/usr/bin/env node

import * as fs from "node:fs"
import * as path from "node:path"
import * as readline from "node:readline"

/**
 * Simple CLI utility to help process and respond to Feishu messages
 */

const MESSAGES_DIR = "./messages"
const RESPONSES_DIR = "./responses"

/**
 * List all pending messages
 */
function listMessages(): string[] {
  try {
    const files = fs.readdirSync(MESSAGES_DIR)
    return files.filter(f => f.endsWith('.json'))
  } catch (error) {
    console.error(`Error reading messages directory: ${error}`)
    return []
  }
}

/**
 * Get message details
 */
function getMessage(requestId: string): any | null {
  try {
    const filepath = path.join(MESSAGES_DIR, `${requestId}.json`)
    const content = fs.readFileSync(filepath, 'utf-8')
    return JSON.parse(content)
  } catch (error) {
    console.error(`Error reading message ${requestId}: ${error}`)
    return null
  }
}

/**
 * Display message details
 */
function displayMessage(message: any): void {
  console.log("\n========================================")
  console.log(`Request ID: ${message.requestId}`)
  console.log("========================================")
  console.log(`From: ${message.senderName || message.userId}`)
  console.log(`Chat Type: ${message.chatType}`)
  console.log(`Time: ${new Date(message.timestamp).toLocaleString('zh-CN')}`)
  console.log("\nMessage:")
  console.log("----------------------------------------")
  console.log(message.message)
  console.log("----------------------------------------")

  if (message.attachments && message.attachments.length > 0) {
    console.log("\nAttachments:")
    message.attachments.forEach((att: any, i: number) => {
      console.log(`  ${i + 1}. ${att.type}: ${att.content || att.name || 'Unknown'}`)
    })
  }
  console.log("========================================\n")
}

/**
 * Send a response
 */
function sendResponse(requestId: string, content: string): boolean {
  try {
    const filepath = path.join(RESPONSES_DIR, `${requestId}.json`)
    const response = { content }
    fs.writeFileSync(filepath, JSON.stringify(response, null, 2))
    console.log(`✓ Response queued for ${requestId}`)
    return true
  } catch (error) {
    console.error(`Error sending response: ${error}`)
    return false
  }
}

/**
 * Get user input
 */
function getUserInput(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  return new Promise(resolve => {
    rl.question(prompt, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

/**
 * Main CLI
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.length === 0) {
    // Interactive mode
    console.log("Feishu Message CLI - Interactive Mode")
    console.log("========================================\n")

    const messages = listMessages()

    if (messages.length === 0) {
      console.log("No pending messages.")
      return
    }

    console.log(`Found ${messages.length} pending message(s):\n`)

    messages.forEach((file, i) => {
      const requestId = file.replace('.json', '')
      const message = getMessage(requestId)
      if (message) {
        const preview = message.message.substring(0, 40)
        const sender = message.senderName || message.userId
        console.log(`${i + 1}. ${requestId.substring(0, 8)}... | ${sender} | "${preview}..."`)
      }
    })

    console.log("")
    const choice = await getUserInput("Select message number (or 'q' to quit): ")

    if (choice.toLowerCase() === 'q') {
      return
    }

    const index = parseInt(choice) - 1
    if (index >= 0 && index < messages.length) {
      const requestId = messages[index].replace('.json', '')
      const message = getMessage(requestId)

      if (message) {
        displayMessage(message)

        console.log("Enter your response (Ctrl+D to finish, or 'quit' to cancel):")

        const response = await getUserInput("> ")

        if (response.toLowerCase() === 'quit') {
          console.log("Cancelled.")
          return
        }

        if (response.trim()) {
          sendResponse(requestId, response)
        } else {
          console.log("Empty response, cancelled.")
        }
      }
    } else {
      console.log("Invalid selection.")
    }
  } else {
    const command = args[0]

    if (command === 'list' || command === 'ls') {
      const messages = listMessages()

      if (messages.length === 0) {
        console.log("No pending messages.")
      } else {
        console.log(`Found ${messages.length} pending message(s):`)
        messages.forEach(file => {
          const requestId = file.replace('.json', '')
          const message = getMessage(requestId)
          if (message) {
            console.log(`  ${requestId} | ${message.senderName || message.userId}`)
          }
        })
      }
    } else if (command === 'show' || command === 'view') {
      if (args.length < 2) {
        console.error("Usage: npm run cli show <request-id>")
        process.exit(1)
      }

      const requestId = args[1]
      const message = getMessage(requestId)

      if (message) {
        displayMessage(message)
      } else {
        console.error(`Message not found: ${requestId}`)
      }
    } else if (command === 'respond' || command === 'reply') {
      if (args.length < 3) {
        console.error("Usage: npm run cli respond <request-id> '<your-message>'")
        process.exit(1)
      }

      const requestId = args[1]
      const content = args.slice(2).join(' ')

      sendResponse(requestId, content)
    } else if (command === 'clear') {
      // Clear all messages
      try {
        const messageFiles = listMessages()
        const responseFiles = fs.readdirSync(RESPONSES_DIR).filter(f => f.endsWith('.json'))

        messageFiles.forEach(file => {
          fs.unlinkSync(path.join(MESSAGES_DIR, file))
        })
        responseFiles.forEach(file => {
          fs.unlinkSync(path.join(RESPONSES_DIR, file))
        })

        console.log(`Cleared ${messageFiles.length} messages and ${responseFiles.length} responses.`)
      } catch (error) {
        console.error(`Error clearing messages: ${error}`)
      }
    } else {
      console.error("Unknown command.")
      console.error("Usage:")
      console.error("  npm run cli              # Interactive mode")
      console.error("  npm run cli list        # List all messages")
      console.error("  npm run cli show <id>   # Show message details")
      console.error("  npm run cli respond <id> '<message>'  # Send response")
      console.error("  npm run cli clear       # Clear all messages")
      process.exit(1)
    }
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})