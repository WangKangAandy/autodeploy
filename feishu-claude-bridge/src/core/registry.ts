import type {
  PlatformId,
  PlatformAdapter,
  PlatformAdapterConstructor,
  PlatformConfig
} from "./types.js"
import { logger } from "../utils/logger.js"

/**
 * Platform Registry - Manages platform adapter registration and lifecycle
 */
class PlatformRegistry {
  private adapters = new Map<PlatformId, PlatformAdapter>()
  private constructors = new Map<PlatformId, PlatformAdapterConstructor>()

  /**
   * Register a platform adapter constructor
   * Called by adapter modules during initialization
   */
  register(id: PlatformId, constructor: PlatformAdapterConstructor): void {
    if (this.constructors.has(id)) {
      logger.warn(`Platform "${id}" is already registered, overwriting`)
    }
    this.constructors.set(id, constructor)
    logger.info(`Platform "${id}" registered`)
  }

  /**
   * Check if a platform is registered
   */
  has(id: PlatformId): boolean {
    return this.constructors.has(id)
  }

  /**
   * Create and initialize a platform adapter from config
   */
  async createAdapter(
    id: PlatformId,
    config: Record<string, unknown>
  ): Promise<PlatformAdapter> {
    const Constructor = this.constructors.get(id)
    if (!Constructor) {
      throw new Error(`Unknown platform: ${id}. Make sure the adapter is registered.`)
    }

    // Check if adapter already exists
    const existing = this.adapters.get(id)
    if (existing) {
      logger.warn(`Platform "${id}" already initialized, returning existing instance`)
      return existing
    }

    // Create new adapter instance
    const adapter = new Constructor()

    // Initialize with config
    await adapter.initialize(config)

    // Store in registry
    this.adapters.set(id, adapter)
    logger.info(`Platform "${adapter.name}" (${id}) initialized`)

    return adapter
  }

  /**
   * Get an initialized adapter by ID
   */
  getAdapter(id: PlatformId): PlatformAdapter | undefined {
    return this.adapters.get(id)
  }

  /**
   * Get all initialized adapters
   */
  getAllAdapters(): PlatformAdapter[] {
    return Array.from(this.adapters.values())
  }

  /**
   * Get all registered platform IDs (not necessarily initialized)
   */
  getRegisteredPlatforms(): PlatformId[] {
    return Array.from(this.constructors.keys())
  }

  /**
   * Get all enabled (initialized) platform IDs
   */
  getEnabledPlatforms(): PlatformId[] {
    return Array.from(this.adapters.keys())
  }

  /**
   * Initialize all enabled platforms from config
   */
  async initializeFromConfig(platformConfigs: PlatformConfig[]): Promise<PlatformAdapter[]> {
    const initialized: PlatformAdapter[] = []

    for (const platformConfig of platformConfigs) {
      if (!platformConfig.enabled) {
        logger.info(`Platform "${platformConfig.type}" is disabled, skipping`)
        continue
      }

      try {
        const adapter = await this.createAdapter(platformConfig.type, platformConfig)
        initialized.push(adapter)
      } catch (error) {
        logger.error(`Failed to initialize platform "${platformConfig.type}": ${error}`)
        // Continue with other platforms
      }
    }

    return initialized
  }

  /**
   * Dispose all adapters
   */
  async disposeAll(): Promise<void> {
    for (const [id, adapter] of this.adapters) {
      try {
        if (adapter.dispose) {
          await adapter.dispose()
        }
        logger.info(`Platform "${id}" disposed`)
      } catch (error) {
        logger.error(`Error disposing platform "${id}": ${error}`)
      }
    }
    this.adapters.clear()
  }

  /**
   * Clear all registrations (for testing)
   */
  clear(): void {
    this.adapters.clear()
    this.constructors.clear()
  }
}

// Global singleton instance
export const registry = new PlatformRegistry()