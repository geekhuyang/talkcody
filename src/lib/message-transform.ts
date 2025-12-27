import type { ReasoningPart, TextPart } from '@ai-sdk/provider-utils';
import type { ModelMessage } from 'ai';

export namespace MessageTransform {
  /**
   * Check if caching should be applied for a provider
   */
  function shouldApplyCaching(providerId: string, modelId: string): boolean {
    const lowerProviderId = providerId.toLowerCase();
    const lowerModelId = modelId.toLowerCase();

    return (
      lowerProviderId.includes('anthropic') ||
      lowerProviderId.includes('claude') ||
      lowerModelId.includes('anthropic') ||
      lowerModelId.includes('claude') ||
      lowerModelId.includes('minimax')
    );
  }

  function applyCacheToMessage(msg: ModelMessage): void {
    const cacheOptions = {
      anthropic: {
        cacheControl: { type: 'ephemeral' },
      },
      openrouter: {
        cache_control: { type: 'ephemeral' },
      },
      openaiCompatible: {
        cache_control: { type: 'ephemeral' },
      },
    };

    const msgWithOptions = msg as unknown as { providerOptions?: object };
    msgWithOptions.providerOptions = {
      ...(msgWithOptions.providerOptions ?? {}),
      ...cacheOptions,
    };
  }

  function applyCaching(msgs: ModelMessage[]): void {
    const finalMsgs = msgs.filter((msg) => msg.role !== 'system').slice(-2);
    for (const msg of finalMsgs) {
      applyCacheToMessage(msg);
    }
  }

  /**
   * Check if the model is a DeepSeek model
   */
  function isDeepSeekModel(modelId: string, providerId?: string): boolean {
    return providerId === 'deepseek' || modelId.toLowerCase().includes('deepseek');
  }

  /**
   * Transform DeepSeek assistant content.
   * Extracts reasoning parts and moves to providerOptions.
   */
  function transformDeepSeekContent(content: Array<TextPart | ReasoningPart>): {
    content: Array<TextPart | ReasoningPart>;
    providerOptions?: { openaiCompatible: { reasoning_content: string } };
  } {
    const reasoningParts = content.filter((part) => part.type === 'reasoning');
    const nonReasoningContent = content.filter((part) => part.type !== 'reasoning');
    const reasoningText = reasoningParts.map((part) => part.text).join('');

    if (reasoningText) {
      return {
        content: nonReasoningContent,
        providerOptions: {
          openaiCompatible: {
            reasoning_content: reasoningText,
          },
        },
      };
    }

    return { content: nonReasoningContent };
  }

  /**
   * Unified transformation function for messages.
   *
   * Handles:
   * - Prompt caching for Anthropic/Claude providers
   * - DeepSeek reasoning content extraction (when assistantContent provided)
   *
   * @param msgs - The messages array to transform
   * @param modelId - The model identifier
   * @param providerId - The provider identifier
   * @param assistantContent - Optional: assistant content to transform (for DeepSeek)
   * @returns Transformed messages and optional transformed content
   */
  export function transform(
    msgs: ModelMessage[],
    modelId: string,
    providerId?: string,
    assistantContent?: Array<TextPart | ReasoningPart>
  ): {
    messages: ModelMessage[];
    transformedContent?: {
      content: Array<TextPart | ReasoningPart>;
      providerOptions?: { openaiCompatible: { reasoning_content: string } };
    };
  } {
    // Apply prompt caching for supported providers
    if (providerId && shouldApplyCaching(providerId, modelId)) {
      applyCaching(msgs);
    }

    // Transform assistant content for DeepSeek if provided
    let transformedContent:
      | {
          content: Array<TextPart | ReasoningPart>;
          providerOptions?: { openaiCompatible: { reasoning_content: string } };
        }
      | undefined;

    if (assistantContent) {
      if (isDeepSeekModel(modelId, providerId)) {
        transformedContent = transformDeepSeekContent(assistantContent);
      } else {
        transformedContent = { content: assistantContent };
      }
    }

    return { messages: msgs, transformedContent };
  }
}
