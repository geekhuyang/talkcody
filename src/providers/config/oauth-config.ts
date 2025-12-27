// src/providers/config/oauth-config.ts
// OAuth Provider Configuration Registry
// Centralized management of OAuth provider metadata

import type { OAuthConfig } from '@/providers/core/provider-utils';

/**
 * OAuth Provider Metadata
 * Defines how to access OAuth configuration for each provider
 */
export interface OAuthProviderMetadata {
  providerId: string;
  tokenKey: keyof OAuthConfig; // Token field name in OAuthConfig
}

/**
 * OAuth Providers Registry
 * Maps provider IDs to their OAuth configuration metadata
 *
 * When adding a new OAuth provider:
 * 1. Add entry here with providerId and tokenKey
 * 2. Add corresponding hook in use-oauth-status.ts
 * 3. Add component mapping in oauth-provider-input.tsx
 * 4. Add token field in OAuthConfig type (provider-utils.ts)
 */
export const OAUTH_PROVIDERS_MAP: Record<string, OAuthProviderMetadata> = {
  anthropic: {
    providerId: 'anthropic',
    tokenKey: 'anthropicAccessToken',
  },
  openai: {
    providerId: 'openai',
    tokenKey: 'openaiAccessToken',
  },
  qwen_code: {
    providerId: 'qwen_code',
    tokenKey: 'qwenAccessToken',
  },
  github_copilot: {
    providerId: 'github_copilot',
    tokenKey: 'githubCopilotAccessToken',
  },
} as const;

/**
 * Check if a provider supports OAuth authentication
 */
export function isOAuthProvider(providerId: string): boolean {
  return providerId in OAUTH_PROVIDERS_MAP;
}

/**
 * Get OAuth token for a provider from OAuthConfig
 * Returns undefined if provider doesn't support OAuth or token is not set
 */
export function getOAuthToken(
  providerId: string,
  oauthConfig?: OAuthConfig
): string | null | undefined {
  const metadata = OAUTH_PROVIDERS_MAP[providerId];
  if (!metadata || !oauthConfig) {
    return undefined;
  }

  return oauthConfig[metadata.tokenKey];
}
