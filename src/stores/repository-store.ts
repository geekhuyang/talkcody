import { join } from '@tauri-apps/api/path';
import { exists, stat } from '@tauri-apps/plugin-fs';
import { toast } from 'sonner';
import { create } from 'zustand';
import { logger } from '@/lib/logger';
import { databaseService } from '@/services/database-service';
import { fastDirectoryTreeService } from '@/services/fast-directory-tree-service';
import { projectIndexer } from '@/services/project-indexer';
import { repositoryService } from '@/services/repository-service';
import { useGitStore } from '@/stores/git-store';
import { settingsManager } from '@/stores/settings-store';
import type {
  FileNode,
  IndexingProgress,
  LoadingPhase,
  OpenFile,
  RepositoryState,
} from '@/types/file-system';

// Helper function to collect paths for initial expansion
// Only expand root directory (level 0), all subdirectories are collapsed by default (VS Code behavior)
const collectInitialExpandedPaths = (
  node: FileNode,
  _level = 0,
  paths: Set<string> = new Set()
): Set<string> => {
  if (node.is_directory) {
    paths.add(node.path);
  }
  return paths;
};

interface RepositoryStore extends RepositoryState {
  // Actions
  openRepository: (path: string, projectId: string) => Promise<void>;
  selectRepository: () => Promise<{ id: string; name: string } | null>;
  setLoadingPhase: (phase: LoadingPhase) => void;
  setIndexingProgress: (progress: IndexingProgress | null) => void;
  selectFile: (filePath: string, lineNumber?: number) => Promise<void>;
  switchToTab: (index: number) => Promise<void>;
  closeTab: (index: number) => void;
  closeOthers: (keepIndex: number) => void;
  closeAllFiles: () => void;
  updateFileContent: (filePath: string, content: string, hasUnsavedChanges?: boolean) => void;
  saveFile: (filePath: string, content: string) => Promise<void>;
  searchFiles: (query: string) => Promise<FileNode[]>;
  createFile: (parentPath: string, fileName: string, isDirectory: boolean) => Promise<void>;
  renameFile: (oldPath: string, newName: string) => Promise<void>;
  closeRepository: () => void;
  refreshFile: (filePath: string) => Promise<void>;
  refreshFileTree: () => Promise<void>;
  loadDirectoryChildren: (node: FileNode) => Promise<FileNode[]>;
  updateNodeInTree: (tree: FileNode, targetPath: string, updatedNode: FileNode) => FileNode;
  findNodeByPath: (tree: FileNode, targetPath: string) => FileNode | null;
  expandToFile: (filePath: string) => Promise<void>;
  toggleExpansion: (path: string) => void;

  // Indexing state management
  indexedFiles: Set<string>;
  addIndexedFile: (path: string) => void;
  addIndexedFiles: (paths: string[]) => void;
  setIndexedFiles: (files: Set<string>) => void;
  removeIndexedFile: (path: string) => void;
  clearIndexedFiles: () => void;
  isFileIndexed: (path: string) => boolean;

  // Utility methods
  getFileLanguage: (filename: string) => string;
  getCacheSize: () => number;

  // External file change handling
  pendingExternalChange: {
    filePath: string;
    diskContent: string;
  } | null;
  handleExternalFileChange: (filePath: string) => Promise<void>;
  applyExternalChange: (keepLocal: boolean) => void;
}

