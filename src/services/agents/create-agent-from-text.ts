import { logger } from '@/lib/logger';
import { agentRegistry } from '@/services/agents/agent-registry';
import { isToolAllowedForAgent } from '@/services/agents/agent-tool-access';
import { getAvailableToolsForUISync } from '@/services/agents/tool-registry';
import { useAgentStore } from '@/stores/agent-store';
import type { AgentToolSet } from '@/types/agent';
import { getModelType } from '@/types/model-types';
import type { ToolWithUI } from '@/types/tool';
import { extractAgentSpecFromText } from './create-agent-spec';

export type CreateAgentPersistResult = {
  handled: boolean;
  success?: boolean;
  reason?: 'invalid_id' | 'persist_failed';
};

function slugifyId(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export async function persistCreateAgentFromText(
  assistantText: string
): Promise<CreateAgentPersistResult> {
  const spec = extractAgentSpecFromText(assistantText);
  if (!spec) return { handled: false };

  const idBase = slugifyId(spec.id || spec.name);
  if (!idBase) {
    return { handled: true, success: false, reason: 'invalid_id' };
  }

  const availableTools = getAvailableToolsForUISync();
  const tools: AgentToolSet = {};

  for (const toolId of spec.tools || []) {
    if (!isToolAllowedForAgent(idBase, toolId)) continue;
    const match = availableTools.find((tool) => tool.id === toolId);
    if (match) {
      tools[toolId] = match.ref as ToolWithUI;
    } else if (toolId.includes('__')) {
      tools[toolId] = { _isMCPTool: true, _mcpToolName: toolId } as unknown as ToolWithUI;
    }
  }

  let newId = idBase;
  let counter = 1;
  while (await agentRegistry.get(newId)) {
    newId = `${idBase}-${counter++}`;
  }

  try {
    await agentRegistry.forceRegister({
      id: newId,
      name: spec.name,
      description: spec.description,
      modelType: getModelType(spec.modelType),
      systemPrompt: spec.systemPrompt,
      tools,
      rules: spec.rules,
      outputFormat: spec.outputFormat,
      hidden: spec.hidden ?? false,
      isDefault: false,
      dynamicPrompt: spec.dynamicPrompt
        ? {
            enabled: spec.dynamicPrompt.enabled ?? false,
            providers: spec.dynamicPrompt.providers ?? [],
            variables: spec.dynamicPrompt.variables ?? {},
            providerSettings: spec.dynamicPrompt.providerSettings ?? {},
          }
        : undefined,
      defaultSkills: spec.defaultSkills,
      role: spec.role,
      canBeSubagent: spec.canBeSubagent ?? true,
    });

    await useAgentStore.getState().refreshAgents();

    return { handled: true, success: true };
  } catch (error) {
    logger.error('Failed to persist agent from JSON spec:', error);
    return { handled: true, success: false, reason: 'persist_failed' };
  }
}
