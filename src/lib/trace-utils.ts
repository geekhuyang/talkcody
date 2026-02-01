/**
 * Trace ID utilities for frontend observability
 * Format: "YYYYMMDDhhmmssfff-uuid" (same as Rust backend)
 * Example: "20260131143025012-a1b2c3d4"
 */

import { logger } from './logger';
import { generateId } from './utils';

/**
 * Generates a span ID (16 hex characters)
 */
export function generateSpanId(): string {
  return generateId().slice(0, 16);
}

/**
 * Interface for trace context to be passed through the request chain
 * Uses camelCase to match Rust serde expectations
 */
export interface TraceContext {
  /** Unique trace ID for the entire request chain */
  traceId: string;
  /** Human-readable name for this span */
  spanName: string;
  /** Parent span ID for nested spans (null if root) */
  parentSpanId: string | null;
}

/**
 * Creates a trace context for LLM operations
 * @param traceId The trace ID (should be taskId for agent loop traces)
 * @param model The model identifier (used in span name)
 * @param parentSpanId Optional parent span ID for nested spans
 * @returns TraceContext object
 */
export function createLlmTraceContext(
  traceId: string,
  model: string,
  parentSpanId?: string | null
): TraceContext {
  const context = {
    traceId: traceId,
    spanName: `chat ${model}`,
    parentSpanId: parentSpanId ?? null,
  };
  logger.info(`[Trace] Creating LLM trace context: ${JSON.stringify(context)}`);
  return context;
}
