import type { User } from '@talkcody/shared';
import { open } from '@tauri-apps/plugin-shell';
import { getApiUrl } from '@/lib/config';
import { logger } from '@/lib/logger';
import { simpleFetch } from '@/lib/tauri-fetch';
import { secureStorage } from './secure-storage';

class AuthService {
  /**
   * Initiate GitHub OAuth flow by opening system browser
   */
  async initiateGitHubOAuth(): Promise<void> {
    const authUrl = getApiUrl('/api/auth/github');
    await open(authUrl);
  }

  /**
   * Initiate Google OAuth flow by opening system browser
   */
  async initiateGoogleOAuth(): Promise<void> {
    const authUrl = getApiUrl('/api/auth/google');
    await open(authUrl);
  }

  /**
   * Fetch user profile from API using stored token
   */
  async fetchUserProfile(): Promise<User | null> {
    try {
      logger.info('[Auth Service] Fetching user profile...');
      const token = await secureStorage.getAuthToken();

      if (!token) {
        logger.warn('[Auth Service] No token found in secure storage');
        return null;
      }

      logger.info('[Auth Service] Token found, calling API:', getApiUrl('/api/auth/me'));
      const response = await simpleFetch(getApiUrl('/api/auth/me'), {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      logger.info('[Auth Service] API response status:', response.status);

      if (!response.ok) {
        // Token is invalid or expired
        if (response.status === 401) {
          logger.error('[Auth Service] Token is invalid (401), removing token');
          await secureStorage.removeAuthToken();
        } else {
          logger.error('[Auth Service] API error:', response.statusText);
        }
        return null;
      }

      const data = await response.json();
      logger.info('[Auth Service] API response data:', data);
      const user = data.user || null;
      logger.info('[Auth Service] User profile:', user);
      return user;
    } catch (error) {
      logger.error('[Auth Service] Failed to fetch user profile:', error);
      return null;
    }
  }

  /**
   * Sign out user by removing auth token and clearing user data
   */
  async signOut(): Promise<void> {
    await secureStorage.removeAuthToken();
  }

  /**
   * Check if user is authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    const hasToken = await secureStorage.hasAuthToken();
    return hasToken;
  }

  /**
   * Store auth token from OAuth callback
   */
  async storeAuthToken(token: string): Promise<void> {
    logger.info('[Auth Service] Storing auth token, length:', token.length);
    await secureStorage.setAuthToken(token);
    logger.info('[Auth Service] Auth token stored successfully');
  }
}

export const authService = new AuthService();
