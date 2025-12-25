// src/providers/config/provider-config.ts
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGateway } from '@ai-sdk/gateway';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { logger } from '@/lib/logger';
import { streamFetch } from '@/lib/tauri-fetch';
import { CLAUDE_OAUTH_BETA_HEADERS } from '@/providers/oauth/claude-oauth-service';
import { type CodexRequestBody, transformRequestBody } from '@/services/openai-codex-transformer';
import type { ProviderRegistry } from '@/types';
import { createTalkCodyProvider } from '../core/talkcody-provider';

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Create a custom fetch function for Claude OAuth that:
 * 1. Adds Authorization: Bearer header
 * 2. Removes x-api-key header
 * 3. Adds OAuth beta headers
 * 4. Adds Claude Code User-Agent header (required for OAuth)
 */
function createClaudeOAuthFetch(accessToken: string): FetchFn {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);

    // Remove x-api-key header (SDK adds this automatically)
    headers.delete('x-api-key');

    // Add Bearer token authorization
    headers.set('Authorization', `Bearer ${accessToken}`);

    // Merge beta headers
    const existingBeta = headers.get('anthropic-beta') || '';
    const existingBetaList = existingBeta
      .split(',')
      .map((b) => b.trim())
      .filter(Boolean);
    const oauthBetaList = CLAUDE_OAUTH_BETA_HEADERS.split(',').map((b) => b.trim());
    const mergedBetas = [...new Set([...oauthBetaList, ...existingBetaList])].join(',');
    headers.set('anthropic-beta', mergedBetas);

    return streamFetch(input, { ...init, headers });
  };
}

/**
 * Create an Anthropic provider that uses OAuth authentication
 */
export function createAnthropicOAuthProvider(accessToken: string) {
  return createAnthropic({
    apiKey: 'oauth-placeholder', // SDK requires this but we override with Bearer token
    fetch: createClaudeOAuthFetch(accessToken) as typeof fetch,
  });
}

/**
 * Create a custom fetch function for OpenAI ChatGPT OAuth that:
 * 1. Uses ChatGPT backend API base URL
 * 2. Adds Authorization: Bearer header
 * 3. Adds required headers for Codex API
 * 4. Transforms request body with Codex instructions
 */
function createOpenAIOAuthFetch(accessToken: string, accountId?: string | null): FetchFn {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);

    // Add Bearer token authorization
    headers.set('Authorization', `Bearer ${accessToken}`);

    // Add required headers for ChatGPT backend API
    headers.set('OpenAI-Beta', 'responses=experimental');
    headers.set('originator', 'codex_cli_rs');

    // Add account ID if available
    if (accountId) {
      headers.set('chatgpt-account-id', accountId);
    }

    // Add SSE stream support
    headers.set('accept', 'text/event-stream');

    // Transform the URL to use ChatGPT backend API
    let url = typeof input === 'string' ? input : input.toString();

    // Replace standard OpenAI API paths with ChatGPT backend paths
    if (url.includes('/v1/chat/completions')) {
      url = url.replace(
        /https:\/\/api\.openai\.com\/v1\/chat\/completions/,
        'https://chatgpt.com/backend-api/codex/responses'
      );
    } else if (url.includes('/v1/responses')) {
      url = url.replace(
        /https:\/\/api\.openai\.com\/v1\/responses/,
        'https://chatgpt.com/backend-api/codex/responses'
      );
    }

    // Transform request body for Codex API
    let transformedInit = init;
    if (init?.body && typeof init.body === 'string') {
      try {
        const originalBody = JSON.parse(init.body) as CodexRequestBody;
        const transformedBody = await transformRequestBody(originalBody);
        transformedInit = {
          ...init,
          body: JSON.stringify(transformedBody),
        };
        logger.info('[OpenAIOAuthFetch] Request body transformed for Codex API', {
          transformedBody,
        });
      } catch (error) {
        logger.error('[OpenAIOAuthFetch] Failed to transform request body:', error);
        // Continue with original body if transformation fails
      }
    }

    return streamFetch(url, { ...transformedInit, headers });
  };
}

