// src/services/image-generation-service.ts

import { createOpenAI } from '@ai-sdk/openai';
import { experimental_generateImage, NoImageGeneratedError } from 'ai';
import { logger } from '@/lib/logger';
import { streamFetch } from '@/lib/tauri-fetch';
import { generateId } from '@/lib/utils';
import type { MessageAttachment } from '../types/agent';
import { fileService } from './file-service';

export class ImageGenerationService {
  private openai;

  constructor() {
    const apiKey = import.meta.env.VITE_OPENAI_API_KEY;

    if (!apiKey) {
      logger.error('VITE_OPENAI_API_KEY environment variable is not set');
    }

    this.openai = createOpenAI({
      apiKey,
      fetch: streamFetch as typeof fetch,
    });
  }

  async generateImage(
    prompt: string,
    model: string,
    onComplete?: (attachment: MessageAttachment) => void,
    onError?: (error: Error) => void
  ): Promise<MessageAttachment | null> {
    try {
      logger.info('Generating image with model:', model);
      logger.info('Prompt:', prompt);

      const { image } = await experimental_generateImage({
        model: this.openai.image(model),
        prompt,
        size: '1024x1024',
        n: 1,
      });

      // Create unique filename for the generated image
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `gen-${timestamp}.png`;

      // Save image to local file system
      const savedFilePath = await fileService.saveGeneratedImage(image.uint8Array, filename);

      // Create MessageAttachment object
      const attachment: MessageAttachment = {
        id: generateId(),
        type: 'image',
        filename,
        content: image.base64,
        filePath: savedFilePath,
        mimeType: image.mediaType,
        size: image.uint8Array.length,
      };

      if (onComplete) {
        onComplete(attachment);
      }

      return attachment;
    } catch (error) {
      if (NoImageGeneratedError.isInstance(error)) {
        logger.info('NoImageGeneratedError');
        logger.info('Cause:', error.cause);
        logger.info('Responses:', error.responses);
      }
      logger.error('ImageGenerationService Error:', error);
      const imageError = new Error('Error occurred while generating image');
      if (onError) {
        onError(imageError);
      } else {
        throw imageError;
      }
      return null;
    }
  }
}

export const imageGenerationService = new ImageGenerationService();
