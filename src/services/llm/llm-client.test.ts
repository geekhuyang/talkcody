import { describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { llmClient } from './llm-client';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_event, handler) => {
    handler({
      payload: { type: 'text-delta', text: 'Hello ' },
    });
    handler({
      payload: { type: 'text-delta', text: 'world' },
    });
    handler({
      payload: { type: 'done', finish_reason: 'stop' },
    });
    return () => {};
  }),
}));

describe('llmClient', () => {
  it('collects text from streamed events', async () => {
    // Mock invoke to return the same requestId that was sent
    let capturedRequest: { traceContext?: { metadata?: Record<string, string> } } | null = null;
    (invoke as unknown as {
      mockImplementation: (
        fn: (cmd: string, args: { request: { requestId?: number; model?: string } }) => Promise<{
          request_id: number;
        }>
      ) => void;
    }).mockImplementation(async (_cmd, args) => {
      capturedRequest = args.request as { traceContext?: { metadata?: Record<string, string> } };
      return { request_id: args.request.requestId ?? 42 };
    });

    const result = await llmClient.collectText({
      model: 'test',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: true,
      traceContext: {
        traceId: 'trace-1',
        spanName: 'Step1-llm',
        parentSpanId: null,
      },
    });

    expect(result.text).toBe('Hello world');
    expect(result.finishReason).toBe('stop');
    expect(capturedRequest?.traceContext?.metadata?.client_start_ms).toBeTypeOf('string');
  });

});
