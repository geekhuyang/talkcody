import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { AddCustomModelDialog } from './add-custom-model-dialog';
import { customModelService } from '@/services/custom-model-service';

vi.mock('@/hooks/use-locale', () => ({
  useTranslation: () => ({
    Settings: {
      customModelsDialog: {
        title: 'Add Custom Models',
        description: '',
        provider: 'Provider',
        selectProvider: 'Select provider',
        fetchModels: 'Fetch',
        availableModels: (count: number) => `Available (${count})`,
        selectAll: 'Select All',
        clear: 'Clear',
        modelsSelected: (count: number) => `${count} selected`,
        manualModelName: 'Manual',
        manualModelPlaceholder: 'Enter model name',
        noListingSupport: '',
        enterManually: '',
        hideManualInput: '',
        addModelManually: '',
        noModelsFound: 'No models found',
        searchPlaceholder: 'Search models...',
        clearSearchAria: 'Clear search',
        noModelsMatch: (q: string) => `No match ${q}`,
        fetchFailed: (e: string) => `fail ${e}`,
        selectAtLeastOne: 'Select at least one',
        addedModels: (c: number) => `added ${c}`,
        addFailed: 'add failed',
        addModels: 'Add',
      },
    },
    Common: { cancel: 'Cancel' },
  }),
}));

vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({ checked, onCheckedChange }: { checked?: boolean; onCheckedChange?: (v: boolean) => void }) => (
    <input
      type="checkbox"
      role="checkbox"
      aria-checked={checked}
      checked={checked}
      onChange={() => onCheckedChange?.(!checked)}
    />
  ),
}));

vi.mock('@/services/custom-model-service', () => ({
  customModelService: {
    getAvailableProvidersForFetch: vi.fn(() => [{ id: 'p1', name: 'Provider1' }]),
    fetchProviderModels: vi.fn(),
    supportsModelsFetch: vi.fn(() => true),
    addCustomModels: vi.fn(),
  },
}));

describe('AddCustomModelDialog selectAll respects filter', () => {
  const setup = async () => {
    vi.mocked(customModelService.fetchProviderModels).mockResolvedValue([
      { id: 'alpha' },
      { id: 'beta' },
      { id: 'gamma' },
    ]);
    const onOpenChange = vi.fn();
    render(<AddCustomModelDialog open onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByText('Select provider'));
    fireEvent.click(screen.getByText('Provider1'));
    fireEvent.click(screen.getByText('Fetch'));
    await screen.findByText('Available (3)');
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('only selects filtered models', async () => {
    await setup();
    fireEvent.change(screen.getByPlaceholderText('Search models...'), { target: { value: 'bet' } });
    fireEvent.click(screen.getByText('Select All'));

    const checkboxes = await screen.findAllByRole('checkbox');
    expect(checkboxes).toHaveLength(1);
    expect(checkboxes[0]).toBeChecked();
    await waitFor(() => {
      expect(screen.getByText('1 selected')).toBeInTheDocument();
    });
  });
});
