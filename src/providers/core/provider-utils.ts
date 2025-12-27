// src/providers/core/provider-utils.ts
// Pure utility functions for provider/model operations - no state management

import { logger } from '@/lib/logger';
import { getProvidersForModel, MODEL_CONFIGS } from '@/providers/config/model-config';
import { getOAuthToken } from '@/providers/config/oauth-config';
import { isLocalProvider } from '@/providers/custom/custom-model-service';
import { createCustomProvider } from '@/providers/custom/custom-provider-factory';
import type { ProviderDefinition } from '@/types';
import type { AvailableModel } from '@/types/api-keys';
import type { CustomProviderConfig } from '@/types/custom-provider';
import type { ModelConfig } from '@/types/models';
import { PROVIDER_CONFIGS } from '../config/provider-config';
import { createAnthropicOAuthProvider } from '../oauth/claude-oauth-service';
import { createGitHubCopilotOAuthProvider } from '../oauth/github-copilot-oauth-service';
import { createOpenAIOAuthProvider } from '../oauth/openai-oauth-service';
import { createQwenCodeOAuthProvider } from '../oauth/qwen-code-oauth-service';

// OAuth configuration for provider creation
export interface OAuthConfig {
  anthropicAccessToken?: string | null;
  openaiAccessToken?: string | null;
  openaiAccountId?: string | null;
  qwenAccessToken?: string | null;
  githubCopilotAccessToken?: string | null;
  githubCopilotCopilotToken?: string | null;
  githubCopilotEnterpriseUrl?: string | null;
}

// Type for provider factory function (returns a function that creates model instances)
// biome-ignore lint/suspicious/noExplicitAny: Provider return types vary by implementation
export type ProviderFactory = (modelName: string) => any;

/**
 * Parse model identifier into modelKey and provider
 * Supports both formats:
 * - "modelKey@provider" (new format with explicit provider)
 * - "modelKey" (legacy format)
 */
export function parseModelIdentifier(modelIdentifier: string): {
  modelKey: string;
  providerId: string | null;
} {
  const parts = modelIdentifier.split('@');
  if (parts.length === 2 && parts[0] && parts[1]) {
    return { modelKey: parts[0], providerId: parts[1] };
  }
  return { modelKey: modelIdentifier, providerId: null };
}

/**
 * Resolve the provider-specific model name
 * Some providers use different model names (e.g., "gpt-4" vs "gpt-4-turbo")
 */
export function resolveProviderModelName(modelKey: string, providerId: string): string {
  const config = MODEL_CONFIGS[modelKey as keyof typeof MODEL_CONFIGS];
  return config?.providerMappings?.[providerId] || modelKey;
}

/**
 * Check if API key or OAuth is configured for a provider
 */
export function hasApiKeyForProvider(
  providerId: string,
  apiKeys: Record<string, string | undefined>,
  oauthConfig?: OAuthConfig
): boolean {
  // TalkCody Free is always available - auth check happens at usage time
  if (providerId === 'talkcody') {
    return true;
  }

  // Local providers (Ollama, LM Studio) use 'enabled' instead of API key
  if (isLocalProvider(providerId)) {
    return apiKeys[providerId] === 'enabled';
  }

  // Check OAuth for providers that support it (unified check using configuration)
  const oauthToken = getOAuthToken(providerId, oauthConfig);
  if (oauthToken) {
    return true;
  }

  // Check regular API key
  const apiKey = apiKeys[providerId];
  return !!(apiKey && typeof apiKey === 'string' && apiKey.trim());
}

/**
 * Get the best available provider for a model based on API key availability
 */
export function getBestProvider(
  modelKey: string,
  apiKeys: Record<string, string | undefined>,
  customProviders: CustomProviderConfig[],
  oauthConfig?: OAuthConfig
): string | null {
  const providers = getProvidersForModel(modelKey);

  for (const provider of providers) {
    // Check built-in provider
    if (hasApiKeyForProvider(provider.id, apiKeys, oauthConfig)) {
      return provider.id;
    }

    // Check custom provider
    const customProvider = customProviders.find((cp) => cp.id === provider.id && cp.enabled);
    if (customProvider) {
      return provider.id;
    }
  }

  return null;
}

/**
 * Create provider definition from custom provider config
 */
export function createProviderDefinitionFromCustomConfig(
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
      return createCustomProvider(config, apiKey, baseUrl);
    },
  };
}

/**
 * Helper function to create OAuth provider by provider ID
 * Centralizes OAuth provider creation logic
 */
