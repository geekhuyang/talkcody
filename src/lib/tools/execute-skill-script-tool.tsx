import { z } from 'zod';
import { ExecuteSkillScriptDoing } from '@/components/tools/execute-skill-script-doing';
import { ExecuteSkillScriptResult } from '@/components/tools/execute-skill-script-result';
import { createTool } from '@/lib/create-tool';
import {
  type ScriptExecutionResult as ScriptResult,
  scriptExecutor,
} from '@/services/script-executor';

export const executeSkillScriptTool = createTool({
  name: 'executeSkillScript',
  description: `Execute a skill script (Python, Bash, or Node.js).

This tool allows you to execute scripts from file-based skills that require external script execution.

Supported script types:
- python: Python scripts (.py files)
- bash/sh: Shell scripts (.sh files)
- nodejs/javascript: Node.js scripts (.js files)

Script files must exist in the skill's scripts/ directory.

Example usage:
- Execute a Python data processing script
- Run a bash automation script
- Execute a Node.js helper script

The script will be executed with the specified arguments and environment variables.`,
  inputSchema: z.object({
    script_path: z.string().describe('Absolute path to the script file to execute'),
    script_type: z
      .enum(['python', 'bash', 'sh', 'nodejs', 'javascript'])
      .describe('Type of script (python, bash, sh, nodejs, or javascript)'),
    args: z
      .array(z.string())
      .optional()
      .default([])
      .describe('Command-line arguments to pass to the script'),
    working_dir: z
      .string()
      .optional()
      .describe('Working directory for script execution (default: script directory)'),
    timeout_ms: z.number().optional().describe('Timeout in milliseconds (default: 120000)'),
    environment: z
      .record(z.string(), z.string())
      .optional()
      .describe('Environment variables to set for the script'),
  }),
  canConcurrent: false,
  hidden: true,
  execute: async ({
    script_path,
    script_type,
    args = [],
    working_dir,
    timeout_ms,
    environment,
  }): Promise<ScriptResult> => {
    return await scriptExecutor.execute({
      script_path,
      script_type,
      args,
      working_dir,
      timeout_ms: timeout_ms || 120000, // Default 2 minutes
      environment,
    });
  },
  renderToolDoing: ({ script_path, script_type }) => (
    <ExecuteSkillScriptDoing script_path={script_path} script_type={script_type} />
  ),
  renderToolResult: (result) => (
    <ExecuteSkillScriptResult
      stdout={result?.stdout}
      stderr={result?.stderr}
      exit_code={result?.exit_code}
      execution_time_ms={result?.execution_time_ms}
      success={result?.success ?? false}
      error={result?.error}
    />
  ),
});
