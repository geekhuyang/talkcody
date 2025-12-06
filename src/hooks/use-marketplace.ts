// Marketplace hook for fetching and managing marketplace data

import type { Category, ListAgentsRequest, MarketplaceAgent, Tag } from '@talkcody/shared';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { API_BASE_URL } from '@/lib/config';
import { logger } from '@/lib/logger';
import { simpleFetch } from '@/lib/tauri-fetch';
import { agentRegistry } from '@/services/agents/agent-registry';
import { apiClient } from '@/services/api-client';

interface UseMarketplaceReturn {
  agents: MarketplaceAgent[];
  categories: Category[];
  tags: Tag[];
  featuredAgents: MarketplaceAgent[];
  isLoading: boolean;
  error: string | null;
  loadAgents: (options?: ListAgentsRequest) => Promise<void>;
  loadCategories: () => Promise<void>;
  loadTags: () => Promise<void>;
  loadFeaturedAgents: () => Promise<void>;
  getAgentBySlug: (slug: string) => Promise<MarketplaceAgent | null>;
  installAgent: (slug: string, version: string) => Promise<void>;
  downloadAgent: (slug: string) => Promise<void>;
}

export function useMarketplace(): UseMarketplaceReturn {
  const [agents, setAgents] = useState<MarketplaceAgent[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [featuredAgents, setFeaturedAgents] = useState<MarketplaceAgent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAgents = useCallback(async (options?: ListAgentsRequest) => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();

      if (options?.limit) params.append('limit', options.limit.toString());
      if (options?.offset) params.append('offset', options.offset.toString());
      if (options?.sortBy) params.append('sortBy', options.sortBy);
      if (options?.search) params.append('search', options.search);
      if (options?.categoryIds) params.append('categoryIds', options.categoryIds.join(','));
      if (options?.tagIds) params.append('tagIds', options.tagIds.join(','));
      if (options?.isFeatured !== undefined)
        params.append('isFeatured', options.isFeatured.toString());

      const response = await simpleFetch(`${API_BASE_URL}/api/marketplace/agents?${params}`);

      if (!response.ok) {
        throw new Error('Failed to load agents');
      }

      const data = await response.json();
      setAgents(data.agents || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      logger.error('Load agents error:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const response = await simpleFetch(`${API_BASE_URL}/api/marketplace/categories`);

      if (!response.ok) {
        throw new Error('Failed to load categories');
      }

      const data = await response.json();
      setCategories(data.categories || []);
    } catch (err) {
      logger.error('Load categories error:', err);
    }
  }, []);

  const loadTags = useCallback(async () => {
    try {
      const response = await simpleFetch(`${API_BASE_URL}/api/marketplace/tags`);

      if (!response.ok) {
        throw new Error('Failed to load tags');
      }

      const data = await response.json();
      setTags(data.tags || []);
    } catch (err) {
      logger.error('Load tags error:', err);
    }
  }, []);

  const loadFeaturedAgents = useCallback(async () => {
    try {
      const response = await simpleFetch(
        `${API_BASE_URL}/api/marketplace/agents/featured?limit=10`
      );

      if (!response.ok) {
        throw new Error('Failed to load featured agents');
      }

      const data = await response.json();
      setFeaturedAgents(data.agents || []);
    } catch (err) {
      logger.error('Load featured agents error:', err);
    }
  }, []);

  const getAgentBySlug = useCallback(async (slug: string): Promise<MarketplaceAgent | null> => {
    try {
      const response = await simpleFetch(`${API_BASE_URL}/api/marketplace/agents/${slug}`);

      if (!response.ok) {
        throw new Error('Failed to load agent');
      }

      const data = await response.json();
      return data.agent;
    } catch (err) {
      logger.error('Get agent error:', err);
      return null;
    }
  }, []);

  const installAgent = useCallback(async (slug: string, version: string) => {
    try {
      // Track install
      const response = await apiClient.post(`/api/marketplace/agents/${slug}/install`, { version });

      if (!response.ok) {
        throw new Error('Failed to install agent');
      }

      // Download agent configuration
      const agentResponse = await apiClient.get(`/api/marketplace/agents/${slug}`);

      if (!agentResponse.ok) {
        throw new Error('Failed to download agent configuration');
      }

      const agentData = await agentResponse.json();
      const marketplaceAgent: MarketplaceAgent = agentData.agent;

      // Generate unique local ID based on slug
      const baseId = marketplaceAgent.slug
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');

      let localId = baseId;
      let counter = 1;
      while (await agentRegistry.get(localId)) {
        localId = `${baseId}-${counter++}`;
      }

      // Create agent definition from marketplace agent
      const agentDefinition = {
        id: localId,
        name: marketplaceAgent.name,
        description: marketplaceAgent.description || '',
        modelType: (marketplaceAgent as any).modelType || 'main_model',
        systemPrompt: marketplaceAgent.systemPrompt || '',
        tools: {}, // Tools will be resolved from toolsConfig later
        hidden: false,
        rules: marketplaceAgent.rules,
        outputFormat: marketplaceAgent.outputFormat,
        isDefault: false,
        dynamicPrompt: {
          enabled: false,
          providers: [],
          variables: {},
        },
      };

      // Register the agent
      await agentRegistry.forceRegister(agentDefinition);

      // Update with marketplace metadata
      await agentRegistry.update(localId, {
        marketplaceId: marketplaceAgent.id,
        sourceType: 'marketplace',
        marketplaceVersion: version,
      } as any);

      logger.info(`Successfully installed marketplace agent ${slug} as ${localId}`);
      toast.success(`Agent "${marketplaceAgent.name}" installed successfully!`);

      // Refresh agent store to sync with database
      const { useAgentStore } = await import('@/stores/agent-store');
      await useAgentStore.getState().refreshAgents();
    } catch (err) {
      logger.error('Install agent error:', err);
      toast.error('Failed to install agent. Please try again.');
      throw err;
    }
  }, []);

  const downloadAgent = useCallback(async (slug: string) => {
    try {
      const response = await apiClient.post(`/api/marketplace/agents/${slug}/download`);

      if (!response.ok) {
        throw new Error('Failed to track download');
      }
    } catch (err) {
      logger.error('Download agent error:', err);
      throw err;
    }
  }, []);

  return {
    agents,
    categories,
    tags,
    featuredAgents,
    isLoading,
    error,
    loadAgents,
    loadCategories,
    loadTags,
    loadFeaturedAgents,
    getAgentBySlug,
    installAgent,
    downloadAgent,
  };
}
