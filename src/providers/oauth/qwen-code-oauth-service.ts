// src/providers/oauth/qwen-code-oauth-service.ts
// Service for reading Qwen Code OAuth tokens from file system

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { homeDir } from '@tauri-apps/api/path';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { logger } from '@/lib/logger';
import { simpleFetch, streamFetch } from '@/lib/tauri-fetch';

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

// Qwen OAuth credentials interface
export interface QwenCredentials {
  access_token: string;
  refresh_token: string;
  token_type: string;
  resource_url: string;
  expiry_date: number;
}

// Token refresh constants (from Roo Code)
const TOKEN_REFRESH_BUFFER_MS = 30000; // 30 seconds
const QWEN_OAUTH_BASE_URL = 'https://chat.qwen.ai';
const QWEN_OAUTH_CLIENT_ID = 'f0304373b74a44d2b584a3fb70ca9e56';
const QWEN_OAUTH_TOKEN_URL = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/token`;

/**
 * Expand path with ~ to absolute path
 */
async function expandPath(path: string): Promise<string> {
  if (!path.startsWith('~')) {
    return path;
  }

  const home = await homeDir();
  return path.replace(/^~/, home);
}

/**
 * Refresh OAuth token using refresh_token
 */
async function refreshToken(credentials: QwenCredentials): Promise<QwenCredentials> {
  logger.info('[QwenOAuth] Refreshing expired token');

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: credentials.refresh_token,
    client_id: QWEN_OAUTH_CLIENT_ID,
  });

  try {
    const response = await simpleFetch(QWEN_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('[QwenOAuth] Token refresh failed:', errorText);
      throw new Error(`Failed to refresh token: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Update credentials with new token data
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token || credentials.refresh_token,
      token_type: data.token_type || credentials.token_type,
      resource_url: credentials.resource_url,
      expiry_date: data.expires_in ? Date.now() + data.expires_in * 1000 : credentials.expiry_date,
    };
  } catch (error) {
    logger.error('[QwenOAuth] Token refresh error:', error);
    throw new Error(
      `Failed to refresh OAuth token: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Read and parse credentials from file
 */
export async function readCredentialsFromFile(path: string): Promise<QwenCredentials> {
  const expandedPath = await expandPath(path.trim());
  const content = await readTextFile(expandedPath);

  if (!content || content.trim() === '') {
    throw new Error('Token file is empty');
  }

  try {
    const credentials = JSON.parse(content.trim()) as QwenCredentials;

    if (!credentials.access_token || !credentials.refresh_token) {
      throw new Error('Invalid credentials format: missing access_token or refresh_token');
    }

    return credentials;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Invalid JSON format in token file');
    }
    throw error;
  }
}

/**
 * Write credentials back to file
 */
async function writeCredentialsToFile(path: string, credentials: QwenCredentials): Promise<void> {
  const expandedPath = await expandPath(path.trim());
  const content = JSON.stringify(credentials, null, 2);
  await writeTextFile(expandedPath, content);
  logger.info('[QwenOAuth] Updated credentials saved to file');
}

/**
 * Read token from a file path with automatic refresh if expired
 * Supports Qwen Code OAuth credentials format
 */
export async function readTokenFromPath(path: string): Promise<string> {
  if (!path || path.trim() === '') {
    throw new Error('Token path is required');
  }

  try {
    // Read credentials from file
    let credentials = await readCredentialsFromFile(path);

    // Check if token is expired (with 30 second buffer)
    const now = Date.now();
    const isExpired = now >= credentials.expiry_date - TOKEN_REFRESH_BUFFER_MS;

    if (isExpired) {
      logger.info('[QwenOAuth] Token expired or about to expire, refreshing...');

      // Refresh the token
      credentials = await refreshToken(credentials);

      // Save updated credentials back to file
      await writeCredentialsToFile(path, credentials);
    }

    return credentials.access_token;
  } catch (error) {
    if (error instanceof Error) {
      // Re-throw our custom errors
      if (
        error.message.includes('Token') ||
        error.message.includes('JSON') ||
        error.message.includes('credentials') ||
        error.message.includes('refresh')
      ) {
        throw error;
      }

      // Handle file system errors
      if (error.message.includes('No such file')) {
        throw new Error('Token file not found');
      }

      if (error.message.includes('Permission denied')) {
        throw new Error('Permission denied reading token file');
      }

      // Generic error
      throw new Error(`Failed to read token file: ${error.message}`);
    }

    throw new Error('Unknown error reading token file');
  }
}

/**
 * Validate that a token path exists and is readable
 */
export async function validateTokenPath(path: string): Promise<boolean> {
  try {
    await readTokenFromPath(path);
    return true;
  } catch (error) {
    logger.error('[QwenOAuth] Token path validation failed:', error);
    return false;
  }
}

/**
 * Test if a token is valid by making a simple API request
 * This is a placeholder - actual implementation would make a real API call
 */
export async function testToken(token: string): Promise<boolean> {
  if (!token || token.trim() === '') {
    return false;
  }

  // TODO: Make actual API request to validate token
  // For now, just check if token looks valid (not empty and reasonable length)
  const trimmed = token.trim();
  return trimmed.length > 10;
}

/**
 * Create a custom fetch function for Qwen Code OAuth that:
 * 1. Dynamically reads the latest access token and resource URL on each request
 * 2. Replaces the request URL with the correct endpoint based on resource_url
 * 3. Sets the access token as Authorization header
 * 4. Uses Tauri fetch for CORS bypass
 */
function createQwenCodeOAuthFetch(): FetchFn {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    logger.info('[QwenOAuthFetch] Fetching credentials dynamically...');

    // Dynamically get the latest credentials (with auto-refresh)
    const { getQwenCodeOAuthCredentials } = await import('@/providers/oauth/qwen-code-oauth-store');
    const credentials = await getQwenCodeOAuthCredentials();

    logger.info('[QwenOAuthFetch] Credentials obtained:', credentials ? 'YES' : 'NO');

    if (!credentials?.access_token) {
      logger.error('[QwenOAuthFetch] No access token available');
      throw new Error('Qwen OAuth access token not available');
    }

    // Build the correct endpoint from resource_url
    // Following qwen-code logic: https://portal.qwen.ai -> https://portal.qwen.ai/v1
    const baseEndpoint = credentials.resource_url || 'dashscope.aliyuncs.com/compatible-mode';
    const suffix = '/v1';
    const normalizedUrl = baseEndpoint.startsWith('http')
      ? baseEndpoint
      : `https://${baseEndpoint}`;
    const endpoint = normalizedUrl.endsWith(suffix) ? normalizedUrl : `${normalizedUrl}${suffix}`;

    // Replace the URL with the correct endpoint
    let url = typeof input === 'string' ? input : input.toString();
    // Replace the placeholder base URL with the actual endpoint
    url = url.replace('https://dashscope.aliyuncs.com/compatible-mode/v1', endpoint);

    logger.info('[QwenOAuthFetch] Using endpoint:', endpoint);
    logger.info('[QwenOAuthFetch] Final URL:', url);

    // Create new headers, completely replacing SDK headers
    const headers = new Headers();

    // Copy existing headers except Authorization
    if (init?.headers) {
      const existingHeaders = new Headers(init.headers);
      for (const [key, value] of existingHeaders.entries()) {
        if (key.toLowerCase() !== 'authorization') {
          headers.set(key, value);
        } else {
          logger.info(
            '[QwenOAuthFetch] Removing SDK Authorization header:',
            value.substring(0, 30) + '...'
          );
        }
      }
    }

    // Set our OAuth token
    headers.set('Authorization', `Bearer ${credentials.access_token}`);

    logger.info(
      '[QwenOAuthFetch] Authorization header set:',
      headers.get('Authorization')?.substring(0, 30) + '...'
    );

    return streamFetch(url, { ...init, headers });
  };
}

/**
 * Create a Qwen provider that uses Qwen Code OAuth authentication
 * Note: baseURL will be dynamically replaced in the fetch function based on resource_url
 */
export function createQwenCodeOAuthProvider() {
  return createOpenAICompatible({
    name: 'qwen_code',
    // Use a placeholder that will be replaced by the fetch function
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    // Don't set apiKey - we'll handle token in fetch function
    fetch: createQwenCodeOAuthFetch() as typeof fetch,
  });
}
