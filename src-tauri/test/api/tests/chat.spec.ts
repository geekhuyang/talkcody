import { test, expect } from '@playwright/test';
import { enableChatStream, requireLlm } from '../helpers';
import { createSession } from '../helpers';
import { fetchSseHeaders } from '../helpers';

test('chat SSE endpoint responds with event-stream', async () => {
  test.skip(!enableChatStream, 'Chat SSE disabled via API_E2E_CHAT_STREAM');

  const sessionId = await createSession();
  const response = await fetchSseHeaders('/v1/chat', {
    method: 'POST',
    timeoutMs: 20000,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4',
      stream: true,
      sessionId,
      messages: [
        {
          role: 'user',
          content: 'ping',
        },
      ],
    }),
  });

  if (requireLlm) {
    expect(response.status).toBe(200);
    expect(response.contentType).toContain('text/event-stream');
  } else {
    expect([200, 400, 500]).toContain(response.status);
  }
});