/**
 * Create an OpenAI provider that uses ChatGPT OAuth authentication
 */
export function createOpenAIOAuthProvider(accessToken: string, accountId?: string | null) {
  return createOpenAI({
    apiKey: 'oauth-placeholder', // SDK requires this but we override with Bearer token
    fetch: createOpenAIOAuthFetch(accessToken, accountId) as typeof fetch,
  });
}

export const PROVIDER_CONFIGS: ProviderRegistry = {
  // TalkCody Free Provider
  talkcody: {
    id: 'talkcody',
    name: 'TalkCody Free',
    apiKeyName: 'TALKCODY_ENABLED', // Not a real API key, just a flag
    required: false,
    type: 'custom',
    createProvider: () => createTalkCodyProvider(),
  },

  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    apiKeyName: 'ANTHROPIC_API_KEY',
    required: false,
    type: 'custom',
    supportsOAuth: true, // Supports Claude Pro/Max OAuth authentication
    createProvider: (apiKey: string, baseUrl?: string) =>
      createAnthropic({
        apiKey,
        ...(baseUrl && { baseURL: baseUrl }),
        // Add Authorization header for third-party APIs that use Bearer token auth
        // Official Anthropic API uses x-api-key (handled by SDK), third-party APIs often use Bearer
        ...(baseUrl && {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        }),
        // Use Tauri fetch to bypass webview CORS restrictions
        // This works for both official Anthropic API and third-party compatible APIs
        fetch: streamFetch as typeof fetch,
      }),
  },

  openai: {
    id: 'openai',
    name: 'OpenAI',
    apiKeyName: 'OPENAI_API_KEY',
    required: false,
    type: 'openai',
    createProvider: (apiKey: string, baseUrl?: string) => {
      if (baseUrl) {
        return createOpenAICompatible({
          apiKey,
          name: 'openai',
          baseURL: baseUrl,
          fetch: streamFetch as typeof fetch,
        });
      }
      return createOpenAI({
        apiKey,
        fetch: streamFetch as typeof fetch,
      });
    },
  },

  MiniMax: {
    id: 'MiniMax',
    name: 'MiniMax',
    apiKeyName: 'MINIMAX_API_KEY',
    required: false,
    type: 'openai-compatible',
    supportsCodingPlan: true,
    createProvider: (apiKey: string) =>
      createAnthropic({
        apiKey,
        baseURL: 'https://api.minimaxi.com/anthropic/v1',
        fetch: streamFetch as typeof fetch,
      }),
  },

  zhipu: {
    id: 'zhipu',
    name: 'Zhipu AI',
    apiKeyName: 'ZHIPU_API_KEY',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/',
    required: false,
    type: 'openai-compatible',
    supportsCodingPlan: true,
    codingPlanBaseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    createProvider: (apiKey: string, baseUrl?: string) =>
      createOpenAICompatible({
        apiKey,
        name: 'zhipu',
        baseURL: baseUrl || 'https://open.bigmodel.cn/api/paas/v4/',
        fetch: streamFetch as typeof fetch,
      }),
  },

  openRouter: {
    id: 'openRouter',
    name: 'OpenRouter',
    apiKeyName: 'OPEN_ROUTER_API_KEY',
    required: false,
    type: 'custom',
    createProvider: (apiKey: string) =>
      createOpenRouter({
        apiKey,
        headers: {
          'HTTP-Referer': 'https://talkcody.com',
          'X-Title': 'TalkCody',
        },
        extraBody: {
          reasoning: {
            enabled: true,
          },
        },
        fetch: streamFetch as typeof fetch,
      }),
  },

  aiGateway: {
    id: 'aiGateway',
    name: 'Vercel AI Gateway',
    apiKeyName: 'AI_GATEWAY_API_KEY',
    required: false,
    type: 'custom',
    createProvider: (apiKey: string) =>
      createGateway({
        headers: {
          'http-referer': 'https://talkcody.com',
          'x-title': 'TalkCody',
        },
        apiKey,
        fetch: streamFetch as typeof fetch,
      }),
  },

  deepseek: {
    id: 'deepseek',
    name: 'Deepseek',
    apiKeyName: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com',
    required: false,
    type: 'openai-compatible',
    createProvider: (apiKey: string, baseUrl?: string) =>
      createOpenAICompatible({
        apiKey,
        name: 'deepseek',
        baseURL: baseUrl || 'https://api.deepseek.com/v1/',
        fetch: streamFetch as typeof fetch,
      }),
  },

  google: {
    id: 'google',
    name: 'Google AI',
    apiKeyName: 'GOOGLE_API_KEY',
    required: false,
    type: 'custom',
    createProvider: (apiKey: string) =>
      createGoogleGenerativeAI({
        apiKey,
        fetch: streamFetch as typeof fetch,
      }),
  },

  ollama: {
    id: 'ollama',
    name: 'Ollama',
    apiKeyName: 'OLLAMA_ENABLED',
    baseUrl: 'http://127.0.0.1:11434',
    required: false,
    type: 'openai-compatible',
    createProvider: () =>
      createOpenAICompatible({
        name: 'ollama',
        baseURL: 'http://127.0.0.1:11434/v1',
        apiKey: 'ollama', // Ollama doesn't require a real API key
        fetch: streamFetch as typeof fetch,
      }),
  },

  lmstudio: {
    id: 'lmstudio',
    name: 'LM Studio',
    apiKeyName: 'LMSTUDIO_ENABLED',
    baseUrl: 'http://127.0.0.1:1234',
    required: false,
    type: 'openai-compatible',
    createProvider: (_apiKey: string, baseUrl?: string) =>
      createOpenAICompatible({
        name: 'lmstudio',
        baseURL: baseUrl ? `${baseUrl}/v1` : 'http://127.0.0.1:1234/v1',
        apiKey: 'lm-studio', // LM Studio doesn't require a real API key
        fetch: streamFetch as typeof fetch,
      }),
  },

  moonshot: {
    id: 'moonshot',
    name: 'Moonshot',
    apiKeyName: 'MOONSHOT_API_KEY',
    required: false,
    type: 'openai-compatible',
    supportsCodingPlan: true,
    codingPlanBaseUrl: 'https://api.kimi.com/coding/v1',
    createProvider: (apiKey: string) =>
      createOpenAICompatible({
        apiKey,
        name: 'moonshot',
        baseURL: 'https://api.moonshot.cn/v1',
        fetch: streamFetch as typeof fetch,
      }),
  },

  tavily: {
    id: 'tavily',
    name: 'Tavily Web Search',
    apiKeyName: 'TAVILY_API_KEY',
    baseUrl: 'https://api.tavily.com',
    required: false,
    type: 'custom',
    createProvider: () => null, // Tavily is not an AI provider, just a search API
  },

  serper: {
    id: 'serper',
    name: 'Serper Web Search',
    apiKeyName: 'SERPER_API_KEY',
    baseUrl: 'https://google.serper.dev',
    required: false,
    type: 'custom',
    createProvider: () => null, // Serper is not an AI provider, just a search API
  },

  elevenlabs: {
    id: 'elevenlabs',
    name: 'Eleven Labs Text-to-Speech',
    apiKeyName: 'ELEVENLABS_API_KEY',
    baseUrl: 'https://api.elevenlabs.io',
    required: false,
    type: 'custom',
    createProvider: () => null,
  },
} as const;

// Generate types from definitions
export type ProviderIds = keyof typeof PROVIDER_CONFIGS;
export const PROVIDER_IDS = Object.keys(PROVIDER_CONFIGS) as ProviderIds[];

// Providers that support Coding Plan feature
export const PROVIDERS_WITH_CODING_PLAN = Object.entries(PROVIDER_CONFIGS)
  .filter(([_, config]) => config.supportsCodingPlan)
  .map(([id]) => id);
