/**
 * GitHub Import Service
 * Wrapper for importing skills from GitHub using RemoteSkillConfig
 */

import { logger } from '@/lib/logger';
import type { GitHubSkillInfo } from './github-importer';
import { GitHubImporter } from './github-importer';

export interface ImportFromGitHubOptions {
  repository: string; // e.g., "talkcody/skills"
  path: string; // e.g., "skills/theme-factory"
  skillId: string; // Unique ID for the skill
}

/**
 * Import a skill from GitHub using simplified RemoteSkillConfig format
 */
export async function importSkillFromGitHub(options: ImportFromGitHubOptions): Promise<void> {
  const { repository, path, skillId } = options;

  // Parse repository (format: "owner/repo")
  const [owner, repo] = repository.split('/');
  if (!owner || !repo) {
    throw new Error(`Invalid repository format: ${repository}. Expected format: owner/repo`);
  }

  // Construct GitHub URL for discovering skills
  const branch = 'main'; // Default branch
  const githubUrl = `https://github.com/${repository}/tree/${branch}/${path}`;

  logger.info('Importing skill from GitHub:', {
    repository,
    path,
    skillId,
    githubUrl,
  });

  try {
    // Extract parent path and skill directory name
    const pathParts = path.split('/');
    const skillDirectoryName = pathParts.pop() || '';
    const parentPath = pathParts.join('/');

    // Construct repo info to scan the parent directory
    const repoInfo = {
      owner,
      repo,
      branch,
      path: parentPath,
    };

    // Scan the parent directory for skills
    const { skills, tempClonePath } = await GitHubImporter.scanGitHubDirectory(repoInfo);

    let skillInfo: GitHubSkillInfo | undefined;

    try {
      if (skills.length === 0) {
        throw new Error(`No valid skills found at ${githubUrl}`);
      }

      // Find the skill in the discovered list
      skillInfo = skills.find((s: GitHubSkillInfo) => s.directoryName === skillDirectoryName);

      if (!skillInfo) {
        throw new Error(
          `Skill not found at ${githubUrl}. Discovered skills: ${skills.map((s: GitHubSkillInfo) => s.directoryName).join(', ')}`
        );
      }

      if (!skillInfo.isValid) {
        throw new Error(
          `Invalid skill at ${githubUrl}: ${skillInfo.error || 'Missing required files'}`
        );
      }

      // Import the skill (handles both API and git clone methods)
      if (skillInfo._clonedPath) {
        await GitHubImporter.importSkillFromLocalDirectory(skillInfo, skillInfo._clonedPath);
      } else {
        await GitHubImporter.importSkillFromGitHub(skillInfo);
      }
    } finally {
      // Clean up temp directory if it exists
      if (tempClonePath) {
        try {
          const { remove } = await import('@tauri-apps/plugin-fs');
          await remove(tempClonePath, { recursive: true });
          logger.info('Cleaned up temporary clone directory');
        } catch (cleanupError) {
          logger.warn('Failed to clean up temp directory:', cleanupError);
        }
      }
    }

    if (skillInfo) {
      logger.info('Successfully imported skill from GitHub:', {
        skillName: skillInfo.skillName,
        directoryName: skillInfo.directoryName,
      });
    }
  } catch (error) {
    logger.error('Failed to import skill from GitHub:', error);
    throw error;
  }
}
