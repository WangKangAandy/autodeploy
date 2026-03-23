import { describe, it, expect } from 'vitest'
import {
  escapeSingleQuotes,
  escapeDoubleQuotes,
  shellQuote,
  buildWorkdirPrefix,
  truncateOutput,
  formatOutput,
} from '../src/shared/utils.js'

describe('escapeSingleQuotes', () => {
  it('should escape single quotes using quote-end-quote technique', () => {
    // The function replaces ' with '\'' (end quote, escaped quote, start quote)
    // Input: it's -> Output: it'\''s
    const result = escapeSingleQuotes("it's")
    expect(result).toBe("it'\\''s")
  })

  it('should handle empty string', () => {
    expect(escapeSingleQuotes("")).toBe("")
  })

  it('should handle string without quotes', () => {
    expect(escapeSingleQuotes("hello")).toBe("hello")
  })

  it('should handle multiple single quotes', () => {
    const result = escapeSingleQuotes("it's a test's value")
    expect(result).toBe("it'\\''s a test'\\''s value")
  })

  it('should handle consecutive single quotes', () => {
    const result = escapeSingleQuotes("''")
    expect(result).toBe("'\\'''\\''")
  })
})

describe('escapeDoubleQuotes', () => {
  it('should escape double quotes', () => {
    expect(escapeDoubleQuotes('say "hello"')).toBe('say \\"hello\\"')
  })

  it('should escape backslashes', () => {
    expect(escapeDoubleQuotes('path\\to\\file')).toBe('path\\\\to\\\\file')
  })

  it('should escape dollar signs', () => {
    expect(escapeDoubleQuotes('$HOME')).toBe('\\$HOME')
  })

  it('should escape backticks', () => {
    expect(escapeDoubleQuotes('`command`')).toBe('\\`command\\`')
  })

  it('should handle empty string', () => {
    expect(escapeDoubleQuotes("")).toBe("")
  })

  it('should handle string without special chars', () => {
    expect(escapeDoubleQuotes("hello")).toBe("hello")
  })
})

describe('shellQuote', () => {
  it('should wrap value in single quotes', () => {
    expect(shellQuote("hello")).toBe("'hello'")
  })

  it('should escape single quotes inside', () => {
    // shellQuote wraps in single quotes and uses '\'' for escaping
    // Input: it's -> Output: 'it'\''s'
    const result = shellQuote("it's")
    expect(result).toBe("'it'\\''s'")
  })

  it('should handle empty string', () => {
    expect(shellQuote("")).toBe("''")
  })

  it('should handle path with spaces', () => {
    expect(shellQuote("/path/to/my file")).toBe("'/path/to/my file'")
  })
})

describe('buildWorkdirPrefix', () => {
  it('should return empty for ~', () => {
    expect(buildWorkdirPrefix("~")).toBe("")
  })

  it('should handle ~/', () => {
    expect(buildWorkdirPrefix("~/project")).toBe('cd "$HOME/project" && ')
  })

  it('should handle absolute path', () => {
    expect(buildWorkdirPrefix("/workspace")).toBe("cd '/workspace' && ")
  })

  it('should handle path with spaces', () => {
    expect(buildWorkdirPrefix("/path/to/my project")).toBe("cd '/path/to/my project' && ")
  })

  it('should handle path with single quotes', () => {
    // Uses '\'' escaping for single quotes
    const result = buildWorkdirPrefix("/path/it's/here")
    expect(result).toBe("cd '/path/it'\\''s/here' && ")
  })

  it('should handle other user home ~user/', () => {
    expect(buildWorkdirPrefix("~admin/workspace")).toBe("cd ~admin/'workspace' && ")
  })

  it('should handle ~user without path', () => {
    expect(buildWorkdirPrefix("~admin")).toBe("cd ~admin && ")
  })
})

describe('truncateOutput', () => {
  it('should not truncate small output', () => {
    expect(truncateOutput("small")).toBe("small")
  })

  it('should truncate large output', () => {
    const large = "x".repeat(60000)
    const result = truncateOutput(large)
    expect(result).toContain("OUTPUT TRUNCATED")
    expect(result.length).toBeLessThan(large.length)
  })

  it('should respect custom maxBytes', () => {
    const result = truncateOutput("hello world", 5)
    expect(result).toContain("OUTPUT TRUNCATED")
  })

  it('should handle empty string', () => {
    expect(truncateOutput("")).toBe("")
  })

  it('should handle exact boundary', () => {
    const exact = "x".repeat(51200)
    expect(truncateOutput(exact)).toBe(exact)
  })
})

describe('formatOutput', () => {
  it('should format output with exit code', () => {
    const result = formatOutput("hello", "", 0)
    expect(result).toBe("hello\nEXIT CODE: 0")
  })

  it('should include stderr when present', () => {
    const result = formatOutput("output", "error", 1)
    expect(result).toContain("STDERR:")
    expect(result).toContain("error")
    expect(result).toContain("EXIT CODE: 1")
  })

  it('should handle empty stdout', () => {
    const result = formatOutput("", "error", 1)
    expect(result).toContain("STDERR:")
    expect(result).toContain("error")
  })

  it('should handle empty stderr', () => {
    const result = formatOutput("output", "", 0)
    expect(result).not.toContain("STDERR:")
  })

  it('should handle both empty', () => {
    const result = formatOutput("", "", 0)
    expect(result).toBe("\nEXIT CODE: 0")
  })
})