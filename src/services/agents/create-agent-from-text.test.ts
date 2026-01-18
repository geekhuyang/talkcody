import { describe, expect, it, vi } from 'vitest';
import { persistCreateAgentFromText } from './create-agent-from-text';

vi.mock('@/services/agents/agent-registry', () => ({
  agentRegistry: {
    get: vi.fn().mockResolvedValue(undefined),
    forceRegister: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/services/agents/tool-registry', () => ({
  getAvailableToolsForUISync: vi.fn(() => [{ id: 'readFile', ref: {} }]),
}));

vi.mock('@/services/agents/agent-tool-access', () => ({
  isToolAllowedForAgent: vi.fn(() => true),
}));

vi.mock('@/stores/agent-store', () => ({
  useAgentStore: {
    getState: () => ({
      refreshAgents: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock('@/types/model-types', () => ({
  getModelType: vi.fn(() => 'main_model'),
}));

describe('persistCreateAgentFromText', () => {
  it('returns handled false when no JSON spec found', async () => {
    const result = await persistCreateAgentFromText('no json');
    expect(result.handled).toBe(false);
  });

  it('persists agent when JSON spec is valid', async () => {
    const text = [
      '',
      '',
      '```json',
      '{',
      '  "name": "Agent A",',
      '  "systemPrompt": "Prompt",',
      '  "tools": ["readFile"]',
      '}',
      '```',
      '',
    ].join('\n');

    const result = await persistCreateAgentFromText(text);

    expect(result.handled).toBe(true);
    expect(result.success).toBe(true);
  });
});
