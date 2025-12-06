// src/services/ai-transcription-service.ts
import { logger } from '@/lib/logger';
import type { ModelKey, ProviderType } from '@/lib/models';
import { getProvidersForModel, MODEL_CONFIGS } from '@/lib/models';
import { simpleFetch } from '@/lib/tauri-fetch';
import { settingsManager } from '@/stores/settings-store';
import { MODEL_TYPE_SETTINGS_KEYS, ModelType } from '@/types/model-types';

export interface TranscriptionContext {
  audioBlob: Blob;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  durationInSeconds?: number;
}

class AITranscriptionService {
  /**
   * Resolve the provider-specific model name
   */
  private resolveProviderModelName(modelKey: string, providerId: string): string {
    const config = MODEL_CONFIGS[modelKey as ModelKey];

    // Use provider-specific mapping if available, otherwise use the original model key
    return config?.providerMappings?.[providerId as ProviderType] || modelKey;
  }

  async transcribe(context: TranscriptionContext): Promise<TranscriptionResult | null> {
    try {
      logger.info('Starting audio transcription', {
        audioBlobSize: context.audioBlob.size,
        audioBlobType: context.audioBlob.type,
      });

      const startTime = performance.now();

      // Get transcription model from settings
      const settingsKey = MODEL_TYPE_SETTINGS_KEYS[ModelType.TRANSCRIPTION];
      const modelIdentifier = await settingsManager.get(settingsKey);

      if (!modelIdentifier) {
        throw new Error(
          'No transcription model configured. Please select a transcription model in settings.'
        );
      }

      logger.info('Using transcription model:', modelIdentifier);

      // Parse model identifier (format: "modelKey@provider" or "modelKey")
      const [modelKey, explicitProvider] = modelIdentifier.includes('@')
        ? modelIdentifier.split('@')
        : [modelIdentifier, null];

      // Get provider for the model
      const providers = getProvidersForModel(modelKey);
      const apiKeys = await settingsManager.getApiKeys();

      let selectedProvider = explicitProvider;
      if (!selectedProvider) {
        // Find first available provider
        for (const provider of providers) {
          const apiKey = apiKeys[provider.id as keyof typeof apiKeys];
          if (apiKey) {
            selectedProvider = provider.id;
            break;
          }
        }
      }

      if (!selectedProvider) {
        throw new Error(
          'No available provider for transcription. Please configure API keys in settings.'
        );
      }

      logger.info('Using provider:', selectedProvider);

      // Get provider-specific model name
      const providerModelName = this.resolveProviderModelName(modelKey, selectedProvider);
      logger.info('Provider-specific model name:', providerModelName);

      // Route to appropriate transcription method based on provider
      let result: TranscriptionResult | null = null;

      if (selectedProvider === 'openRouter') {
        result = await this.transcribeWithOpenRouter(
          context,
          providerModelName,
          apiKeys.openRouter
        );
      } else if (selectedProvider === 'openai') {
        result = await this.transcribeWithOpenAI(context, apiKeys.openai);
      } else if (selectedProvider === 'google') {
        result = await this.transcribeWithGoogle(context, providerModelName, apiKeys.google);
      } else {
        throw new Error(`Transcription not supported for provider: ${selectedProvider}`);
      }

      const endTime = performance.now();
      const totalTime = endTime - startTime;

      logger.info('Transcription completed', {
        totalTime: `${totalTime.toFixed(2)}ms`,
        textLength: result?.text?.length || 0,
        language: result?.language,
        duration: result?.durationInSeconds,
      });

      if (!result || !result.text || result.text.trim().length === 0) {
        logger.warn('Transcription returned empty text');
        return null;
      }

      return {
        text: result.text.trim(),
        language: result.language,
        durationInSeconds: result.durationInSeconds,
      };
    } catch (error) {
      logger.error('Transcription error:', error);

      // Provide more helpful error messages
      if (error instanceof Error) {
        if (
          error.message.includes('No transcription model configured') ||
          error.message.includes('No available provider') ||
          error.message.includes('Transcription not supported')
        ) {
          throw error; // Pass through our custom error messages
        }
        throw new Error(`Transcription failed: ${error.message}`);
      }

      throw new Error('Transcription failed: Unknown error occurred');
    }
  }

  /**
   * Transcribe audio using OpenRouter API
   */
  private async transcribeWithOpenRouter(
    context: TranscriptionContext,
    model: string,
    apiKey?: string
  ): Promise<TranscriptionResult | null> {
    if (!apiKey) {
      throw new Error('OpenRouter API key not configured');
    }

    // Convert audio blob to base64
    const arrayBuffer = await context.audioBlob.arrayBuffer();
    const base64Audio = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

    // Determine audio format from MIME type
    const format = context.audioBlob.type.includes('wav')
      ? 'wav'
      : context.audioBlob.type.includes('mp3')
        ? 'mp3'
        : context.audioBlob.type.includes('webm')
          ? 'webm'
          : 'wav';

    const response = await simpleFetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://talkcody.com',
        'X-Title': 'TalkCody',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Please transcribe the following audio accurately. Only return the transcribed text without any additional comments or formatting.',
              },
              {
                type: 'input_audio',
                input_audio: {
                  data: base64Audio,
                  format: format,
                },
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(
        errorData.error?.message || `OpenRouter API failed with status ${response.status}`
      );
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';

    return {
      text,
    };
  }

  /**
   * Transcribe audio using OpenAI Whisper API
   */
  private async transcribeWithOpenAI(
    context: TranscriptionContext,
    apiKey?: string
  ): Promise<TranscriptionResult | null> {
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    // Convert blob to file
    const audioFile = new File([context.audioBlob], 'recording.webm', {
      type: context.audioBlob.type || 'audio/webm',
    });

    const formData = new FormData();
    formData.append('file', audioFile);
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'verbose_json');

    const baseUrl = await settingsManager.getProviderBaseUrl('openai');
    const apiUrl = baseUrl
      ? `${baseUrl}/audio/transcriptions`
      : 'https://api.openai.com/v1/audio/transcriptions';

    const response = await simpleFetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: { message: 'Unknown error' } }));
      throw new Error(
        errorData.error?.message || `OpenAI API failed with status ${response.status}`
      );
    }

    const result = await response.json();

    return {
      text: result.text || '',
      language: result.language,
      durationInSeconds: result.duration,
    };
  }

  /**
   * Transcribe audio using Google Gemini API
   */
  private async transcribeWithGoogle(
    context: TranscriptionContext,
    model: string,
    apiKey?: string
  ): Promise<TranscriptionResult | null> {
    if (!apiKey) {
      throw new Error('Google API key not configured');
    }

    // Convert audio to base64
    const arrayBuffer = await context.audioBlob.arrayBuffer();
    const base64Audio = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

    // Use Gemini API to transcribe
    const response = await simpleFetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  inline_data: {
                    mime_type: context.audioBlob.type || 'audio/webm',
                    data: base64Audio,
                  },
                },
                {
                  text: 'Please transcribe this audio accurately. Only return the transcribed text without any additional comments or formatting.',
                },
              ],
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: { message: 'Unknown error' } }));
      throw new Error(
        errorData.error?.message || `Google API failed with status ${response.status}`
      );
    }

    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';

    return {
      text,
    };
  }
}

export const aiTranscriptionService = new AITranscriptionService();
