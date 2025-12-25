// src/services/codex-instructions-service.ts
// Provides Codex system instructions from local file
// Based on OpenAI Codex CLI v0.77.0

import codexInstructions from './codex-instructions.md?raw';

/**
 * Get Codex instructions for the specified model
 * All models use the same unified instructions
 */
export async function getCodexInstructions(_normalizedModel = 'gpt-5.1-codex'): Promise<string> {
  return codexInstructions;
}
