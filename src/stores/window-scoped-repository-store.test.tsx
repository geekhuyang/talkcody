import { renderHook, waitFor } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { RepositoryStoreProvider, useRepositoryStore } from './window-scoped-repository-store';
import { settingsManager } from './settings-store';

// Mock all external dependencies
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('./settings-store', () => ({
  settingsManager: {
    setCurrentRootPath: vi.fn(),
    getCurrentRootPath: vi.fn().mockReturnValue(''),
    setCurrentProjectId: vi.fn().mockResolvedValue(undefined),
  },
  useSettingsStore: {
    getState: vi.fn().mockReturnValue({ language: 'en' }),
  },
}));

vi.mock('@/services/repository-service', () => ({
  repositoryService: {
    buildDirectoryTree: vi.fn().mockResolvedValue({
      path: '/test/path',
      name: 'test',
      is_directory: true,
      children: [],
    }),
    clearCache: vi.fn(),
    selectRepositoryFolder: vi.fn(),
  },
}));

vi.mock('@/services/fast-directory-tree-service', () => ({
  fastDirectoryTreeService: {
    clearCache: vi.fn().mockResolvedValue(undefined),
    loadDirectoryChildren: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/services/database-service', () => ({
  databaseService: {
    createOrGetProjectForRepository: vi.fn().mockResolvedValue({ id: 'proj-1', name: 'Test Project' }),
  },
}));

vi.mock('@/services/window-manager-service', () => ({
  WindowManagerService: {
    getCurrentWindowLabel: vi.fn().mockResolvedValue('main'),
    updateWindowProject: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/services/window-restore-service', () => ({
  WindowRestoreService: {
    saveCurrentWindowState: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('window-scoped-repository-store - selectRepository UI freeze bug', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <RepositoryStoreProvider>{children}</RepositoryStoreProvider>
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
  });

  it('should return immediately without blocking UI when selecting repository', async () => {
    const { repositoryService } = await import('@/services/repository-service');
    const { databaseService } = await import('@/services/database-service');

    vi.mocked(repositoryService.selectRepositoryFolder).mockResolvedValue('/test/new-project');
    vi.mocked(repositoryService.buildDirectoryTree).mockImplementation(
      () =>
        new Promise((resolve) => {
          // Simulate slow directory tree building (500ms)
          setTimeout(() => {
            resolve({
              path: '/test/new-project',
              name: 'new-project',
              is_directory: true,
              children: [],
            });
          }, 500);
        })
    );

    const { result } = renderHook(() => useRepositoryStore((state) => state), { wrapper });

    const startTime = Date.now();
    const selectRepositoryPromise = result.current.selectRepository();

    // selectRepository should return quickly (before tree building completes)
    const project = await selectRepositoryPromise;
    const endTime = Date.now();
    const duration = endTime - startTime;

    // Should return in less than 200ms (not wait for 500ms tree building)
    expect(duration).toBeLessThan(200);
    expect(project).toEqual({ id: 'proj-1', name: 'Test Project' });
    expect(databaseService.createOrGetProjectForRepository).toHaveBeenCalledWith('/test/new-project');
  });

  it('should run openRepository in background without blocking', async () => {
    const { repositoryService } = await import('@/services/repository-service');

    vi.mocked(repositoryService.selectRepositoryFolder).mockResolvedValue('/test/background-project');

    let treeBuilt = false;
    vi.mocked(repositoryService.buildDirectoryTree).mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            treeBuilt = true;
            resolve({
              path: '/test/background-project',
              name: 'background-project',
              is_directory: true,
              children: [],
            });
          }, 300);
        })
    );

    const { result } = renderHook(() => useRepositoryStore((state) => state), { wrapper });

    const project = await result.current.selectRepository();

    // selectRepository should return before tree building completes
    expect(project).toBeDefined();
    expect(treeBuilt).toBe(false);

    // Wait for background operation to complete
    await waitFor(
      () => {
        expect(treeBuilt).toBe(true);
      },
      { timeout: 500 }
    );

    // Verify tree is built and loaded in background
    await waitFor(
      () => {
        expect(result.current.fileTree).toBeDefined();
        expect(result.current.rootPath).toBe('/test/background-project');
      },
      { timeout: 200 }
    );
  });

  it('should handle errors in openRepository without affecting selectRepository return', async () => {
    const { repositoryService } = await import('@/services/repository-service');

    vi.mocked(repositoryService.selectRepositoryFolder).mockResolvedValue('/test/error-project');
    vi.mocked(repositoryService.buildDirectoryTree).mockRejectedValue(new Error('Tree build failed'));

    const { result } = renderHook(() => useRepositoryStore((state) => state), { wrapper });

    // selectRepository should still return project even if openRepository fails
    const project = await result.current.selectRepository();
    expect(project).toEqual({ id: 'proj-1', name: 'Test Project' });

    // Wait for error handling in background and check store state
    await waitFor(
      () => {
        expect(result.current.error).toBeTruthy();
        expect(result.current.isLoading).toBe(false);
      },
      { timeout: 300 }
    );
  });

  it('should allow calling openRepository with different path', async () => {
    const { repositoryService } = await import('@/services/repository-service');

    vi.mocked(repositoryService.selectRepositoryFolder).mockResolvedValue('/test/first-project');
    vi.mocked(repositoryService.buildDirectoryTree).mockResolvedValue({
      path: '/test/first-project',
      name: 'first-project',
      is_directory: true,
      children: [],
    });

    const { result } = renderHook(() => useRepositoryStore((state) => state), { wrapper });

    // Call selectRepository
    const project = await result.current.selectRepository();
    expect(project).toEqual({ id: 'proj-1', name: 'Test Project' });

    // Wait for openRepository to complete
    await waitFor(() => {
      expect(result.current.fileTree).toBeDefined();
      expect(repositoryService.buildDirectoryTree).toHaveBeenCalled();
    });
  });

  it('should update settings and return project correctly', async () => {
    const { repositoryService } = await import('@/services/repository-service');
    const { databaseService } = await import('@/services/database-service');

    vi.mocked(repositoryService.selectRepositoryFolder).mockResolvedValue('/test/settings-project');
    vi.mocked(repositoryService.buildDirectoryTree).mockResolvedValue({
      path: '/test/settings-project',
      name: 'settings-project',
      is_directory: true,
      children: [],
    });
    vi.mocked(databaseService.createOrGetProjectForRepository).mockResolvedValue({
      id: 'proj-settings',
      name: 'Settings Project',
    });

    const { result } = renderHook(() => useRepositoryStore((state) => state), { wrapper });

    const project = await result.current.selectRepository();

    expect(project).toEqual({ id: 'proj-settings', name: 'Settings Project' });
    expect(databaseService.createOrGetProjectForRepository).toHaveBeenCalledWith('/test/settings-project');

    // Settings should be updated in background when openRepository runs
    await waitFor(
      () => {
        expect(settingsManager.setCurrentRootPath).toHaveBeenCalledWith('/test/settings-project');
        expect(result.current.fileTree).toBeDefined();
      },
      { timeout: 300 }
    );
  });

  it('should return null when user cancels repository selection', async () => {
    const { repositoryService } = await import('@/services/repository-service');

    vi.mocked(repositoryService.selectRepositoryFolder).mockResolvedValue(null);

    const { result } = renderHook(() => useRepositoryStore((state) => state), { wrapper });

    const project = await result.current.selectRepository();

    expect(project).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(repositoryService.buildDirectoryTree).not.toHaveBeenCalled();
  });

  it('should skip opening same path that is already open', async () => {
    const { repositoryService } = await import('@/services/repository-service');

    const { result } = renderHook(() => useRepositoryStore((state) => state), { wrapper });

    // First, open a repository
    vi.mocked(repositoryService.selectRepositoryFolder).mockResolvedValue('/test/same-project');
    await result.current.selectRepository();

    // Wait for openRepository to complete
    await waitFor(() => {
      expect(result.current.rootPath).toBe('/test/same-project');
    });

    vi.clearAllMocks();

    // Try to open the same path again
    await result.current.openRepository('/test/same-project', 'proj-1');

    // buildDirectoryTree should not be called again
    expect(repositoryService.buildDirectoryTree).not.toHaveBeenCalled();
  });
});
