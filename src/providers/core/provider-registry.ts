// src/providers/core/provider-registry.ts
import { logger } from '@/lib/logger';
import { isLocalProvider } from '@/providers/custom/custom-model-service';
import { createCustomProvider } from '@/providers/custom/custom-provider-factory';
import { customProviderService } from '@/providers/custom/custom-provider-service';
import type { ProviderDefinition } from '@/types';
import type { CustomProviderConfig } from '@/types/custom-provider';
import { PROVIDER_CONFIGS } from '../config/provider-config';

export class ProviderRegistry {
  private static instance: ProviderRegistry;
  private providers: Map<string, ProviderDefinition> = new Map();
  private customProvidersLoaded = false;

  private constructor() {
    // Initialize with default providers
    this.loadDefaultProviders();
    // Load custom providers when needed
    this.loadCustomProviders();
  }

  static getInstance(): ProviderRegistry {
    if (!ProviderRegistry.instance) {
      ProviderRegistry.instance = new ProviderRegistry();
    }
    return ProviderRegistry.instance;
  }

  private loadDefaultProviders(): void {
    for (const [id, definition] of Object.entries(PROVIDER_CONFIGS)) {
      this.providers.set(id, definition);
    }
  }

  private async loadCustomProviders(): Promise<void> {
    if (this.customProvidersLoaded) {
      return;
    }

    try {
      const customProviders = await customProviderService.getEnabledCustomProviders();

      for (const customProvider of customProviders) {
        const definition = this.createProviderDefinitionFromCustomConfig(customProvider);
        this.providers.set(customProvider.id, definition);
      }

      this.customProvidersLoaded = true;
      logger.info(`Loaded ${customProviders.length} custom providers`);
    } catch (error) {
      logger.warn('Failed to load custom providers:', error);
    }
  }

  private createProviderDefinitionFromCustomConfig(
    config: CustomProviderConfig
  ): ProviderDefinition {
    const apiKeyName = `custom_${config.id}`;

    return {
      id: config.id,
      name: config.name,
      apiKeyName,
      baseUrl: config.baseUrl,
      required: true,
      type: config.type === 'anthropic' ? 'custom' : 'openai-compatible',
      isCustom: true,
      customConfig: config,
      createProvider: (apiKey: string, baseUrl?: string) => {
        // Use synchronous factory function
        return createCustomProvider(config, apiKey, baseUrl);
      },
    };
  }

  async registerProvider(definition: ProviderDefinition): Promise<void> {
    this.providers.set(definition.id, definition);
  }

  async registerCustomProvider(config: CustomProviderConfig): Promise<void> {
    const definition = this.createProviderDefinitionFromCustomConfig(config);
    this.providers.set(config.id, definition);
  }

  async unregisterCustomProvider(providerId: string): Promise<void> {
    this.providers.delete(providerId);
  }

  getProvider(id: string): ProviderDefinition | undefined {
    return this.providers.get(id);
  }

  getAllProviders(): ProviderDefinition[] {
    return Array.from(this.providers.values());
  }

  getBuiltInProviders(): ProviderDefinition[] {
    return Array.from(this.providers.values()).filter((p) => !p.isCustom);
  }

  getCustomProviders(): ProviderDefinition[] {
    return Array.from(this.providers.values()).filter((p) => p.isCustom);
  }

  getProviderIds(): string[] {
    return Array.from(this.providers.keys());
  }

  hasProvider(id: string): boolean {
    return this.providers.has(id);
  }

  isCustomProvider(id: string): boolean {
    const provider = this.providers.get(id);
    return provider?.isCustom || false;
  }

  // Generate API key settings interface
  generateApiKeySettings(): Record<string, string> {
    const settings: Record<string, string> = {};
    for (const provider of this.getAllProviders()) {
      // Convert from PROVIDER_API_KEY format to camelCase
      const key = provider.id;
      settings[key] = '';
    }
    return settings;
  }

  // Generate provider type union
  generateProviderTypeUnion(): string {
    const ids = this.getProviderIds();
    return ids.map((id) => `'${id}'`).join(' | ');
  }

  // Check if API key is configured for provider
  hasApiKey(
    providerId: string,
    apiKeys: Record<string, string | undefined>,
    oauthConfig?: { anthropicAccessToken?: string | null; openaiAccessToken?: string | null }
  ): boolean {
    const provider = this.getProvider(providerId);
    if (!provider) {
      logger.warn('[hasApiKey] Provider not found', { providerId });
      return false;
    }

    // TalkCody Free is always available - auth check happens at usage time
    if (providerId === 'talkcody') {
      return true;
    }

    // Local providers (Ollama, LM Studio) use 'enabled' instead of API key
    if (isLocalProvider(providerId)) {
      const result = apiKeys[providerId] === 'enabled';
      return result;
    }

    // Check OAuth for Anthropic
    if (providerId === 'anthropic' && oauthConfig?.anthropicAccessToken) {
      return true;
    }

    // Check OAuth for OpenAI
    if (providerId === 'openai' && oauthConfig?.openaiAccessToken) {
      return true;
    }

    const apiKey = apiKeys[providerId];
    const hasKey = !!(apiKey && typeof apiKey === 'string' && apiKey.trim());
    return hasKey;
  }
}

export const providerRegistry = ProviderRegistry.getInstance();