function createOAuthProviderByType(
  providerId: string,
  oauthConfig?: OAuthConfig
): ProviderFactory | null {
  if (!oauthConfig) return null;

  switch (providerId) {
    case 'anthropic':
      if (oauthConfig.anthropicAccessToken) {
        logger.info('Creating Anthropic provider with OAuth (dynamic token refresh enabled)');
        return createAnthropicOAuthProvider();
      }
      break;
    case 'openai':
      if (oauthConfig.openaiAccessToken) {
        logger.info('Creating OpenAI provider with OAuth (dynamic token refresh enabled)');
        return createOpenAIOAuthProvider();
      }
      break;
    case 'qwen_code':
      if (oauthConfig.qwenAccessToken) {
        logger.info('Creating Qwen provider with OAuth');
        return createQwenCodeOAuthProvider();
      }
      break;
    case 'github_copilot':
      if (oauthConfig.githubCopilotCopilotToken) {
        logger.info('Creating GitHub Copilot provider with OAuth');
        return createGitHubCopilotOAuthProvider(
          oauthConfig.githubCopilotCopilotToken,
          oauthConfig.githubCopilotEnterpriseUrl || undefined
        );
      }
      break;
  }

  return null;
}

/**
 * Create all provider factory instances based on API keys and configs
 */
export function createProviders(
  apiKeys: Record<string, string | undefined>,
  providerConfigs: Map<string, ProviderDefinition>,
  baseUrls: Map<string, string>,
  useCodingPlanSettings: Map<string, boolean>,
  oauthConfig?: OAuthConfig
): Map<string, ProviderFactory> {
  const providers = new Map<string, ProviderFactory>();

  for (const [providerId, providerDef] of providerConfigs) {
    let apiKey = apiKeys[providerId];

    // For custom providers, get API key from custom provider config
    if (providerDef.isCustom && providerDef.customConfig) {
      apiKey = providerDef.customConfig.apiKey;
    }

    // TalkCody Free uses JWT auth, not API key - always create it
    const isTalkCody = providerId === 'talkcody';

    // Check if this provider uses OAuth (unified check using configuration)
    const oauthToken = getOAuthToken(providerId, oauthConfig);
    const useOAuth = providerDef.supportsOAuth && !!oauthToken && !baseUrls.has(providerId); // Don't use OAuth if custom base URL is set

    // Skip if no API key and no OAuth (except for special providers)
    if (!apiKey && !isTalkCody && !useOAuth) {
      logger.debug(`Skipping provider ${providerId}: no API key or OAuth configured`);
      continue;
    }

    // For ollama/lmstudio, check if enabled
    if ((providerId === 'ollama' || providerId === 'lmstudio') && apiKey !== 'enabled') {
      continue;
    }

    // Create provider using OAuth or API key
    try {
      // Try to create OAuth provider if applicable
      if (useOAuth) {
        const createdProvider = createOAuthProviderByType(providerId, oauthConfig);
        if (createdProvider) {
          providers.set(providerId, createdProvider);
          continue;
        }
      }

      // Create provider using the definition's factory function
      if (providerDef.createProvider) {
        // Use custom base URL if set, otherwise use the default from provider definition
        let customBaseUrl = baseUrls.get(providerId);

        // Special handling for providers with Coding Plan: determine base URL based on useCodingPlan setting
        if (!customBaseUrl) {
          const useCodingPlan = useCodingPlanSettings.get(providerId);
          if (useCodingPlan && providerDef.codingPlanBaseUrl) {
            customBaseUrl = providerDef.codingPlanBaseUrl;
          }
        }

        const baseUrl = customBaseUrl || providerDef.baseUrl;
        // For talkcody, apiKey is not used (uses JWT auth), pass empty string
        const createdProvider = providerDef.createProvider(apiKey || '', baseUrl);
        providers.set(providerId, createdProvider);
      } else {
        logger.warn(`Provider ${providerId} has no createProvider function`);
      }
    } catch (error) {
      logger.error(`Failed to create provider ${providerId}:`, error);
    }
  }

  logger.info(`Created ${providers.size} providers`);
  return providers;
}

/**
 * Compute available models based on API keys and provider configs
 * Uses Map for O(1) deduplication to prevent duplicate entries when
 * the same model exists in both built-in MODEL_CONFIGS and customModels
 */
