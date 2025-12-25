import { streamText } from 'ai';
import { logger } from '@/lib/logger';
import { modelTypeService } from '@/providers/models/model-type-service';
import { useProviderStore } from '@/providers/stores/provider-store';
import { settingsManager } from '@/stores/settings-store';
import { ModelType } from '@/types/model-types';

export interface TitleGenerationResult {
  title: string;
}

class AITaskTitleService {
  async generateTitle(userInput: string): Promise<TitleGenerationResult | null> {
    try {
      logger.info('generateTitle for user input:', userInput);
      const startTime = performance.now();

      if (!userInput || userInput.trim().length === 0) {
        logger.error('No user input provided for title generation');
        return null;
      }

      // Resolve the small model type to get the actual model identifier
      const modelIdentifier = await modelTypeService.resolveModelType(ModelType.SMALL);
      logger.info('Resolved model identifier for SMALL type:', modelIdentifier);

      const language = settingsManager.getSync('language');
      const languageInstruction =
        language === 'zh'
          ? 'Generate the title in Chinese (中文).'
          : 'Generate the title in English.';

      const prompt = `You are an AI assistant that generates concise, descriptive titles for tasks.

User's message: "${userInput}"

Generate a short, clear title (5-10 words) that captures the essence of what the user is asking or discussing.

Guidelines:
1. Keep it concise (5-10 words maximum)
2. Use title case (capitalize first letter of main words)
3. Be specific and descriptive
4. Avoid generic titles like "New Chat" or "Question"
5. Focus on the main topic or intent

Examples:
- "Fix Login Bug"
- "Create User Dashboard"
- "Explain React Hooks"
- "Database Schema Design"
- "API Rate Limiting Issue"

${languageInstruction}

Provide ONLY the title without any quotes, explanations, or additional formatting.`;

      const { textStream } = await streamText({
        model: useProviderStore.getState().getProviderModel(modelIdentifier),
        prompt,
      });

      let fullText = '';
      for await (const delta of textStream) {
        fullText += delta;
      }

      const endTime = performance.now();
      const totalTime = endTime - startTime;

      logger.info(`Title generation completed - Total time: ${totalTime.toFixed(2)}ms`);

      const title = fullText.trim();
      logger.info('AI generated title:', title);

      if (title) {
        return {
          title,
        };
      }

      return null;
    } catch (error) {
      logger.error('AI title generation error:', error);
      return null;
    }
  }
}

export const aiTaskTitleService = new AITaskTitleService();