export const useRepositoryStore = create<RepositoryStore>((set, get) => ({
  // Initial state
  rootPath: null,
  fileTree: null,
  openFiles: [],
  activeFileIndex: -1,
  isLoading: false,
  error: null,
  expandedPaths: new Set<string>(),
  selectedFilePath: null,
  loadingPhase: 'idle',
  indexingProgress: null,
  indexedFiles: new Set<string>(),
  pendingExternalChange: null,

  // Loading phase setter
  setLoadingPhase: (phase: LoadingPhase) => set({ loadingPhase: phase }),

  // Indexing progress setter
  setIndexingProgress: (progress: IndexingProgress | null) => set({ indexingProgress: progress }),

  // Helper function to update a node in the file tree
  updateNodeInTree: (tree: FileNode, targetPath: string, updatedNode: FileNode): FileNode => {
    if (tree.path === targetPath) {
      return updatedNode;
    }

    if (tree.children) {
      return {
        ...tree,
        children: tree.children.map((child) =>
          get().updateNodeInTree(child, targetPath, updatedNode)
        ),
      };
    }

    return tree;
  },

  // Helper function to find a node by path in the file tree
  findNodeByPath: (tree: FileNode, targetPath: string): FileNode | null => {
    if (tree.path === targetPath) {
      return tree;
    }

    if (tree.children) {
      for (const child of tree.children) {
        const found = get().findNodeByPath(child, targetPath);
        if (found) {
          return found;
        }
      }
    }

    return null;
  },

  // Load children for a lazy-loaded directory node
  loadDirectoryChildren: async (node: FileNode): Promise<FileNode[]> => {
    if (!(node.is_directory && node.is_lazy_loaded)) {
      return node.children || [];
    }

    try {
      set({ isLoading: true });

      const children = await fastDirectoryTreeService.loadDirectoryChildren(node.path);

      // Update the file tree with loaded children
      set((state) => ({
        fileTree: state.fileTree
          ? get().updateNodeInTree(state.fileTree, node.path, {
              ...node,
              children,
              is_lazy_loaded: false,
            })
          : null,
        isLoading: false,
      }));

      return children;
    } catch (error) {
      logger.error('Failed to load directory children:', error);
      set({ isLoading: false });
      toast.error('Failed to load directory contents');
      return node.children || [];
    }
  },

  // Open a repository
  openRepository: async (path: string, projectId: string) => {
    // Skip if already opened the same path
    const currentState = get();
    if (currentState.rootPath === path) {
      return;
    }
    // Note: We don't check isLoading here because selectRepository sets it before calling us

    // 0. VALIDATE PATH EXISTS BEFORE any state changes
    // This prevents infinite retry loops when the directory has been renamed/deleted
    try {
      const pathExists = await exists(path);
      if (!pathExists) {
        // Clear stale settings for this invalid path to prevent retry loop
        if (settingsManager.getCurrentRootPath() === path) {
          settingsManager.setCurrentRootPath('');
        }
        toast.error(`Directory does not exist: ${path}`);
        logger.error('Attempted to open non-existent directory:', path);
        return;
      }

      // Also verify it's a directory, not a file
      const pathStat = await stat(path);
      if (!pathStat.isDirectory) {
        if (settingsManager.getCurrentRootPath() === path) {
          settingsManager.setCurrentRootPath('');
        }
        toast.error(`Path is not a directory: ${path}`);
        logger.error('Attempted to open a file as repository:', path);
        return;
      }
    } catch (error) {
      logger.error('Failed to validate path:', error);
      // Clear settings to prevent retry loop
      if (settingsManager.getCurrentRootPath() === path) {
        settingsManager.setCurrentRootPath('');
      }
      toast.error('Failed to validate directory path');
      return;
    }

    // 1. IMMEDIATELY update UI with new path to show responsiveness
    // Set rootPath first so project selector updates right away
    // Also clear indexedFiles to prevent cross-project pollution
    set({
      isLoading: true,
      error: null,
      loadingPhase: 'building-tree',
      rootPath: path, // Set this immediately!
      fileTree: null, // Clear old tree
      openFiles: [],
      activeFileIndex: -1,
      indexedFiles: new Set<string>(), // Clear indexed files for new project
    });

    // Set settings synchronously
    settingsManager.setCurrentRootPath(path);

    // Set the project if provided (don't await, fire and forget for speed)
    if (projectId) {
      settingsManager.setCurrentProjectId(projectId).catch((error) => {
        logger.error('Failed to set current project ID:', error);
      });
    }

    // 2. Build directory tree in the background
    // Use requestAnimationFrame + setTimeout to ensure UI has time to repaint
    requestAnimationFrame(() => {
      setTimeout(async () => {
        try {
          const fileTree = await repositoryService.buildDirectoryTree(path);

          // Collect paths for initial expansion (level 0 and 1)
          const initialExpandedPaths = collectInitialExpandedPaths(fileTree);

          set({
            fileTree,
            isLoading: false,
            expandedPaths: initialExpandedPaths,
            loadingPhase: 'indexing',
          });

          // 3. Set up progress callback for indexing
          projectIndexer.setProgressCallback((progress) => {
            set({ indexingProgress: progress });
          });

          // 4. Clear previous project index and index new project (background task)
          // This prevents cross-project pollution
          projectIndexer
            .clearAll()
            .then(() => projectIndexer.indexProjectByPath(path))
            .then(() => {
              set({ loadingPhase: 'complete', indexingProgress: null });
            })
            .catch((error) => {
              logger.error('Failed to index project:', error);
              set({ loadingPhase: 'complete', indexingProgress: null });
            });

          // Check if it's a Git repository
          try {
            const gitDir = await join(path, '.git');
            const isGitRepo = await exists(gitDir);

            if (!isGitRepo) {
              toast.warning(
                'Consider using Git to manage this project for tracking and recovering file changes',
                {
                  duration: 5000,
                }
              );
            }
          } catch (gitCheckError) {
            logger.debug('Failed to check if repository is Git:', gitCheckError);
          }

          toast.success('Repository opened successfully');
        } catch (error) {
          const errorMessage = (error as Error).message;

          // Clear invalid path from settings to prevent retry loop
          settingsManager.setCurrentRootPath('');

          set({
            error: errorMessage,
            isLoading: false,
            loadingPhase: 'idle',
            rootPath: null,
            fileTree: null,
          });

          toast.error(`Failed to open repository: ${errorMessage}`);
        }
      }, 0);
    });
  },

  // Select a repository folder
  selectRepository: async () => {
    set({ isLoading: true, error: null, loadingPhase: 'selecting' });

    try {
      const path = await repositoryService.selectRepositoryFolder();

      if (!path) {
        set({ isLoading: false, loadingPhase: 'idle' });
        return null;
      }

      set({ loadingPhase: 'creating-project' });
      const project = await databaseService.createOrGetProjectForRepository(path);

      // Don't await openRepository - let it run in background
      // This returns immediately so UI can update
      get().openRepository(path, project.id);

      return project;
    } catch (_error) {
      // Error handling is done in openRepository
      set({ loadingPhase: 'idle' });
      return null;
    }
  },

  // Select a file to open
  selectFile: async (filePath: string, lineNumber?: number) => {
    const { openFiles, expandToFile } = get();

    // Expand file tree to show the selected file
    await expandToFile(filePath);

    // Check if file is already open
    const existingIndex = openFiles.findIndex((file) => file.path === filePath);
    if (existingIndex !== -1) {
      // File is already open, just switch to it and update line number
      set({
        activeFileIndex: existingIndex,
        openFiles: openFiles.map((file, index) =>
          index === existingIndex ? { ...file, lineNumber } : file
        ),
      });

      // Pre-fetch Git line changes for instant gutter display
      useGitStore
        .getState()
        .getLineChanges(filePath)
        .catch((error) => {
          logger.debug('Pre-fetch git line changes failed:', error);
        });

      return;
    }

    // File is not open, add it to open files
    const newFile: OpenFile = {
      path: filePath,
      content: null,
      isLoading: true,
      error: null,
      lineNumber,
    };

    set((state) => ({
      openFiles: [...state.openFiles, newFile],
      activeFileIndex: state.openFiles.length,
      isLoading: true,
      error: null,
    }));

    try {
      // Pre-fetch Git line changes in parallel with file content
      const [content] = await Promise.all([
        repositoryService.readFileWithCache(filePath),
        useGitStore
          .getState()
          .getLineChanges(filePath)
          .catch((error) => {
            logger.debug('Pre-fetch git line changes failed:', error);
            return [];
          }),
      ]);

      set((state) => ({
        openFiles: state.openFiles.map((file, index) =>
          index === state.openFiles.length - 1 ? { ...file, content, isLoading: false } : file
        ),
        isLoading: false,
      }));
    } catch (error) {
      const errorMessage = (error as Error).message;
      set((state) => ({
        openFiles: state.openFiles.map((file, index) =>
          index === state.openFiles.length - 1
            ? { ...file, error: errorMessage, isLoading: false }
            : file
        ),
        isLoading: false,
      }));

      toast.error(`Failed to read file: ${errorMessage}`);
    }
  },

  // Switch to a tab
  switchToTab: async (index: number) => {
    const { openFiles } = get();
    if (index >= 0 && index < openFiles.length) {
      set({ activeFileIndex: index });

      // Pre-fetch Git line changes for the switched tab
      const file = openFiles[index];
      if (file) {
        useGitStore
          .getState()
          .getLineChanges(file.path)
          .catch((error) => {
            logger.debug('Pre-fetch git line changes failed:', error);
          });
      }
    }
  },

  // Close a tab
  closeTab: (index: number) => {
    set((state) => {
      const newOpenFiles = state.openFiles.filter((_, i) => i !== index);
      let newActiveIndex = state.activeFileIndex;

      if (newOpenFiles.length === 0) {
        newActiveIndex = -1;
      } else if (index <= state.activeFileIndex) {
        newActiveIndex = Math.max(0, state.activeFileIndex - 1);
      }

      return {
        openFiles: newOpenFiles,
        activeFileIndex: newActiveIndex,
      };
    });
  },

  // Close all tabs except the specified one
  closeOthers: (keepIndex: number) => {
    set((state) => {
      if (keepIndex < 0 || keepIndex >= state.openFiles.length) {
        return state;
      }

      const fileToKeep = state.openFiles[keepIndex];
      if (!fileToKeep) {
        return state;
      }

      return {
        openFiles: [fileToKeep],
        activeFileIndex: 0,
      };
    });
  },

  // Close all files
  closeAllFiles: () => {
    set({
      openFiles: [],
      activeFileIndex: -1,
    });
  },

  // Update file content
  updateFileContent: (filePath: string, content: string, hasUnsavedChanges = false) => {
    set((state) => ({
      openFiles: state.openFiles.map((file) =>
        file.path === filePath ? { ...file, content, hasUnsavedChanges } : file
      ),
    }));
  },

  // Save a file
  saveFile: async (filePath: string, content: string) => {
    try {
      await repositoryService.writeFile(filePath, content);

      set((state) => ({
        openFiles: state.openFiles.map((file) =>
          file.path === filePath ? { ...file, content, hasUnsavedChanges: false } : file
        ),
      }));

      // Re-index the file for code navigation (background task)
      projectIndexer.reindexFile(filePath).catch((error) => {
        logger.debug('Failed to reindex file:', error);
      });

      toast.success(`File saved: ${repositoryService.getFileNameFromPath(filePath)}`);
    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error('Failed to save file:', error);
      toast.error(`Failed to save file: ${errorMessage}`);
      throw error;
    }
  },

  // Search files
  searchFiles: async (query: string): Promise<FileNode[]> => {
    const { rootPath } = get();
    if (!(rootPath && query.trim())) {
      return [];
    }

    try {
      return await repositoryService.searchFiles(rootPath, query);
    } catch (error) {
      logger.error('Search failed:', error);
      toast.error('Search failed');
      return [];
    }
  },

  // Create a file or directory
  createFile: async (parentPath: string, fileName: string, isDirectory: boolean) => {
    const { rootPath, refreshFileTree } = get();
    if (!rootPath) return;

    try {
      await repositoryService.createFile(parentPath, fileName, isDirectory);
      // Refresh file tree to show the new item
      await refreshFileTree();
    } catch (error) {
      logger.error('Failed to create file/directory:', error);
      throw error;
    }
  },

  // Rename a file or directory
  renameFile: async (oldPath: string, newName: string) => {
    const { rootPath, refreshFileTree } = get();
    if (!rootPath) return;

    try {
      await repositoryService.renameFile(oldPath, newName);
      // If the renamed file is open, update its path
      set((state) => ({
        openFiles: state.openFiles.map((file) =>
          file.path === oldPath ? { ...file, path: oldPath.replace(/[^/]+$/, newName) } : file
        ),
      }));
      await refreshFileTree();
    } catch (error) {
      logger.error('Failed to rename file/directory:', error);
      throw error;
    }
  },

  // Close the repository
  closeRepository: () => {
    // Clear cache when closing repository
    repositoryService.clearCache();

    // Clear the current root path in settings
    settingsManager.setCurrentRootPath('');

    set({
      rootPath: null,
      fileTree: null,
      openFiles: [],
      activeFileIndex: -1,
      isLoading: false,
      error: null,
      expandedPaths: new Set<string>(),
      selectedFilePath: null,
      loadingPhase: 'idle',
      indexingProgress: null,
      indexedFiles: new Set<string>(),
    });
  },

  // Refresh a file
  refreshFile: async (filePath: string) => {
    if (!filePath) return;

    set((state) => ({
      openFiles: state.openFiles.map((file) =>
        file.path === filePath ? { ...file, isLoading: true, error: null } : file
      ),
    }));

    try {
      // First clear cache to force fresh read from disk
      repositoryService.invalidateCache(filePath);

      // Then read the file content from disk
      const content = await repositoryService.readFileWithCache(filePath);

      set((state) => ({
        openFiles: state.openFiles.map((file) =>
          file.path === filePath ? { ...file, content, isLoading: false, error: null } : file
        ),
      }));

      toast.success('File refreshed successfully');
    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error('Failed to refresh file:', error);

      set((state) => ({
        openFiles: state.openFiles.map((file) =>
          file.path === filePath ? { ...file, error: errorMessage, isLoading: false } : file
        ),
      }));

      toast.error(`Failed to refresh file: ${errorMessage}`);
    }
  },

  // Refresh the file tree
  refreshFileTree: async () => {
    const { rootPath } = get();
    if (!rootPath) return;

    set({ isLoading: true, error: null });

    try {
      // Clear all caches first - both file content cache and directory tree cache
      repositoryService.clearCache();
      await fastDirectoryTreeService.clearCache();

      // Then rebuild the directory tree with high-performance implementation
      const tree = await repositoryService.buildDirectoryTree(rootPath);

      set({
        fileTree: tree,
        isLoading: false,
      });
    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error('Failed to refresh file tree:', error);

      set({
        error: errorMessage,
        isLoading: false,
      });

      toast.error(`Failed to refresh file tree: ${errorMessage}`);
    }
  },

  // Expand all parent directories of a file
  expandToFile: async (filePath: string) => {
    const {
      rootPath,
      expandedPaths: currentExpandedPaths,
      fileTree,
      findNodeByPath,
      loadDirectoryChildren,
    } = get();
    if (!rootPath || !fileTree) return;

    const expandedPaths = new Set(currentExpandedPaths);

    // Get relative path from root
    const relativePath = filePath.startsWith(rootPath)
      ? filePath.substring(rootPath.length + 1)
      : filePath;

    // Build all parent paths that need to be expanded
    const parts = relativePath.split('/');
    let currentPath = rootPath;
    const pathsToExpand: string[] = [];

    for (let i = 0; i < parts.length - 1; i++) {
      currentPath = `${currentPath}/${parts[i]}`;
      expandedPaths.add(currentPath);
      pathsToExpand.push(currentPath);
    }

    // Update expansion state immediately for visual feedback
    set({
      expandedPaths,
      selectedFilePath: filePath,
    });

    // Load children for each lazy-loaded directory in the path
    for (const path of pathsToExpand) {
      const currentTree = get().fileTree;
      if (!currentTree) continue;
      const node = findNodeByPath(currentTree, path);
      if (node?.is_directory && node.is_lazy_loaded) {
        await loadDirectoryChildren(node);
      }
    }
  },

  // Toggle expansion state of a directory
  toggleExpansion: (path: string) => {
    set((state) => {
      const newExpandedPaths = new Set(state.expandedPaths);

      if (newExpandedPaths.has(path)) {
        newExpandedPaths.delete(path);
      } else {
        newExpandedPaths.add(path);
      }

      return { expandedPaths: newExpandedPaths };
    });
  },

  // Indexing state management
  addIndexedFile: (path: string) => {
    set((state) => {
      const newIndexedFiles = new Set(state.indexedFiles);
      newIndexedFiles.add(path);
      return { indexedFiles: newIndexedFiles };
    });
  },

  addIndexedFiles: (paths: string[]) => {
    set((state) => {
      const newIndexedFiles = new Set(state.indexedFiles);
      for (const path of paths) {
        newIndexedFiles.add(path);
      }
      return { indexedFiles: newIndexedFiles };
    });
  },

  setIndexedFiles: (files: Set<string>) => {
    set({ indexedFiles: files });
  },

  removeIndexedFile: (path: string) => {
    set((state) => {
      const newIndexedFiles = new Set(state.indexedFiles);
      newIndexedFiles.delete(path);
      return { indexedFiles: newIndexedFiles };
    });
  },

  clearIndexedFiles: () => {
    set({ indexedFiles: new Set<string>() });
  },

  isFileIndexed: (path: string) => {
    return get().indexedFiles.has(path);
  },

  // Utility methods
  getFileLanguage: (filename: string) => repositoryService.getLanguageFromExtension(filename),

  getCacheSize: () => repositoryService.getCacheSize(),

  // Handle external file change
  handleExternalFileChange: async (filePath: string) => {
    const { openFiles } = get();
    const openFile = openFiles.find((file) => file.path === filePath);

    if (!openFile) return;

    try {
      // Read latest content from disk
      repositoryService.invalidateCache(filePath);
      const diskContent = await repositoryService.readFileWithCache(filePath);

      // If content is the same, no need to update
      if (openFile.content === diskContent) {
        return;
      }

      // If file has unsaved changes, show dialog
      if (openFile.hasUnsavedChanges) {
        set({
          pendingExternalChange: { filePath, diskContent },
        });
      } else {
        // No unsaved changes, silently update
        set((state) => ({
          openFiles: state.openFiles.map((file) =>
            file.path === filePath ? { ...file, content: diskContent } : file
          ),
        }));
      }
    } catch (error) {
      logger.error('Failed to handle external file change:', error);
    }
  },

  // Apply external change based on user choice
  applyExternalChange: (keepLocal: boolean) => {
    const { pendingExternalChange } = get();
    if (!pendingExternalChange) return;

    const { filePath, diskContent } = pendingExternalChange;

    if (!keepLocal) {
      // User chose to load disk version
      set((state) => ({
        openFiles: state.openFiles.map((file) =>
          file.path === filePath
            ? { ...file, content: diskContent, hasUnsavedChanges: false }
            : file
        ),
        pendingExternalChange: null,
      }));
    } else {
      // User chose to keep local changes, just clear dialog state
      set({ pendingExternalChange: null });
    }
  },
}));
