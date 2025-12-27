// Skill management routes (CRUD operations)

import type { CreateSkillRequest, UpdateSkillRequest } from '@talkcody/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../db/client';
import { marketplaceSkills } from '../db/schema';
import { authMiddleware, getAuth } from '../middlewares/auth';
import { skillService } from '../services/skill-service';
import type { HonoContext } from '../types/context';

const skills = new Hono<HonoContext>();

/**
 * Helper: Resolve skill identifier to slug
 * If identifier is a UUID, look up the slug from database
 * Otherwise, assume it's already a slug
 */
async function resolveSkillSlug(identifier: string): Promise<string | null> {
  // Check if it's a UUID (format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (uuidRegex.test(identifier)) {
    // It's a UUID - look up the slug
    const { db } = getDb();
    const result = await db
      .select({ slug: marketplaceSkills.slug })
      .from(marketplaceSkills)
      .where(eq(marketplaceSkills.id, identifier))
      .limit(1);

    return result.length > 0 ? result[0].slug : null;
  }

  // It's already a slug
  return identifier;
}

/**
 * Create new skill (requires authentication)
 * POST /api/skills
 * Body: CreateSkillRequest
 */
skills.post('/', authMiddleware, async (c) => {
  try {
    const { userId } = getAuth(c);
    const data = await c.req.json<CreateSkillRequest>();

    // Validate required fields
    if (!data.name || !data.description || !data.documentation) {
      return c.json({ error: 'Missing required fields: name, description, documentation' }, 400);
    }

    const skill = await skillService.createSkill(userId, data);

    return c.json({ skill }, 201);
  } catch (error) {
    console.error('Create skill error:', error);
    const message = error instanceof Error ? error.message : 'Failed to create skill';
    return c.json({ error: message }, 500);
  }
});

/**
 * Update skill (requires authentication and ownership)
 * PATCH /api/skills/:skillId
 * Body: UpdateSkillRequest
 */
skills.patch('/:skillId', authMiddleware, async (c) => {
  try {
    const { userId } = getAuth(c);
    const skillId = c.req.param('skillId');
    const data = await c.req.json<UpdateSkillRequest>();

    const skill = await skillService.updateSkill(userId, skillId, data);

    return c.json({ skill });
  } catch (error) {
    console.error('Update skill error:', error);
    const message = error instanceof Error ? error.message : 'Failed to update skill';

    if (message.includes('not found') || message.includes('unauthorized')) {
      return c.json({ error: message }, 404);
    }

    return c.json({ error: message }, 500);
  }
});

/**
 * Publish skill (make it public)
 * POST /api/skills/:skillId/publish
 */
skills.post('/:skillId/publish', authMiddleware, async (c) => {
  try {
    const { userId } = getAuth(c);
    const skillId = c.req.param('skillId');

    const skill = await skillService.publishSkill(userId, skillId);

    return c.json({ skill });
  } catch (error) {
    console.error('Publish skill error:', error);
    const message = error instanceof Error ? error.message : 'Failed to publish skill';

    if (message.includes('not found') || message.includes('unauthorized')) {
      return c.json({ error: message }, 404);
    }

    return c.json({ error: message }, 500);
  }
});

/**
 * Unpublish skill
 * POST /api/skills/:skillId/unpublish
 */
skills.post('/:skillId/unpublish', authMiddleware, async (c) => {
  try {
    const { userId } = getAuth(c);
    const skillId = c.req.param('skillId');

    const skill = await skillService.unpublishSkill(userId, skillId);

    return c.json({ skill });
  } catch (error) {
    console.error('Unpublish skill error:', error);
    const message = error instanceof Error ? error.message : 'Failed to unpublish skill';

    if (message.includes('not found') || message.includes('unauthorized')) {
      return c.json({ error: message }, 404);
    }

    return c.json({ error: message }, 500);
  }
});

/**
 * Delete skill (requires authentication and ownership)
 * DELETE /api/skills/:skillId
 */
