// Skills Marketplace service for browsing and searching skills

import type { MarketplaceSkill, SkillCategory, SkillTag } from '@talkcody/shared';
import { and, asc, count, desc, eq, inArray, like, or, type SQL, sql } from 'drizzle-orm';
import { db, getDb } from '../db/client';
import {
  categories,
  marketplaceSkills,
  skillCategories,
  skillStats,
  skillTags,
  skillVersions,
  tags,
  users,
} from '../db/schema';
import { searchSkillsFts5 } from '../lib/fts5-utils';
import type { CategoryRecord, MarketplaceSkillRecord, TagRecord } from '../types/database';

export interface ListSkillsOptions {
  limit?: number;
  offset?: number;
  sortBy?: 'popular' | 'recent' | 'installs' | 'name' | 'rating' | 'downloads' | 'updated';
  search?: string;
  categoryIds?: string[];
  tagIds?: string[];
  isFeatured?: boolean;
  authorId?: string;
}

export interface SkillWithDetails extends MarketplaceSkill {
  versions: Array<{
    version: string;
    isLatest: boolean;
    createdAt: string;
  }>;
}

export class SkillsMarketplaceService {
  /**
   * List skills with filtering and sorting
   */
  async listSkills(options: ListSkillsOptions = {}) {
    const {
      limit = 20,
      offset = 0,
      sortBy = 'popular',
      search,
      categoryIds,
      tagIds,
      isFeatured,
      authorId,
    } = options;

    // Build where conditions
    const conditions: SQL<unknown>[] = [eq(marketplaceSkills.isPublished, true)];

    // Handle FTS5 full-text search
    let skillIdsFromSearch: string[] | undefined;

    if (search) {
      try {
        // Use FTS5 for fast, relevance-ranked search
        // Weights: name=10.0, description=5.0, longDescription=1.0
        const { client } = getDb();
        const ftsResults = await searchSkillsFts5(client, {
          query: search,
          limit: 1000, // Get top 1000 matches for further filtering
          weights: [10.0, 5.0, 1.0],
        });

        skillIdsFromSearch = ftsResults.map((result) => result.id);

        // If no FTS5 matches found, return empty result early
        if (skillIdsFromSearch.length === 0) {
          return { skills: [], total: 0, limit, offset };
        }
      } catch (error) {
        // Fallback to LIKE search if FTS5 fails
        console.warn('[Skills Marketplace] FTS5 search failed, falling back to LIKE:', error);
        conditions.push(
          or(
            like(marketplaceSkills.name, `%${search}%`),
            like(marketplaceSkills.description, `%${search}%`),
            like(marketplaceSkills.longDescription, `%${search}%`)
          )
        );
      }
    }

    if (isFeatured !== undefined) {
      conditions.push(eq(marketplaceSkills.isFeatured, isFeatured));
    }

    if (authorId) {
      conditions.push(eq(marketplaceSkills.authorId, authorId));
    }

    // Handle category and tag filtering
    let skillIds: string[] | undefined;

    // Start with FTS5 search results if available
    if (skillIdsFromSearch) {
      skillIds = skillIdsFromSearch;
    }

    if (categoryIds && categoryIds.length > 0) {
      const categorySkills = await db
        .select({ skillId: skillCategories.skillId })
        .from(skillCategories)
        .where(inArray(skillCategories.categoryId, categoryIds));

      const categorySkillIds = categorySkills.map((s) => s.skillId);

      if (skillIds) {
        // Intersect with existing filter (from FTS5 or previous filters)
        skillIds = skillIds.filter((id) => categorySkillIds.includes(id));
      } else {
        skillIds = categorySkillIds;
      }

      if (skillIds.length === 0) {
        // No skills match the categories
        return { skills: [], total: 0, limit, offset };
      }
    }

    if (tagIds && tagIds.length > 0) {
      const tagSkills = await db
        .select({ skillId: skillTags.skillId })
        .from(skillTags)
        .where(inArray(skillTags.tagId, tagIds));

      const tagSkillIds = tagSkills.map((s) => s.skillId);
      if (skillIds) {
        // Intersect with existing filter
        skillIds = skillIds.filter((id) => tagSkillIds.includes(id));
      } else {
        skillIds = tagSkillIds;
      }

      if (skillIds.length === 0) {
        return { skills: [], total: 0, limit, offset };
      }
    }

    if (skillIds) {
      conditions.push(inArray(marketplaceSkills.id, skillIds));
    }

    // Build order by
    let orderBy: SQL<unknown> | undefined;
    switch (sortBy) {
      case 'recent':
        orderBy = desc(marketplaceSkills.createdAt);
        break;
      case 'installs':
      case 'downloads':
        orderBy = desc(marketplaceSkills.installCount);
        break;
      case 'name':
        orderBy = asc(marketplaceSkills.name);
        break;
      case 'rating':
        orderBy = desc(marketplaceSkills.rating);
        break;
      case 'updated':
        orderBy = desc(marketplaceSkills.updatedAt);
        break;
      default:
        // Popular = by install count
        orderBy = desc(marketplaceSkills.installCount);
        break;
    }

    // Execute query
    const skillsQuery = db
      .select()
      .from(marketplaceSkills)
      .where(and(...conditions))
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset);

