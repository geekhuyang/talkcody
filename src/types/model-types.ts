import {
  GEMINI_25_FLASH_LITE,
  GPT51_CODE_MAX,
  NANO_BANANA_PRO,
  SCRIBE_V2_REALTIME,
} from '@/lib/models';

export enum ModelType {
  MAIN = 'main_model',
  SMALL = 'small_model',
  MESSAGE_COMPACTION = 'message_compaction_model',
  IMAGE_GENERATOR = 'image_generator_model',
  TRANSCRIPTION = 'transcription_model',
}

export const MODEL_TYPE_LABELS: Record<ModelType, string> = {
  [ModelType.MAIN]: 'Main Model',
  [ModelType.SMALL]: 'Small Model',
  [ModelType.IMAGE_GENERATOR]: 'Image Generator',
  [ModelType.TRANSCRIPTION]: 'Transcription',
  [ModelType.MESSAGE_COMPACTION]: 'Message Compaction',
};

export const MODEL_TYPE_DESCRIPTIONS: Record<ModelType, string> = {
  [ModelType.MAIN]: 'Primary model for complex reasoning, coding, and analysis tasks',
  [ModelType.SMALL]: 'Faster, lightweight model for simple tasks and quick responses',
  [ModelType.IMAGE_GENERATOR]: 'Model for generating images from text descriptions',
  [ModelType.TRANSCRIPTION]: 'Model for converting speech/audio to text',
  [ModelType.MESSAGE_COMPACTION]: 'Model for compressing conversation history',
};

export const DEFAULT_MODELS_BY_TYPE: Record<ModelType, string> = {
  [ModelType.MAIN]: GPT51_CODE_MAX,
  [ModelType.SMALL]: GEMINI_25_FLASH_LITE,
  [ModelType.IMAGE_GENERATOR]: NANO_BANANA_PRO,
  [ModelType.TRANSCRIPTION]: SCRIBE_V2_REALTIME,
  [ModelType.MESSAGE_COMPACTION]: GEMINI_25_FLASH_LITE,
};

export interface ModelTypeConfig {
  [ModelType.MAIN]?: string;
  [ModelType.SMALL]?: string;
  [ModelType.IMAGE_GENERATOR]?: string;
  [ModelType.TRANSCRIPTION]?: string;
  [ModelType.MESSAGE_COMPACTION]?: string;
}

export const MODEL_TYPE_SETTINGS_KEYS = {
  [ModelType.MAIN]: 'model_type_main',
  [ModelType.SMALL]: 'model_type_small',
  [ModelType.IMAGE_GENERATOR]: 'model_type_image_generator',
  [ModelType.TRANSCRIPTION]: 'model_type_transcription',
  [ModelType.MESSAGE_COMPACTION]: 'model_type_message_compaction',
} as const;

export function isValidModelType(value: string): value is ModelType {
  return Object.values(ModelType).includes(value as ModelType);
}

/**
 * Helper function to get ModelType from string with fallback
 */
export function getModelType(value: string | undefined): ModelType {
  if (value && isValidModelType(value)) {
    return value;
  }
  return ModelType.MAIN; // Default fallback
}
