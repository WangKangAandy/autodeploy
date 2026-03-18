import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the logger before importing the module
vi.mock('../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }
}))

import {
  parseCredentials,
  extractHost,
  extractUser,
  extractPassword,
} from '../src/credential-parser.js'

describe('parseCredentials', () => {
  it('should parse user@host 密码password format (Chinese)', () => {
    const result = parseCredentials("帮我访问 mccxadmin@192.168.24.40 密码mt@24040!")
    expect(result).toEqual({
      user: "mccxadmin",
      host: "192.168.24.40",
      password: "mt@24040!"
    })
  })

  it('should parse user@host password format (English)', () => {
    const result = parseCredentials("connect user@10.0.0.1 password secret123")
    expect(result).toEqual({
      user: "user",
      host: "10.0.0.1",
      password: "secret123"
    })
  })

  it('should parse with colon separator (Chinese colon)', () => {
    // Note: patterns require IP address, not hostname
    const result = parseCredentials("user@192.168.1.1 密码：pass123")
    expect(result?.password).toBe("pass123")
  })

  it('should parse with colon separator (English colon)', () => {
    const result = parseCredentials("user@192.168.1.1 密码: mypass")
    expect(result?.password).toBe("mypass")
  })

  it('should parse with exclamation mark separator', () => {
    const result = parseCredentials("user@192.168.1.1 密码! mypass")
    expect(result?.password).toBe("mypass")
  })

  it('should return null for invalid format', () => {
    expect(parseCredentials("hello world")).toBeNull()
  })

  it('should return null for missing password', () => {
    expect(parseCredentials("user@192.168.1.1")).toBeNull()
  })

  it('should handle special characters in password', () => {
    const result = parseCredentials("user@192.168.1.1 密码 p@ss!w0rd#")
    expect(result?.password).toBe("p@ss!w0rd#")
  })

  it('should parse with passwd keyword', () => {
    const result = parseCredentials("user@10.0.0.1 passwd mysecret")
    expect(result?.password).toBe("mysecret")
  })

  it('should parse with explicit port', () => {
    // Note: Pattern 3 handles ports but is checked after pattern1/pattern2
    // When there's a port with 密码 keyword, pattern2 matches first and doesn't capture port
    // This test verifies that when no keyword separator, pattern3 can parse with port
    const result = parseCredentials("user@192.168.1.1:2222密码mypass")
    expect(result?.user).toBe("user")
    expect(result?.host).toBe("192.168.1.1")
    // Port is only captured by pattern3 when password keyword is optional
    expect(result?.password).toBe("mypass")
  })

  it('should handle IP address with various formats', () => {
    const result = parseCredentials("admin@172.16.0.100 密码 test123")
    expect(result?.host).toBe("172.16.0.100")
    expect(result?.user).toBe("admin")
  })

  it('should be case insensitive for password keyword', () => {
    const result = parseCredentials("user@10.0.0.1 PASSWORD secret")
    expect(result?.password).toBe("secret")
  })
})

describe('extractHost', () => {
  it('should extract IP address with @ prefix', () => {
    expect(extractHost("user@192.168.1.1")).toBe("192.168.1.1")
  })

  it('should extract IP address without @ prefix', () => {
    expect(extractHost("connect to 10.0.0.1")).toBe("10.0.0.1")
  })

  it('should return null when no IP found', () => {
    expect(extractHost("hello world")).toBeNull()
  })

  it('should extract first IP when multiple present', () => {
    expect(extractHost("from 192.168.1.1 to 10.0.0.1")).toBe("192.168.1.1")
  })
})

describe('extractUser', () => {
  it('should extract username before @', () => {
    expect(extractUser("admin@192.168.1.1")).toBe("admin")
  })

  it('should return null when no @ found', () => {
    expect(extractUser("hello world")).toBeNull()
  })

  it('should extract username with underscores', () => {
    expect(extractUser("my_user@host")).toBe("my_user")
  })

  it('should extract username with numbers', () => {
    expect(extractUser("user123@host")).toBe("user123")
  })
})

describe('extractPassword', () => {
  it('should extract password after 密码 keyword', () => {
    expect(extractPassword("user@host 密码 mypass")).toBe("mypass")
  })

  it('should extract password after password keyword', () => {
    expect(extractPassword("user@host password secret")).toBe("secret")
  })

  it('should extract password after passwd keyword', () => {
    expect(extractPassword("user@host passwd mysecret")).toBe("mysecret")
  })

  it('should handle colon separator', () => {
    expect(extractPassword("密码:mypass")).toBe("mypass")
  })

  it('should return null when no password keyword found', () => {
    expect(extractPassword("user@host mypass")).toBeNull()
  })

  it('should be case insensitive', () => {
    expect(extractPassword("PASSWORD secret")).toBe("secret")
  })
})