import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LLMService } from '@/services/agents/llm-service';

if (!globalThis.atob) {
  globalThis.atob = (input: string) => Buffer.from(input, 'base64').toString('binary');
}

vi.mock('@/services/llm/llm-client', () => ({
  llmClient: {
    streamText: vi.fn(),
    generateImage: vi.fn(),
  },
}));

vi.mock('@/services/file-service', () => ({
  fileService: {
    saveGeneratedImage: vi.fn(async (_data: Uint8Array, filename: string) =>
      Promise.resolve(`/tmp/${filename}`)
    ),
    uint8ArrayToBase64Public: vi.fn((bytes: Uint8Array) =>
      Buffer.from(bytes).toString('base64')
    ),
  },
}));

vi.mock('@/lib/tauri-fetch', () => ({
  simpleFetch: vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    headers: new Headers({ 'content-type': 'image/png' }),
  })),
}));

vi.mock('@/providers/models/model-type-service', () => ({
  modelTypeService: {
    resolveModelType: vi.fn(async () => 'gemini-3-pro-image@aiGateway'),
    resolveModelTypeSync: vi.fn(() => 'gemini-3-pro-image@aiGateway'),
  },
}));

vi.mock('@/services/hooks/hook-service', () => ({
  hookService: {
    runStop: vi.fn().mockResolvedValue({ blocked: false, continue: true, additionalContext: [] }),
    runSessionStart: vi
      .fn()
      .mockResolvedValue({ blocked: false, continue: true, additionalContext: [] }),
    runPreToolUse: vi.fn().mockResolvedValue({ blocked: false, continue: true, additionalContext: [] }),
    runPostToolUse: vi.fn().mockResolvedValue({ blocked: false, continue: true, additionalContext: [] }),
  },
}));

vi.mock('@/services/hooks/hook-state-service', () => ({
  hookStateService: {
    consumeAdditionalContext: vi.fn(() => []),
  },
}));

vi.mock('@/lib/llm-utils', () => ({
  convertMessages: vi.fn().mockImplementation((messages) => Promise.resolve(messages || [])),
  formatReasoningText: vi
    .fn()
    .mockImplementation((text, isFirst) => (isFirst ? `\n<thinking>\n${text}` : text)),
}));

vi.mock('@/providers/stores/provider-store', () => ({
  useProviderStore: {
    getState: () => ({
      isModelAvailable: () => true,
      availableModels: [],
      apiKeys: {},
      providers: new Map(),
      customProviders: {},
    }),
  },
}));

vi.mock('@/stores/task-store', () => ({
  useTaskStore: {
    getState: () => ({
      updateTask: vi.fn(),
      updateTaskUsage: vi.fn(),
      getMessages: vi.fn(() => []),
    }),
  },
}));

vi.mock('@/services/database-service', () => ({
  databaseService: {
    insertApiUsageEvent: vi.fn().mockResolvedValue(undefined),
    startSpan: vi.fn().mockResolvedValue(undefined),
    endSpan: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/services/ai/ai-pricing-service', () => ({
  aiPricingService: {
    calculateCost: vi.fn().mockResolvedValue(0),
  },
}));

vi.mock('@/providers/config/model-config', () => ({
  getContextLength: vi.fn(() => 8192),
}));

vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: {
    getState: () => ({
      language: 'en',
      getTraceEnabled: () => false,
      getReasoningEffort: () => 'medium',
    }),
  },
}));

vi.mock('@/services/workspace-root-service', () => ({
  getEffectiveWorkspaceRoot: vi.fn().mockResolvedValue('/tmp'),
}));

describe('LLMService image generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits attachments for image generation models', async () => {
    const { llmClient } = await import('@/services/llm/llm-client');
    vi.mocked(llmClient.generateImage).mockResolvedValue({
      provider: 'aiGateway',
      images: [
        {
          b64Json: 'iVBORw0KGgoAAAANSUhEUgAAAAUA',
          mimeType: 'image/png',
        },
      ],
    });

    const service = new LLMService('task-1');
    const attachments: string[] = [];

    await service.runAgentLoop(
      {
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Generate a sunset image',
            timestamp: new Date(),
          },
        ],
        model: 'gemini-3-pro-image@aiGateway',
        tools: {},
      },
      {
        onChunk: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onStatus: vi.fn(),
        onAttachment: (attachment) => attachments.push(attachment.filename),
      }
    );

    expect(attachments.length).toBe(1);
    expect(attachments[0]).toContain('generated-');
  });

  it('skips image generation when no prompt is provided', async () => {
    const service = new LLMService('task-1');

    await expect(
      service.runAgentLoop(
        {
          messages: [
            {
              id: 'msg-1',
              role: 'user',
              content: '',
              timestamp: new Date(),
            },
          ],
          model: 'dall-e-3@openai',
          tools: {},
        },
        {
          onChunk: vi.fn(),
          onComplete: vi.fn(),
          onError: vi.fn(),
          onStatus: vi.fn(),
        }
      )
    ).rejects.toThrow('Image prompt is empty');
  });
});