export function computeAvailableModels(
  apiKeys: Record<string, string | undefined>,
  _providerConfigs: Map<string, ProviderDefinition>,
  customProviders: CustomProviderConfig[],
  customModels: Record<string, ModelConfig>,
  oauthConfig?: OAuthConfig
): AvailableModel[] {
  // Use Map for O(1) deduplication lookup - key is "${modelKey}-${providerId}"
  const modelMap = new Map<string, AvailableModel>();

  // Helper to add model only if not already exists (built-in models take priority)
  const addModel = (model: AvailableModel) => {
    const key = `${model.key}-${model.provider}`;
    if (!modelMap.has(key)) {
      modelMap.set(key, model);
    }
  };

  // 1. Iterate through all built-in models (added first, so they take priority)
  for (const [modelKey, modelConfig] of Object.entries(MODEL_CONFIGS)) {
    if (!modelConfig) continue;

    // Find all available providers for this model
    const providers = getProvidersForModel(modelKey);
    const availableProviders = providers.filter((provider) => {
      // Check built-in provider
      if (hasApiKeyForProvider(provider.id, apiKeys, oauthConfig)) {
        return true;
      }
      // Check custom provider
      const customProvider = customProviders.find((cp) => cp.id === provider.id && cp.enabled);
      return !!customProvider;
    });

    // Create a model entry for each available provider
    for (const provider of availableProviders) {
      addModel({
        key: modelKey,
        name: modelConfig.name,
        provider: provider.id,
        providerName: provider.name,
        imageInput: modelConfig.imageInput ?? false,
        imageOutput: modelConfig.imageOutput ?? false,
        audioInput: modelConfig.audioInput ?? false,
        inputPricing: modelConfig.pricing?.input,
      });
    }
  }

  // 2. Add custom models (skip if already exists from built-in)
  const customProviderIds = new Set(customProviders.filter((p) => p.enabled).map((p) => p.id));

  for (const [modelKey, modelConfig] of Object.entries(customModels)) {
    // Custom models have explicit providers, check if provider is available
    for (const providerId of modelConfig.providers) {
      // Check if it's a built-in provider with API key, or an enabled custom provider
      const isBuiltInWithKey = hasApiKeyForProvider(providerId, apiKeys, oauthConfig);
      const isCustomProviderEnabled = customProviderIds.has(providerId);

      if (isBuiltInWithKey || isCustomProviderEnabled) {
        // Get provider name from built-in config or custom provider
        let providerName = providerId;
        const builtInConfig = PROVIDER_CONFIGS[providerId as keyof typeof PROVIDER_CONFIGS];
        if (builtInConfig) {
          providerName = builtInConfig.name;
        } else {
          const customProvider = customProviders.find((p) => p.id === providerId);
          if (customProvider) {
            providerName = customProvider.name;
          }
        }

        addModel({
          key: modelKey,
          name: modelConfig.name,
          provider: providerId,
          providerName,
          imageInput: modelConfig.imageInput ?? false,
          imageOutput: modelConfig.imageOutput ?? false,
          audioInput: modelConfig.audioInput ?? false,
          inputPricing: modelConfig.pricing?.input,
        });
      }
    }
  }

  // Sort by name and return
  return Array.from(modelMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Check if a specific model is available
 */
export function isModelAvailable(
  modelIdentifier: string,
  apiKeys: Record<string, string | undefined>,
  customProviders: CustomProviderConfig[],
  oauthConfig?: OAuthConfig
): boolean {
  const { modelKey, providerId } = parseModelIdentifier(modelIdentifier);

  if (providerId) {
    // Check specific provider
    if (hasApiKeyForProvider(providerId, apiKeys, oauthConfig)) {
      return true;
    }
    // Check if it's an enabled custom provider
    const isCustomProviderEnabled = customProviders.some((p) => p.id === providerId && p.enabled);
    return isCustomProviderEnabled;
  }

  // Check if any provider is available
  const provider = getBestProvider(modelKey, apiKeys, customProviders, oauthConfig);
  return provider !== null;
}

/**
 * Build provider configs map from built-in and custom providers
 */
export function buildProviderConfigs(
  customProviders: CustomProviderConfig[]
): Map<string, ProviderDefinition> {
  const configs = new Map<string, ProviderDefinition>();

  // Add built-in providers
  for (const [id, definition] of Object.entries(PROVIDER_CONFIGS)) {
    configs.set(id, definition);
  }

  // Add custom providers
  for (const customProvider of customProviders.filter((p) => p.enabled)) {
    const definition = createProviderDefinitionFromCustomConfig(customProvider);
    configs.set(customProvider.id, definition);
  }

  return configs;
}