    const skillsResult = await skillsQuery;

    // Get total count
    const totalResult = await db
      .select({ count: count() })
      .from(marketplaceSkills)
      .where(and(...conditions));

    // Enrich with author and relations
    const enrichedSkills = await this.enrichSkills(skillsResult);

    return {
      skills: enrichedSkills,
      total: totalResult[0]?.count || 0,
      limit,
      offset,
    };
  }

  /**
   * Get skill by slug
   */
  async getSkillBySlug(slug: string): Promise<SkillWithDetails | null> {
    const skillResult = await db
      .select()
      .from(marketplaceSkills)
      .where(and(eq(marketplaceSkills.slug, slug), eq(marketplaceSkills.isPublished, true)))
      .limit(1);

    if (skillResult.length === 0) {
      return null;
    }

    const skill = skillResult[0];

    // Get versions
    const versionsResult = await db
      .select()
      .from(skillVersions)
      .where(eq(skillVersions.skillId, skill.id))
      .orderBy(desc(skillVersions.createdAt));

    // Enrich skill
    const enriched = await this.enrichSkills([skill]);

    return {
      ...enriched[0],
      versions: versionsResult.map((v) => ({
        version: v.version,
        isLatest: v.version === skill.latestVersion,
        createdAt: new Date(v.createdAt).toISOString(),
      })),
    } as SkillWithDetails;
  }

  /**
   * Get featured skills
   */
  async getFeaturedSkills(limit: number = 10) {
    return this.listSkills({ limit, isFeatured: true, sortBy: 'popular' });
  }

  /**
   * Track skill download (alias for trackInstall)
   */
  async trackDownload(skillId: string, userId: string | null, version?: string) {
    // Download and install are the same, so just track as install
    return this.trackInstall(skillId, userId, version || 'latest');
  }

  /**
   * Track skill install
   */
  async trackInstall(skillId: string, userId: string | null, version: string) {
    // Increment install count
    await db
      .update(marketplaceSkills)
      .set({
        installCount: sql`${marketplaceSkills.installCount} + 1`,
      })
      .where(eq(marketplaceSkills.id, skillId));

    // Record install event in stats (userId can be null for anonymous users)
    await db.insert(skillStats).values({
      skillId,
      userId,
      version,
      eventType: 'install',
    });
  }

  /**
   * Get all categories
   */
  async getAllCategories(): Promise<SkillCategory[]> {
    const results = await db.select().from(categories).orderBy(asc(categories.name));

    return results.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description || '',
      icon: c.icon || undefined,
      displayOrder: c.displayOrder,
    }));
  }

  /**
   * Get all tags
   */
  async getAllTags(): Promise<SkillTag[]> {
    const results = await db.select().from(tags).orderBy(desc(tags.usageCount)).limit(100);

    return results.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      usageCount: t.usageCount,
    }));
  }

  /**
   * Enrich skills with author and relation data
   */
  private async enrichSkills(skills: MarketplaceSkillRecord[]): Promise<MarketplaceSkill[]> {
    if (skills.length === 0) {
      return [];
    }

    const skillIds = skills.map((s) => s.id);

    // Get authors
    const authorIds = [...new Set(skills.map((s) => s.authorId))];
    const authorsResult = await db.select().from(users).where(inArray(users.id, authorIds));

    const authorsMap = new Map(authorsResult.map((u) => [u.id, u]));

    // Get published skill counts for each author
    const skillCountsResult = await db
      .select({
        authorId: marketplaceSkills.authorId,
        count: count(),
      })
      .from(marketplaceSkills)
      .where(
        and(inArray(marketplaceSkills.authorId, authorIds), eq(marketplaceSkills.isPublished, true))
      )
      .groupBy(marketplaceSkills.authorId);

    const skillCountsMap = new Map(skillCountsResult.map((sc) => [sc.authorId, sc.count]));

    // Get categories for all skills
    const skillCategoriesResult = await db
      .select({
        skillId: skillCategories.skillId,
        category: categories,
      })
      .from(skillCategories)
      .innerJoin(categories, eq(skillCategories.categoryId, categories.id))
      .where(inArray(skillCategories.skillId, skillIds));

    const categoriesMap = new Map<string, CategoryRecord[]>();
    for (const sc of skillCategoriesResult) {
      if (!categoriesMap.has(sc.skillId)) {
        categoriesMap.set(sc.skillId, []);
      }
      categoriesMap.get(sc.skillId)?.push(sc.category);
    }

    // Get tags for all skills
    const skillTagsResult = await db
      .select({
        skillId: skillTags.skillId,
        tag: tags,
      })
      .from(skillTags)
      .innerJoin(tags, eq(skillTags.tagId, tags.id))
      .where(inArray(skillTags.skillId, skillIds));

    const tagsMap = new Map<string, TagRecord[]>();
    for (const st of skillTagsResult) {
      if (!tagsMap.has(st.skillId)) {
        tagsMap.set(st.skillId, []);
      }
      tagsMap.get(st.skillId)?.push(st.tag);
    }

    // Map to MarketplaceSkill format
    return skills.map((skill) => {
      const author = authorsMap.get(skill.authorId);
      const skillCategories = categoriesMap.get(skill.id) || [];
      const skillTags = tagsMap.get(skill.id) || [];

      // Parse documentation if it's a string (for backward compatibility)
      let documentation = skill.documentation || [];
      if (typeof documentation === 'string') {
        try {
          documentation = JSON.parse(documentation);
        } catch (e) {
          console.warn(`Failed to parse documentation for skill ${skill.id}:`, e);
          documentation = [];
        }
      }

      // Parse metadata if it's a string
      let parsedMetadata: Record<string, string> | null = null;
      if (skill.metadata) {
        try {
          parsedMetadata =
            typeof skill.metadata === 'string' ? JSON.parse(skill.metadata) : skill.metadata;
        } catch (e) {
          console.warn(`Failed to parse metadata for skill ${skill.id}:`, e);
        }
      }

      return {
        id: skill.id,
        slug: skill.slug,
        name: skill.name,
        description: skill.description,
        longDescription: skill.longDescription,
        author: {
          id: author?.id || '',
          name: author?.name || 'Unknown',
          avatarUrl: author?.avatarUrl || null,
          bio: author?.bio || null,
          website: author?.website || null,
          agentCount: skillCountsMap.get(skill.authorId) || 0,
        },
        systemPromptFragment: skill.systemPromptFragment,
        workflowRules: skill.workflowRules,
        documentation,
        hasScripts: skill.hasScripts === 1,
        // Agent Skills Specification fields
        compatibility: skill.compatibility || undefined,
        metadata: parsedMetadata,
        latestVersion: skill.latestVersion,
        installCount: skill.installCount,
        rating: skill.rating,
        ratingCount: skill.ratingCount,
        isFeatured: skill.isFeatured,
        isPublished: skill.isPublished,
        iconUrl: skill.iconUrl,
        bannerUrl: skill.bannerUrl,
        categories: skillCategories.map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          description: c.description || '',
          icon: c.icon || undefined,
          displayOrder: c.displayOrder,
        })),
        tags: skillTags.map((t) => ({
          id: t.id,
          name: t.name,
          slug: t.slug,
          usageCount: t.usageCount,
        })),
        createdAt: new Date(skill.createdAt).toISOString(),
        updatedAt: new Date(skill.updatedAt).toISOString(),
      } as MarketplaceSkill;
    });
  }
}

export const skillsMarketplaceService = new SkillsMarketplaceService();
