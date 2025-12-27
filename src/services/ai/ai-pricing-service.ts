import { logger } from '@/lib/logger';
import { MODEL_CONFIGS } from '@/providers/config/model-config';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
}

class AIPricingService {
  private getModel(modelId: string) {
    // Try direct lookup first
    if (MODEL_CONFIGS[modelId]) {
      return MODEL_CONFIGS[modelId];
    }

    // Try without @provider suffix (e.g., "claude-sonnet-4.5@openRouter" -> "claude-sonnet-4.5")
    const baseModelId = modelId.includes('@') ? modelId.split('@')[0] : modelId;
    if (baseModelId && MODEL_CONFIGS[baseModelId]) {
      return MODEL_CONFIGS[baseModelId];
    }

    return undefined;
  }

  calculateCost(modelId: string, usage: TokenUsage): number {
    const model = this.getModel(modelId);
    if (!model?.pricing) {
      logger.error(`Pricing information not available for model: ${modelId}`);
      return 0;
    }

    let cost = 0;
    cost += usage.inputTokens * (Number.parseFloat(model.pricing.input) || 0);
    cost += usage.outputTokens * (Number.parseFloat(model.pricing.output) || 0);

    return cost;
  }
}

export const aiPricingService = new AIPricingService();
