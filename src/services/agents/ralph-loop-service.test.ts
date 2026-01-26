// src/services/agents/ralph-loop-service.test.ts
import { describe, expect, it, vi } from 'vitest';
import { ralphLoopService } from '@/services/agents/ralph-loop-service';
import { taskFileService } from '@/services/task-file-service';
import type { AgentLoopCallbacks, AgentLoopOptions, AgentToolSet, UIMessage } from '@/types/agent';

vi.mock('@/services/message-service', () => ({
  messageService: {
    createAssistantMessage: vi.fn(() => 'assistant-id'),
    updateStreamingContent: vi.fn(),
    finalizeMessage: vi.fn(),
    addToolMessage: vi.fn(),
    addAttachment: vi.fn(),
  },
}));

vi.mock('@/services/task-file-service', () => ({
  taskFileService: {
    readFile: vi.fn(async () => null),
    writeFile: vi.fn(async () => '/tmp/mock'),
  },
}));

vi.mock('@/stores/file-changes-store', () => ({
  useFileChangesStore: {
    getState: () => ({
      getChanges: vi.fn(() => []),
    }),
  },
}));

vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: {
    getState: () => ({
      getRalphLoopEnabled: vi.fn(() => true),
    }),
  },
}));

vi.mock('@/stores/task-store', () => ({
  useTaskStore: {
    getState: () => ({
      getTask: vi.fn(() => ({
        id: 'task-1',
        settings: JSON.stringify({ ralphLoopEnabled: true }),
      })),
    }),
  },
}));

describe('RalphLoopService', () => {
  it('stops when completion marker appears', async () => {
    const abortController = new AbortController();
    const runAgentLoop = vi.fn(
      async (_options: AgentLoopOptions, callbacks: AgentLoopCallbacks) => {
        callbacks.onAssistantMessageStart?.();
        callbacks.onChunk?.('done');
        callbacks.onComplete?.('<ralph>COMPLETE</ralph>');
      }
    );

    const llmService = { runAgentLoop } as {
      runAgentLoop: (
        options: AgentLoopOptions,
        callbacks: AgentLoopCallbacks,
        abort?: AbortController
      ) => Promise<void>;
    };

    const messages: UIMessage[] = [
      {
        id: 'msg-1',
        role: 'user',
        content: 'Build feature X',
        timestamp: new Date(),
      },
    ];

    const result = await ralphLoopService.runLoop({
      taskId: 'task-1',
      messages,
      model: 'test-model',
      tools: {} as AgentToolSet,
      llmService,
      abortController,
      userMessage: 'Build feature X',
    });

    expect(result.stopReason).toBe('complete');
    expect(result.success).toBe(true);
    expect(runAgentLoop).toHaveBeenCalled();
  });

  it('stops when blocked marker appears', async () => {
    const abortController = new AbortController();
    const runAgentLoop = vi.fn(
      async (_options: AgentLoopOptions, callbacks: AgentLoopCallbacks) => {
        callbacks.onAssistantMessageStart?.();
        callbacks.onChunk?.('blocked');
        callbacks.onComplete?.('<ralph>BLOCKED: missing key</ralph>');
      }
    );

    const llmService = { runAgentLoop } as {
      runAgentLoop: (
        options: AgentLoopOptions,
        callbacks: AgentLoopCallbacks,
        abort?: AbortController
      ) => Promise<void>;
    };

    const result = await ralphLoopService.runLoop({
      taskId: 'task-1',
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Build feature X',
          timestamp: new Date(),
        },
      ],
      model: 'test-model',
      tools: {} as AgentToolSet,
      llmService,
      abortController,
      userMessage: 'Build feature X',
    });

    expect(result.stopReason).toBe('blocked');
    expect(result.stopMessage).toContain('missing key');
  });

  it('writes iteration artifacts', async () => {
    const abortController = new AbortController();
    const runAgentLoop = vi.fn(
      async (_options: AgentLoopOptions, callbacks: AgentLoopCallbacks) => {
        callbacks.onAssistantMessageStart?.();
        callbacks.onChunk?.('done');
        callbacks.onComplete?.('<ralph>COMPLETE</ralph>');
      }
    );

    const llmService = { runAgentLoop } as {
      runAgentLoop: (
        options: AgentLoopOptions,
        callbacks: AgentLoopCallbacks,
        abort?: AbortController
      ) => Promise<void>;
    };

    await ralphLoopService.runLoop({
      taskId: 'task-1',
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Build feature X',
          timestamp: new Date(),
        },
      ],
      model: 'test-model',
      tools: {} as AgentToolSet,
      llmService,
      abortController,
      userMessage: 'Build feature X',
    });

    expect(taskFileService.writeFile).toHaveBeenCalled();
  });

  it('respects max iteration limit', async () => {
    const abortController = new AbortController();
    const runAgentLoop = vi.fn(
      async (_options: AgentLoopOptions, callbacks: AgentLoopCallbacks) => {
        callbacks.onAssistantMessageStart?.();
        callbacks.onChunk?.('not done');
        callbacks.onComplete?.('still running');
      }
    );

    const llmService = { runAgentLoop } as {
      runAgentLoop: (
        options: AgentLoopOptions,
        callbacks: AgentLoopCallbacks,
        abort?: AbortController
      ) => Promise<void>;
    };

    const result = await ralphLoopService.runLoop({
      taskId: 'task-1',
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Build feature X',
          timestamp: new Date(),
        },
      ],
      model: 'test-model',
      tools: {} as AgentToolSet,
      llmService,
      abortController,
      userMessage: 'Build feature X',
    });

    expect(result.stopReason).toBe('max-iterations');
  });
});
