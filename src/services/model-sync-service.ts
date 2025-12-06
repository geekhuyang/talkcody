import { getApiUrl } from '@/lib/config';
import { logger } from '@/lib/logger';
import { modelLoader } from '@/lib/model-loader';
import { refreshModelConfigs } from '@/lib/models';
import { simpleFetch } from '@/lib/tauri-fetch';
import type { ModelsConfiguration, ModelVersionResponse } from '@/types/models';

const VERSION_ENDPOINT = '/api/models/version';
const CONFIGS_ENDPOINT = '/api/models/configs';

// Check interval: 1 hour
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * ModelSyncService handles version checking and automatic updates
 * of model configurations from the remote API
 */
class ModelSyncService {
  private checkInterval: number | null = null;
  private isCheckingUpdate = false;

  /**
   * Initialize the sync service
   * Call this on app startup (non-blocking)
   */
  async initialize(): Promise<void> {
    // Check for updates on startup (async, non-blocking)
    this.checkForUpdates().catch((err) => {
      logger.warn('Initial model update check failed:', err);
    });

    // Start background sync
    this.startBackgroundSync();
  }

  /**
   * Check if remote has newer version and update if needed
   * @returns true if update was performed, false otherwise
   */
  async checkForUpdates(): Promise<boolean> {
    // Prevent concurrent checks
    if (this.isCheckingUpdate) {
      logger.info('Model update check already in progress');
      return false;
    }

    this.isCheckingUpdate = true;

    try {
      const localVersion = await modelLoader.getVersion();
      const remoteVersion = await this.fetchRemoteVersion();

      // Compare versions (ISO 8601 string comparison works correctly)
      if (!localVersion || remoteVersion.version > localVersion) {
        logger.info(`Updating models: ${localVersion || 'none'} → ${remoteVersion.version}`);
        await this.downloadAndUpdate();
        return true;
      } else {
        logger.info(`Models are up to date (${localVersion})`);
        return false;
      }
    } catch (error) {
      logger.error('Failed to check for model updates:', error);
      // Don't throw - graceful degradation
      return false;
    } finally {
      this.isCheckingUpdate = false;
    }
  }

  /**
   * Fetch remote version info
   */
  private async fetchRemoteVersion(): Promise<ModelVersionResponse> {
    const url = getApiUrl(VERSION_ENDPOINT);
    const response = await simpleFetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch version: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Download and update models configuration
   */
  private async downloadAndUpdate(): Promise<void> {
    const url = getApiUrl(CONFIGS_ENDPOINT);
    const response = await simpleFetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch configs: ${response.status} ${response.statusText}`);
    }

    const config: ModelsConfiguration = await response.json();

    // Validate and save to file cache
    await modelLoader.update(config);
    logger.info(`Models updated successfully to version ${config.version}`);

    // Refresh MODEL_CONFIGS in memory to enable hot-reload
    await refreshModelConfigs();

    // Notify UI components that models have been updated
    window.dispatchEvent(new CustomEvent('modelsUpdated'));
    logger.info('Model configs refreshed and UI notified');
  }

  /**
   * Start background sync (checks every hour)
   */
  startBackgroundSync(): void {
    if (this.checkInterval !== null) {
      logger.warn('Background sync already started');
      return;
    }

    this.checkInterval = window.setInterval(() => {
      this.checkForUpdates().catch((err) => {
        logger.warn('Background model update check failed:', err);
      });
    }, CHECK_INTERVAL_MS);

    logger.info('Started background model sync (1 hour interval)');
  }

  /**
   * Stop background sync
   */
  stopBackgroundSync(): void {
    if (this.checkInterval !== null) {
      window.clearInterval(this.checkInterval);
      this.checkInterval = null;
      logger.info('Stopped background model sync');
    }
  }

  /**
   * Manually trigger update check (for UI button)
   */
  async manualRefresh(): Promise<boolean> {
    logger.info('Manual model refresh triggered');
    return await this.checkForUpdates();
  }

  /**
   * Get current sync status
   */
  getStatus(): { isChecking: boolean; hasBackgroundSync: boolean } {
    return {
      isChecking: this.isCheckingUpdate,
      hasBackgroundSync: this.checkInterval !== null,
    };
  }
}

// Export singleton instance
export const modelSyncService = new ModelSyncService();
export default modelSyncService;