skills.delete('/:skillId', authMiddleware, async (c) => {
  try {
    const { userId } = getAuth(c);
    const skillId = c.req.param('skillId');

    await skillService.deleteSkill(userId, skillId);

    return c.json({ message: 'Skill deleted successfully' });
  } catch (error) {
    console.error('Delete skill error:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete skill';

    if (message.includes('not found') || message.includes('unauthorized')) {
      return c.json({ error: message }, 404);
    }

    return c.json({ error: message }, 500);
  }
});

/**
 * Create new version for skill
 * POST /api/skills/:skillId/versions
 * Body: { version, systemPromptFragment?, workflowRules?, documentation?, changeLog }
 */
skills.post('/:skillId/versions', authMiddleware, async (c) => {
  try {
    const { userId } = getAuth(c);
    const skillId = c.req.param('skillId');
    const data = await c.req.json();

    // Validate required fields
    if (!data.version || !data.changeLog) {
      return c.json({ error: 'Missing required fields: version, changeLog' }, 400);
    }

    const version = await skillService.createVersion(userId, skillId, data);

    return c.json({ version }, 201);
  } catch (error) {
    console.error('Create version error:', error);
    const message = error instanceof Error ? error.message : 'Failed to create version';

    if (message.includes('not found') || message.includes('unauthorized')) {
      return c.json({ error: message }, 404);
    }

    if (message.includes('already exists')) {
      return c.json({ error: message }, 409);
    }

    return c.json({ error: message }, 500);
  }
});

// ============================================================================
// R2 Storage Routes for Skill Package Management
// ============================================================================

/**
 * Upload skill package to R2
 * POST /api/skills/packages/upload
 * Body (multipart/form-data):
 *   - file: skill package file (tar.gz)
 *   - skillId: skill ID
 *   - version: version string
 *   - metadata: JSON string with skill metadata
 */
skills.post('/packages/upload', authMiddleware, async (c) => {
  try {
    const bucket = c.env?.RELEASES_BUCKET;
    if (!bucket) {
      return c.json({ error: 'R2 bucket not configured' }, 500);
    }

    const formData = await c.req.formData();
    const file = formData.get('file') as File;
    const skillId = formData.get('skillId') as string;
    const version = formData.get('version') as string;
    const metadataStr = formData.get('metadata') as string;

    // Validate inputs
    if (!file || !skillId || !version || !metadataStr) {
      return c.json({ error: 'Missing required fields: file, skillId, version, metadata' }, 400);
    }

    // Parse metadata
    let metadata: Record<string, unknown>;
    try {
      metadata = JSON.parse(metadataStr);
    } catch {
      return c.json({ error: 'Invalid metadata JSON' }, 400);
    }

    // Upload package file
    const packageKey = `skills/${skillId}/${version}/package.tar.gz`;
    const packageBuffer = await file.arrayBuffer();
    await bucket.put(packageKey, packageBuffer, {
      httpMetadata: {
        contentType: 'application/gzip',
        cacheControl: 'public, max-age=31536000',
      },
    });

    // Upload metadata file
    const metadataKey = `skills/${skillId}/${version}/metadata.json`;
    await bucket.put(metadataKey, JSON.stringify(metadata, null, 2), {
      httpMetadata: {
        contentType: 'application/json',
        cacheControl: 'public, max-age=3600',
      },
    });

    const cdnBaseUrl = 'https://cdn.talkcody.com';
    return c.json({
      success: true,
      skillId,
      version,
      packageUrl: `${cdnBaseUrl}/${packageKey}`,
      metadataUrl: `${cdnBaseUrl}/${metadataKey}`,
    });
  } catch (error) {
    console.error('Upload skill package error:', error);
    const message = error instanceof Error ? error.message : 'Failed to upload skill package';
    return c.json({ error: message }, 500);
  }
});

/**
 * Download skill package from R2
 * GET /api/skills/packages/:skillId/:version/download
 * Note: skillId can be either a UUID or slug - both are supported
 */
skills.get('/packages/:skillId/:version/download', async (c) => {
  try {
    const bucket = c.env?.RELEASES_BUCKET;
    if (!bucket) {
      return c.json({ error: 'R2 bucket not configured' }, 500);
    }

    const skillIdOrSlug = c.req.param('skillId');
    const version = c.req.param('version');

    // Resolve UUID to slug if needed
    const slug = await resolveSkillSlug(skillIdOrSlug);
    if (!slug) {
      return c.json({ error: 'Skill not found' }, 404);
    }

    // Use slug for R2 key (not UUID)
    const key = `skills/${slug}/${version}/package.tar.gz`;

    const object = await bucket.get(key);
    if (!object) {
      return c.json({ error: 'Package not found' }, 404);
    }

    // Stream the file to the client
    return new Response(object.body, {
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="${slug}-${version}.tar.gz"`,
        'Cache-Control': 'public, max-age=31536000',
      },
    });
  } catch (error) {
    console.error('Download skill package error:', error);
    const message = error instanceof Error ? error.message : 'Failed to download skill package';
    return c.json({ error: message }, 500);
  }
});

/**
 * List all versions for a skill
 * GET /api/skills/packages/:skillId/versions
 * Note: skillId can be either a UUID or slug - both are supported
 */
skills.get('/packages/:skillId/versions', async (c) => {
  try {
    const bucket = c.env?.RELEASES_BUCKET;
    if (!bucket) {
      return c.json({ error: 'R2 bucket not configured' }, 500);
    }

    const skillIdOrSlug = c.req.param('skillId');

    // Resolve UUID to slug if needed
    const slug = await resolveSkillSlug(skillIdOrSlug);
    if (!slug) {
      return c.json({ error: 'Skill not found' }, 404);
    }

    // Use slug for R2 prefix (not UUID)
    const prefix = `skills/${slug}/`;

    // List all objects with the skill prefix
    const listed = await bucket.list({ prefix, delimiter: '/' });

    // Extract version directories
    const versions: string[] = [];
    for (const prefix of listed.delimitedPrefixes) {
      // prefix format: "skills/{slug}/{version}/"
      const parts = prefix.split('/');
      if (parts.length >= 3) {
        versions.push(parts[2]);
      }
    }

    const versionDetails = await Promise.all(
      versions.map(async (version) => {
        const metadataKey = `skills/${slug}/${version}/metadata.json`;
        const metadataObj = await bucket.get(metadataKey);
        if (metadataObj) {
          const metadata = await metadataObj.json();
          return {
            version,
            metadata,
            packageUrl: `https://cdn.talkcody.com/skills/${slug}/${version}/package.tar.gz`,
          };
        }
        return {
          version,
          metadata: null,
          packageUrl: `https://cdn.talkcody.com/skills/${slug}/${version}/package.tar.gz`,
        };
      })
    );

    return c.json({
      skillId: skillIdOrSlug,
      slug,
      versions: versionDetails,
    });
  } catch (error) {
    console.error('List skill versions error:', error);
    const message = error instanceof Error ? error.message : 'Failed to list skill versions';
    return c.json({ error: message }, 500);
  }
});

/**
 * Delete a specific skill version from R2
 * DELETE /api/skills/packages/:skillId/:version
 * Note: skillId can be either a UUID or slug - both are supported
 */
skills.delete('/packages/:skillId/:version', authMiddleware, async (c) => {
  try {
    const bucket = c.env?.RELEASES_BUCKET;
    if (!bucket) {
      return c.json({ error: 'R2 bucket not configured' }, 500);
    }

    const skillIdOrSlug = c.req.param('skillId');
    const version = c.req.param('version');

    // Resolve UUID to slug if needed
    const slug = await resolveSkillSlug(skillIdOrSlug);
    if (!slug) {
      return c.json({ error: 'Skill not found' }, 404);
    }

    // Delete package and metadata using slug (not UUID)
    const packageKey = `skills/${slug}/${version}/package.tar.gz`;
    const metadataKey = `skills/${slug}/${version}/metadata.json`;

    await Promise.all([bucket.delete(packageKey), bucket.delete(metadataKey)]);

    return c.json({
      success: true,
      message: `Skill package ${slug}@${version} deleted successfully`,
    });
  } catch (error) {
    console.error('Delete skill package error:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete skill package';
    return c.json({ error: message }, 500);
  }
});

export default skills;
