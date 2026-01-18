import { describe, expect, it } from 'vitest';
import { extractAgentSpecFromText } from './create-agent-spec';

describe('extractAgentSpecFromText', () => {
  it('parses a JSON code block with required fields', () => {
    const text = [
      'Here you go:',
      '',
      '```json',
      '{',
      '  "name": "Code Helper",',
      '  "systemPrompt": "Assist with coding."',
      '}',
      '```',
      '',
    ].join('\n');

    const result = extractAgentSpecFromText(text);

    expect(result).toBeTruthy();
    expect(result?.name).toBe('Code Helper');
    expect(result?.systemPrompt).toBe('Assist with coding.');
  });

  it('returns null when no JSON is present', () => {
    const text = 'No JSON here.';
    expect(extractAgentSpecFromText(text)).toBeNull();
  });

  it('parses raw JSON without a code block', () => {
    const text = '{"name":"Spec Agent","systemPrompt":"Use JSON."}';
    const result = extractAgentSpecFromText(text);

    expect(result).toBeTruthy();
    expect(result?.name).toBe('Spec Agent');
  });
});
