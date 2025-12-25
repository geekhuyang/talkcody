// src/components/chat/model-selector-button.tsx

import { Bot, ExternalLink } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ModelListItem } from '@/components/selectors/model-list-item';
import { ModelSearchInput } from '@/components/selectors/model-search-input';
import { Button } from '@/components/ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useLocale } from '@/hooks/use-locale';
import { useModelSearch } from '@/hooks/use-model-search';
import { getDocLinks } from '@/lib/doc-links';
import { logger } from '@/lib/logger';
import { useProviderStore } from '@/providers/stores/provider-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { AvailableModel } from '@/types/api-keys';

export function ModelSelectorButton() {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Get available models from store
  const availableModels = useProviderStore((state) => state.availableModels);
  const isLoading = useProviderStore((state) => state.isLoading);
  const loadModels = useProviderStore((state) => state.initialize);

  // Get current model setting
  const modelTypeMain = useSettingsStore((state) => state.model_type_main);
  const setModelType = useSettingsStore((state) => state.setModelType);

  // Load models on mount if not already loaded
  useEffect(() => {
    loadModels();
  }, [loadModels]);

  // Parse current model key from stored value (format: "modelKey@provider" or just "modelKey")
  const currentModelKey = useMemo(() => {
    if (!modelTypeMain) return '';
    const parts = modelTypeMain.split('@');
    return parts[0] || '';
  }, [modelTypeMain]);

  // Use shared search hook
  const { filteredModels, hasSearchQuery } = useModelSearch({
    models: availableModels,
    searchQuery,
  });

  // Find current model info
  const currentModel = useMemo(() => {
    return availableModels.find((m) => m.key === currentModelKey);
  }, [availableModels, currentModelKey]);

  // Handle model selection
  const handleSelectModel = async (model: AvailableModel) => {
    try {
      // Store as "modelKey@provider" format
      const modelIdentifier = `${model.key}@${model.provider}`;
      await setModelType('main', modelIdentifier);

      toast.success(t.Chat.model.switchSuccess);
      setOpen(false);
    } catch (error) {
      logger.error('Failed to switch model:', error);
      toast.error(t.Chat.model.switchFailed);
    }
  };

  // Check if model is selected (matches both key and provider)
  const isModelSelected = (model: AvailableModel) => {
    return model.key === currentModelKey && model.provider === modelTypeMain.split('@')[1];
  };

  return (
    <HoverCard>
      <Popover
        open={open}
        onOpenChange={(newOpen) => {
          if (!newOpen) {
            // Reset search when closing
            setSearchQuery('');
          }
          setOpen(newOpen);
        }}
      >
        <HoverCardTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 relative"
              disabled={isLoading}
              onClick={() => {
                if (!open) {
                  setSearchQuery('');
                }
              }}
            >
              <Bot className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
        </HoverCardTrigger>
        <HoverCardContent side="top" className="w-72">
          <div className="space-y-2">
            <h4 className="font-medium text-sm">{t.Chat.modelSelector.title}</h4>
            <p className="text-xs text-muted-foreground">{t.Chat.modelSelector.description}</p>
            {currentModel && (
              <p className="text-xs">
                <span className="text-muted-foreground">{t.Chat.modelSelector.currentModel}: </span>
                <span className="font-medium">{currentModel.name}</span>
              </p>
            )}
            <a
              href={getDocLinks().features.models}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              {t.Common.learnMore}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </HoverCardContent>

        <PopoverContent className="w-80 p-0" align="end">
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <div className="font-semibold text-sm">{t.Chat.modelSelector.title}</div>
            {currentModel && (
              <span className="text-xs text-muted-foreground truncate max-w-[150px]">
                {currentModel.name}
              </span>
            )}
          </div>

          <ModelSearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            resultCount={filteredModels.length}
          />

          <ScrollArea className="h-[400px]">
            {isLoading ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                {t.Common.loading}
              </div>
            ) : filteredModels.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                {hasSearchQuery
                  ? t.Settings.customModelsDialog.noModelsMatch(searchQuery)
                  : t.Chat.modelSelector.noModels}
              </div>
            ) : (
              <div className="p-2 space-y-1" key={`models-${searchQuery}`}>
                {filteredModels.map((model) => (
                  <ModelListItem
                    key={`${model.key}-${model.provider}`}
                    model={model}
                    isSelected={isModelSelected(model)}
                    onSelect={handleSelectModel}
                  />
                ))}
              </div>
            )}
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </HoverCard>
  );
}
