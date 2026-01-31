/**
 * Trace ID utilities for frontend observability
 * Format: "YYYYMMDDhhmmssfff-uuid" (same as Rust backend)
 * Example: "20260131143025012-a1b2c3d4"
 */

import { generateId } from './utils';

/**
 * Generates a trace ID in the format "YYYYMMDDhhmmssfff-uuid"
 * Matches the format used by the Rust backend
 */
export function generateTraceId(): string {
  const now = new Date();

  // Format date components with leading zeros
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const milliseconds = String(now.getMilliseconds()).padStart(3, '0');

  // Generate a short UUID (8 characters)
  const shortUuid = generateId().slice(0, 8);

  return `${year}${month}${day}${hours}${minutes}${seconds}${milliseconds}-${shortUuid}`;
}

/**
 * Interface for trace context to be passed through the request chain
 */
export interface TraceContext {
  /** Unique trace ID for the entire request chain */
  trace_id: string;
  /** Human-readable name for this span */
  span_name: string;
  /** Parent span ID for nested spans (null if root) */
  parent_span_id: string | null;
}

/**
 * Creates a trace context for LLM operations
 * @param traceId The trace ID (should be generated once per agent loop)
 * @param model The model identifier (used in span name)
 * @returns TraceContext object
 */
export function createLlmTraceContext(traceId: string, model: string): TraceContext {
  return {
    trace_id: traceId,
    span_name: `chat ${model}`,
    parent_span_id: null,
  };
}
