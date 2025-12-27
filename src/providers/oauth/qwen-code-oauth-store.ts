// src/providers/oauth/qwen-code-oauth-store.ts
// Zustand store for Qwen Code OAuth state management

import { create } from 'zustand';
import { logger } from '@/lib/logger';
import { readTokenFromPath, testToken, validateTokenPath } from './qwen-code-oauth-service';

// Storage key for OAuth token path in settings database
const STORAGE_KEY = 'qwen_code_oauth_path';

interface QwenCodeOAuthState {
  // Connection state
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;

  // Token path (in-memory)
  tokenPath: string | null;

  // Initialization
  isInitialized: boolean;
}

interface QwenCodeOAuthActions {
  // Initialize from storage
  initialize: () => Promise<void>;

  // Token path management
  setTokenPath: (path: string) => Promise<void>;
  disconnect: () => Promise<void>;

  // Token operations
  getToken: () => Promise<string | null>;
  testConnection: () => Promise<boolean>;
}

type QwenCodeOAuthStore = QwenCodeOAuthState & QwenCodeOAuthActions;

// Helper to get settings database
async function getSettingsDb() {
  const { settingsDb } = await import('@/stores/settings-store');
  await settingsDb.initialize();
  return settingsDb;
}

export const useQwenCodeOAuthStore = create<QwenCodeOAuthStore>((set, get) => ({
  // Initial state
  isConnected: false,
  isLoading: false,
  error: null,
  tokenPath: null,
  isInitialized: false,

  // Initialize from storage
  initialize: async () => {
    const { isInitialized, isLoading } = get();
    if (isInitialized || isLoading) return;

    set({ isLoading: true, error: null });

    try {
      logger.info('[QwenOAuth] Initializing store');
      const db = await getSettingsDb();

      const tokenPath = (await db.get(STORAGE_KEY)) || null;

      // Check if we have a valid token path
      let isConnected = false;
      if (tokenPath) {
        isConnected = await validateTokenPath(tokenPath);
      }

      logger.info('[QwenOAuth] Initialized', { isConnected, hasPath: !!tokenPath });

      set({
        tokenPath,
        isConnected,
        isLoading: false,
        isInitialized: true,
      });
    } catch (error) {
      logger.error('[QwenOAuth] Initialization error:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to initialize',
        isLoading: false,
        isInitialized: true,
      });
    }
  },

  // Set token path and save to database
  setTokenPath: async (path: string) => {
    set({ isLoading: true, error: null });

    try {
      // Validate path first
      const isValid = await validateTokenPath(path);

      if (!isValid) {
        throw new Error(
          'Invalid token path or unable to read token, please login in Qwen Code first.'
        );
      }

      // Save to database
      const db = await getSettingsDb();
      await db.set(STORAGE_KEY, path);

      logger.info('[QwenOAuth] Token path set successfully');

      set({
        tokenPath: path,
        isConnected: true,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      logger.error('[QwenOAuth] Failed to set token path:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to set token path',
        isLoading: false,
      });
      throw error;
    }
  },

  // Disconnect and clear token path
  disconnect: async () => {
    set({ isLoading: true, error: null });

    try {
      const db = await getSettingsDb();
      await db.set(STORAGE_KEY, '');

      logger.info('[QwenOAuth] Disconnected');

      set({
        tokenPath: null,
        isConnected: false,
        isLoading: false,
      });
    } catch (error) {
      logger.error('[QwenOAuth] Failed to disconnect:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to disconnect',
        isLoading: false,
      });
      throw error;
    }
  },

  // Get token from file
  getToken: async () => {
    const { tokenPath } = get();

    if (!tokenPath) {
      return null;
    }

    try {
      const token = await readTokenFromPath(tokenPath);
      return token;
    } catch (error) {
      logger.error('[QwenOAuth] Failed to read token:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to read token',
        isConnected: false,
      });
      return null;
    }
  },

  // Test connection by reading and validating token
  testConnection: async () => {
    const { tokenPath } = get();

    if (!tokenPath) {
      set({ error: 'No token path configured' });
      return false;
    }

    set({ isLoading: true, error: null });

    try {
      // Read token from file
      const token = await readTokenFromPath(tokenPath);

      // Test if token is valid
      const isValid = await testToken(token);

      if (!isValid) {
        throw new Error('Token validation failed');
      }

      logger.info('[QwenOAuth] Connection test successful');

      set({
        isConnected: true,
        isLoading: false,
        error: null,
      });

      return true;
    } catch (error) {
      logger.error('[QwenOAuth] Connection test failed:', error);
      set({
        error: error instanceof Error ? error.message : 'Connection test failed',
        isConnected: false,
        isLoading: false,
      });
      return false;
    }
  },
}));

// Selector for connection status
export const selectIsQwenCodeOAuthConnected = (state: QwenCodeOAuthStore) => state.isConnected;

// Export async helper for checking OAuth status
export async function isQwenCodeOAuthConnected(): Promise<boolean> {
  const store = useQwenCodeOAuthStore.getState();
  if (!store.isInitialized) {
    await store.initialize();
  }
  return useQwenCodeOAuthStore.getState().isConnected;
}

// Export async helper for getting access token
export async function getQwenCodeOAuthAccessToken(): Promise<string | null> {
  const store = useQwenCodeOAuthStore.getState();
  if (!store.isInitialized) {
    await store.initialize();
  }
  return useQwenCodeOAuthStore.getState().getToken();
}

/**
 * Get the full OAuth credentials including resource_url (for provider fetch function)
 */
export async function getQwenCodeOAuthCredentials(): Promise<{
  access_token: string;
  resource_url: string;
} | null> {
  const store = useQwenCodeOAuthStore.getState();

  // Initialize if needed
  if (!store.isInitialized) {
    await store.initialize();
  }

  const tokenPath = store.tokenPath;
  if (!tokenPath) {
    return null;
  }

  try {
    const { readCredentialsFromFile } = await import('@/providers/oauth/qwen-code-oauth-service');
    const credentials = await readCredentialsFromFile(tokenPath);
    return {
      access_token: credentials.access_token,
      resource_url: credentials.resource_url,
    };
  } catch (error) {
    logger.error('[QwenOAuthStore] Failed to read credentials:', error);
    return null;
  }
}
