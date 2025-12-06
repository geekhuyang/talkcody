/**
 * R2 Storage Service
 *
 * Handles skill package upload/download via API to Cloudflare R2
 * This client service communicates with the API which has direct R2 access
 */

import { dirname } from '@tauri-apps/api/path';
import { exists, mkdir, readFile, writeFile } from '@tauri-apps/plugin-fs';
import { logger } from '@/lib/logger';
import { simpleFetch } from '@/lib/tauri-fetch';
import type { R2UploadResult } from '@/types/marketplace-skill';

/**
 * API Configuration
 */
interface ApiConfig {
  /** API base URL */
  baseUrl: string;

  /** CDN base URL for public access */
  cdnBaseUrl: string;

  /** Auth token (optional) */
  authToken?: string;
}

/**
 * Skill version metadata from R2
 */
export interface SkillVersionMetadata {
  version: string;
  metadata: Record<string, unknown> | null;
  packageUrl: string;
}

/**
 * R2 Storage Service
 */
export class R2StorageService {
  private config: ApiConfig = {
    baseUrl: import.meta.env.VITE_API_URL || 'https://api.talkcody.com',
    cdnBaseUrl: 'https://cdn.talkcody.com',
  };

  /**
   * Set API configuration
   */
  setConfig(config: Partial<ApiConfig>) {
    this.config = { ...this.config, ...config };
    logger.info('R2 Storage Service config updated', {
      baseUrl: this.config.baseUrl,
      cdnBaseUrl: this.config.cdnBaseUrl,
    });
  }

  /**
   * Set auth token for authenticated requests
   */
  setAuthToken(token: string) {
    this.config.authToken = token;
  }

  /**
   * Upload a skill package to R2
   */
  async uploadSkillPackage(
    skillId: string,
    version: string,
    packagePath: string,
    metadata: Record<string, unknown>
  ): Promise<R2UploadResult> {
    logger.info('Uploading skill package to R2:', {
      skillId,
      version,
      packagePath,
    });

    try {
      // Read file from local filesystem
      const fileData = await readFile(packagePath);

      // Create FormData
      const formData = new FormData();
      formData.append('file', new Blob([fileData], { type: 'application/gzip' }), 'package.tar.gz');
      formData.append('skillId', skillId);
      formData.append('version', version);
      formData.append('metadata', JSON.stringify(metadata));

      // Upload to API
      const headers: Record<string, string> = {};
      if (this.config.authToken) {
        headers.Authorization = `Bearer ${this.config.authToken}`;
      }

      const response = await simpleFetch(`${this.config.baseUrl}/api/skills/packages/upload`, {
        method: 'POST',
        headers,
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(error.error || 'Upload failed');
      }

      const result = await response.json();

      const uploadResult: R2UploadResult = {
        key: `skills/${skillId}/${version}/package.tar.gz`,
        url: result.packageUrl,
        size: fileData.byteLength,
        uploadedAt: Date.now(),
      };

      logger.info('Skill package uploaded successfully:', uploadResult);

      return uploadResult;
    } catch (error) {
      logger.error('Failed to upload skill package:', error);
      throw error;
    }
  }

  /**
   * Download a skill package from R2
   */
  async downloadSkillPackage(skillId: string, version: string, targetPath: string): Promise<void> {
    logger.info('Downloading skill package from R2:', {
      skillId,
      version,
      targetPath,
    });

    try {
      // Download from API
      const url = `${this.config.baseUrl}/api/skills/packages/${skillId}/${version}/download`;
      const response = await simpleFetch(url);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(error.error || 'Download failed');
      }

      // Get file data
      const arrayBuffer = await response.arrayBuffer();

      // Ensure parent directory exists before writing
      const parentDir = await dirname(targetPath);
      if (!(await exists(parentDir))) {
        await mkdir(parentDir, { recursive: true });
      }

      // Write to local filesystem
      await writeFile(targetPath, new Uint8Array(arrayBuffer));

      logger.info('Skill package downloaded successfully');
    } catch (error) {
      logger.error('Failed to download skill package:', error);
      throw error;
    }
  }

  /**
   * Delete a skill package from R2
   */
  async deleteSkillPackage(skillId: string, version: string): Promise<void> {
    logger.info('Deleting skill package from R2:', {
      skillId,
      version,
    });

    try {
      const headers: Record<string, string> = {};
      if (this.config.authToken) {
        headers.Authorization = `Bearer ${this.config.authToken}`;
      }

      const url = `${this.config.baseUrl}/api/skills/packages/${skillId}/${version}`;
      const response = await simpleFetch(url, {
        method: 'DELETE',
        headers,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(error.error || 'Delete failed');
      }

      logger.info('Skill package deleted successfully');
    } catch (error) {
      logger.error('Failed to delete skill package:', error);
      throw error;
    }
  }

  /**
   * List all versions of a skill
   */
  async listSkillVersions(skillId: string): Promise<SkillVersionMetadata[]> {
    logger.info('Listing skill versions:', skillId);

    try {
      const url = `${this.config.baseUrl}/api/skills/packages/${skillId}/versions`;
      const response = await simpleFetch(url);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(error.error || 'List versions failed');
      }

      const result = await response.json();
      return result.versions || [];
    } catch (error) {
      logger.error('Failed to list skill versions:', error);
      throw error;
    }
  }

  /**
   * Get public URL for a skill package
   */
  getPublicUrl(skillId: string, version: string): string {
    return `${this.config.cdnBaseUrl}/skills/${skillId}/${version}/package.tar.gz`;
  }

  /**
   * Get metadata URL for a skill package
   */
  getMetadataUrl(skillId: string, version: string): string {
    return `${this.config.cdnBaseUrl}/skills/${skillId}/${version}/metadata.json`;
  }
}

// Singleton instance
export const r2StorageService = new R2StorageService();
