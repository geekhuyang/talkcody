// src/stores/claude-usage-store.ts
// Zustand store for Claude usage data management

import { create } from 'zustand';
import { logger } from '@/lib/logger';
import type { ClaudeUsageData } from '@/services/claude-usage-service';
import { fetchClaudeUsage } from '@/services/claude-usage-service';

interface ClaudeUsageState {
  // Usage data
  usageData: ClaudeUsageData | null;

  // Loading state
  isLoading: boolean;

  // Error state
  error: string | null;

  // Last fetch timestamp
  lastFetchedAt: number | null;

  // Auto-refresh enabled
  autoRefreshEnabled: boolean;

  // Initialization state
  isInitialized: boolean;
}

interface ClaudeUsageActions {
  // Fetch usage data
  fetchUsage: () => Promise<void>;

  // Refresh usage data
  refresh: () => Promise<void>;

  // Clear usage data
  clear: () => void;

  // Enable/disable auto-refresh
  setAutoRefresh: (enabled: boolean) => void;

  // Initialize store
  initialize: () => Promise<void>;
}

type ClaudeUsageStore = ClaudeUsageState & ClaudeUsageActions;

// Cache duration: 2 minutes
const CACHE_DURATION_MS = 2 * 60 * 1000;

// Auto-refresh interval: 5 minutes
const AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

let refreshInterval: ReturnType<typeof setInterval> | null = null;

export const useClaudeUsageStore = create<ClaudeUsageStore>((set, get) => ({
  // Initial state
  usageData: null,
  isLoading: false,
  error: null,
  lastFetchedAt: null,
  autoRefreshEnabled: false,
  isInitialized: false,

  // Initialize store
  initialize: async () => {
    const { isInitialized } = get();
    if (isInitialized) return;

    logger.info('[ClaudeUsageStore] Initializing');
    set({ isInitialized: true });

    // Initial fetch
    await get().fetchUsage();
  },

  // Fetch usage data
  fetchUsage: async () => {
    const { isLoading, lastFetchedAt } = get();

    // Avoid concurrent fetches
    if (isLoading) {
      logger.debug('[ClaudeUsageStore] Already fetching, skipping');
      return;
    }

    // Check cache freshness
    if (lastFetchedAt && Date.now() - lastFetchedAt < CACHE_DURATION_MS) {
      logger.debug('[ClaudeUsageStore] Using cached data');
      return;
    }

    set({ isLoading: true, error: null });

    try {
      logger.info('[ClaudeUsageStore] Fetching usage data');
      const usageData = await fetchClaudeUsage();

      // Log received data structure
      logger.info('[ClaudeUsageStore] Received usage data:', JSON.stringify(usageData, null, 2));

      // Validate data structure
      if (!usageData || !usageData.five_hour || !usageData.seven_day) {
        logger.error('[ClaudeUsageStore] Invalid data structure:', {
          hasUsageData: !!usageData,
          hasFiveHour: !!usageData?.five_hour,
          hasSevenDay: !!usageData?.seven_day,
          dataKeys: usageData ? Object.keys(usageData) : [],
        });
        throw new Error('Invalid usage data structure received from API');
      }

      set({
        usageData,
        lastFetchedAt: Date.now(),
        isLoading: false,
        error: null,
      });

      logger.info('[ClaudeUsageStore] Usage data updated successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[ClaudeUsageStore] Failed to fetch usage:', error);

      set({
        error: errorMessage,
        isLoading: false,
      });
    }
  },

  // Refresh usage data (bypasses cache)
  refresh: async () => {
    logger.info('[ClaudeUsageStore] Forcing refresh');

    // Clear cache timestamp to force fresh fetch
    set({ lastFetchedAt: null });

    await get().fetchUsage();
  },

  // Clear usage data
  clear: () => {
    logger.info('[ClaudeUsageStore] Clearing usage data');

    set({
      usageData: null,
      lastFetchedAt: null,
      error: null,
    });
  },

  // Enable/disable auto-refresh
  setAutoRefresh: (enabled: boolean) => {
    logger.info('[ClaudeUsageStore] Auto-refresh:', enabled);

    set({ autoRefreshEnabled: enabled });

    // Clear existing interval
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }

    // Start new interval if enabled
    if (enabled) {
      refreshInterval = setInterval(() => {
        const store = get();
        if (store.autoRefreshEnabled) {
          logger.debug('[ClaudeUsageStore] Auto-refresh triggered');
          store.fetchUsage();
        }
      }, AUTO_REFRESH_INTERVAL_MS);
    }
  },
}));

// Selector for usage data
export const selectClaudeUsageData = (state: ClaudeUsageStore) => state.usageData;

// Selector for loading state
export const selectClaudeUsageLoading = (state: ClaudeUsageStore) => state.isLoading;

// Selector for error state
export const selectClaudeUsageError = (state: ClaudeUsageStore) => state.error;

// Helper function to get usage data
export async function getClaudeUsageData(): Promise<ClaudeUsageData | null> {
  const store = useClaudeUsageStore.getState();

  if (!store.isInitialized) {
    await store.initialize();
  }

  return store.usageData;
}
