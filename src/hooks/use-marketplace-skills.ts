// Marketplace Skills hook for fetching and managing marketplace skills data

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { API_BASE_URL } from '@/lib/config';
import { logger } from '@/lib/logger';
import { simpleFetch } from '@/lib/tauri-fetch';
import { apiClient } from '@/services/api-client';
import type { MarketplaceSkill, SkillCategory, SkillSortOption, SkillTag } from '@/types/skill';

export interface ListSkillsRequest {
  search?: string;
  category?: string;
  tags?: string[];
  sort?: SkillSortOption;
  limit?: number;
  offset?: number;
  featured?: boolean;
}

interface UseMarketplaceSkillsReturn {
  skills: MarketplaceSkill[];
  categories: SkillCategory[];
  tags: SkillTag[];
  featuredSkills: MarketplaceSkill[];
  isLoading: boolean;
  error: string | null;
  loadSkills: (options?: ListSkillsRequest) => Promise<void>;
  loadCategories: () => Promise<void>;
  loadTags: () => Promise<void>;
  loadFeaturedSkills: () => Promise<void>;
  getSkillBySlug: (slug: string) => Promise<MarketplaceSkill | null>;
  installSkill: (slug: string, version: string) => Promise<void>;
  downloadSkill: (slug: string) => Promise<void>;
}

export function useMarketplaceSkills(): UseMarketplaceSkillsReturn {
  const [skills, setSkills] = useState<MarketplaceSkill[]>([]);
  const [categories, setCategories] = useState<SkillCategory[]>([]);
  const [tags, setTags] = useState<SkillTag[]>([]);
  const [featuredSkills, setFeaturedSkills] = useState<MarketplaceSkill[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSkills = useCallback(async (options?: ListSkillsRequest) => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();

      if (options?.limit) params.append('limit', options.limit.toString());
      if (options?.offset) params.append('offset', options.offset.toString());
      if (options?.sort) params.append('sort', options.sort);
      if (options?.search) params.append('search', options.search);
      if (options?.category) params.append('category', options.category);
      if (options?.tags?.length) params.append('tags', options.tags.join(','));
      if (options?.featured !== undefined) params.append('featured', options.featured.toString());

      const response = await simpleFetch(`${API_BASE_URL}/api/skills-marketplace/skills?${params}`);

      if (!response.ok) {
        throw new Error('Failed to load skills');
      }

      const data = await response.json();
      setSkills(data.skills || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      logger.error('Load skills error:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const response = await simpleFetch(`${API_BASE_URL}/api/skills-marketplace/categories`);

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
      const response = await simpleFetch(`${API_BASE_URL}/api/skills-marketplace/tags`);

      if (!response.ok) {
        throw new Error('Failed to load tags');
      }

      const data = await response.json();
      setTags(data.tags || []);
    } catch (err) {
      logger.error('Load tags error:', err);
    }
  }, []);

  const loadFeaturedSkills = useCallback(async () => {
    try {
      const response = await simpleFetch(`${API_BASE_URL}/api/skills-marketplace/skills/featured`);

      if (!response.ok) {
        throw new Error('Failed to load featured skills');
      }

      const data = await response.json();
      setFeaturedSkills(data.skills || []);
    } catch (err) {
      logger.error('Load featured skills error:', err);
    }
  }, []);

  const getSkillBySlug = useCallback(async (slug: string): Promise<MarketplaceSkill | null> => {
    try {
      const response = await simpleFetch(`${API_BASE_URL}/api/skills-marketplace/skills/${slug}`);

      if (!response.ok) {
        throw new Error('Failed to load skill');
      }

      const data = await response.json();
      return data.skill;
    } catch (err) {
      logger.error('Get skill error:', err);
      return null;
    }
  }, []);

  const installSkill = useCallback(async (slug: string, version: string) => {
    try {
      // Track install
      const response = await apiClient.post(`/api/skills-marketplace/skills/${slug}/install`, {
        version,
      });

      if (!response.ok) {
        throw new Error('Failed to track skill installation');
      }

      logger.info(`Successfully tracked installation of skill: ${slug}`);
    } catch (err) {
      logger.error('Install skill error:', err);
      throw err;
    }
  }, []);

  const downloadSkill = useCallback(async (slug: string) => {
    try {
      const response = await apiClient.post(`/api/skills-marketplace/skills/${slug}/download`);

      if (!response.ok) {
        throw new Error('Failed to track download');
      }
    } catch (err) {
      logger.error('Download skill error:', err);
      throw err;
    }
  }, []);

  return {
    skills,
    categories,
    tags,
    featuredSkills,
    isLoading,
    error,
    loadSkills,
    loadCategories,
    loadTags,
    loadFeaturedSkills,
    getSkillBySlug,
    installSkill,
    downloadSkill,
  };
}
