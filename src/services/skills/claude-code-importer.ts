/**
 * Claude Code Skills Importer
 *
 * Import skills from Claude Code's skills directories:
 * - ~/.claude/skills/ (personal skills)
 * - .claude/skills/ (project skills)
 */

import { homeDir, join } from '@tauri-apps/api/path';
import { exists, mkdir, readDir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { logger } from '@/lib/logger';
import { getAgentSkillService } from './agent-skill-service';
import { SkillMdParser } from './skill-md-parser';

export interface ClaudeCodeSkillLocation {
  path: string;
  name: string;
  type: 'personal' | 'project';
}

export interface ClaudeCodeSkillInfo {
  directoryName: string;
  hasSkillMd: boolean;
  hasReferenceMd: boolean;
  hasScriptsDir: boolean;
  scriptFiles: string[];
  sourcePath: string;
  skillName: string;
  description: string;
  isValid: boolean;
  error?: string;
}

/**
 * Claude Code Skills Importer Service
 */
// biome-ignore lint/complexity/noStaticOnlyClass: Utility class for Claude Code skill operations
export class ClaudeCodeImporter {
  /**
   * Get default Claude Code skills directory paths
   */
  static async getClaudeCodePaths(): Promise<ClaudeCodeSkillLocation[]> {
    const paths: ClaudeCodeSkillLocation[] = [];

    try {
      // Personal skills: ~/.claude/skills/
      const home = await homeDir();
      const personalPath = await join(home, '.claude', 'skills');

      if (await exists(personalPath)) {
        paths.push({
          path: personalPath,
          name: 'Personal Skills (~/.claude/skills/)',
          type: 'personal',
        });
      }
    } catch (error) {
      logger.warn('Failed to check personal Claude Code skills directory:', error);
    }

    // Note: Project skills (.claude/skills/) would require project root path
    // This can be added later when we have project context

    return paths;
  }

  /**
   * Scan a Claude Code skills directory for importable skills
   */
  static async scanClaudeCodeDirectory(directoryPath: string): Promise<ClaudeCodeSkillInfo[]> {
    const skills: ClaudeCodeSkillInfo[] = [];

    try {
      const entries = await readDir(directoryPath);

      for (const entry of entries) {
        if (!entry.isDirectory) {
          continue;
        }

        try {
          const skillInfo = await ClaudeCodeImporter.inspectClaudeCodeSkill(
            await join(directoryPath, entry.name)
          );
          skills.push(skillInfo);
        } catch (error) {
          logger.warn(`Failed to inspect skill ${entry.name}:`, error);
        }
      }
    } catch (error) {
      logger.error(`Failed to scan directory ${directoryPath}:`, error);
    }

    return skills.filter((s) => s.isValid);
  }

  /**
   * Inspect a Claude Code skill directory
   */
  static async inspectClaudeCodeSkill(skillPath: string): Promise<ClaudeCodeSkillInfo> {
    const directoryName = skillPath.split('/').pop() || '';

    const info: ClaudeCodeSkillInfo = {
      directoryName,
      sourcePath: skillPath,
      skillName: '',
      description: '',
      hasSkillMd: false,
      hasReferenceMd: false,
      hasScriptsDir: false,
      scriptFiles: [],
      isValid: false,
    };

    // Check for SKILL.md
    const skillMdPath = await join(skillPath, 'SKILL.md');
    info.hasSkillMd = await exists(skillMdPath);

    if (!info.hasSkillMd) {
      info.error = 'Missing SKILL.md';
      return info;
    }

    // Parse SKILL.md to get name and description
    try {
      const skillMdContent = await readTextFile(skillMdPath);
      const parsed = SkillMdParser.parse(skillMdContent);
      info.skillName = parsed.frontmatter.name;
      info.description = parsed.frontmatter.description;
      info.isValid = true;
    } catch (error) {
      info.error = `Failed to parse SKILL.md: ${error}`;
      return info;
    }

    // Check for REFERENCE.md
    const referenceMdPath = await join(skillPath, 'REFERENCE.md');
    info.hasReferenceMd = await exists(referenceMdPath);

    // Check for scripts directory
    const scriptsPath = await join(skillPath, 'scripts');
    info.hasScriptsDir = await exists(scriptsPath);

    if (info.hasScriptsDir) {
      try {
        const scriptEntries = await readDir(scriptsPath);
        info.scriptFiles = scriptEntries.filter((e) => e.isFile).map((e) => e.name);
      } catch (error) {
        logger.warn(`Failed to read scripts directory for ${directoryName}:`, error);
      }
    }

    return info;
  }

  /**
   * Import a Claude Code skill into TalkCody
   */
  static async importSkill(sourceSkillPath: string): Promise<void> {
    const skillService = await getAgentSkillService();
    const skillsDir = await skillService.getSkillsDirPath();

    // Get skill info
    const info = await ClaudeCodeImporter.inspectClaudeCodeSkill(sourceSkillPath);

    if (!info.isValid) {
      throw new Error(info.error || 'Invalid skill');
    }

    const targetPath = await join(skillsDir, info.directoryName);

    // Check if already exists
    if (await exists(targetPath)) {
      throw new Error(`Skill ${info.directoryName} already exists in TalkCody`);
    }

    // Create target directory
    await mkdir(targetPath, { recursive: true });

    // Copy SKILL.md
    const sourceSkillMd = await readTextFile(await join(sourceSkillPath, 'SKILL.md'));
    await writeTextFile(await join(targetPath, 'SKILL.md'), sourceSkillMd);

    // Copy REFERENCE.md if exists
    if (info.hasReferenceMd) {
      const sourceReferenceMd = await readTextFile(await join(sourceSkillPath, 'REFERENCE.md'));
      await writeTextFile(await join(targetPath, 'REFERENCE.md'), sourceReferenceMd);
    }

    // Copy scripts directory if exists
    if (info.hasScriptsDir && info.scriptFiles.length > 0) {
      const targetScriptsPath = await join(targetPath, 'scripts');
      await mkdir(targetScriptsPath, { recursive: true });

      for (const scriptFile of info.scriptFiles) {
        const sourceScriptPath = await join(sourceSkillPath, 'scripts', scriptFile);
        const targetScriptPath = await join(targetScriptsPath, scriptFile);
        const scriptContent = await readTextFile(sourceScriptPath);
        await writeTextFile(targetScriptPath, scriptContent);
      }
    }

    // Create TalkCody metadata
    const parsed = SkillMdParser.parse(sourceSkillMd);

    // Define internal metadata type
    interface TalkCodySkillMetadata {
      skillId: string;
      source: string;
      installedAt: number;
      lastUpdatedAt: number;
      tags: string[];
      version?: string;
    }

    const metadata: TalkCodySkillMetadata = {
      skillId: crypto.randomUUID(),
      source: 'claude-code',
      installedAt: Date.now(),
      lastUpdatedAt: Date.now(),
      tags: ['imported', 'claude-code'],
    };

    // Save Claude Code metadata if present
    if (parsed.frontmatter.metadata?.version) {
      metadata.version = parsed.frontmatter.metadata.version;
    }

    await writeTextFile(
      await join(targetPath, '.talkcody-metadata.json'),
      JSON.stringify(metadata, null, 2)
    );

    logger.info(
      `Successfully imported Claude Code skill: ${info.skillName} from ${sourceSkillPath}`
    );
  }

  /**
   * Import multiple skills
   */
  static async importMultipleSkills(sourceSkillPaths: string[]): Promise<{
    succeeded: string[];
    failed: Array<{ path: string; error: string }>;
  }> {
    const succeeded: string[] = [];
    const failed: Array<{ path: string; error: string }> = [];

    for (const path of sourceSkillPaths) {
      try {
        await ClaudeCodeImporter.importSkill(path);
        succeeded.push(path);
      } catch (error) {
        failed.push({
          path,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { succeeded, failed };
  }
}
