// src/stores/task-store.ts
/**
 * TaskStore - Centralized task and message state management
 *
 * This store manages:
 * - Task list and current task selection
 * - Messages for all tasks (cached by taskId)
 * - Task usage tracking (cost, tokens)
 *
 * Design principles:
 * - Single source of truth for task and message data
 * - Synchronous state updates for immediate UI response
 * - Asynchronous persistence to database (fire-and-forget or awaited)
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { logger } from '@/lib/logger';
import { generateId } from '@/lib/utils';
import type { Task, TaskSettings } from '@/types';
import type { ToolMessageContent, UIMessage } from '@/types/agent';

// Stable empty array reference to avoid unnecessary re-renders
const EMPTY_MESSAGES: UIMessage[] = [];

// Maximum number of tasks to keep messages cached in memory
const MAX_CACHED_TASK_MESSAGES = 20;

interface TaskState {
  // Task list
  tasks: Map<string, Task>;
  currentTaskId: string | null;

  // Messages (by taskId)
  messages: Map<string, UIMessage[]>;

  // LRU cache tracking (most recent first)
  messageAccessOrder: string[];

  // Loading states
  loadingTasks: boolean;
  loadingMessages: Set<string>;

  // Error state
  error: string | null;

  // ============================================
  // Task Actions
  // ============================================

  /**
   * Set tasks from database load
   */
  setTasks: (tasks: Task[]) => void;

  /**
   * Add a new task to the store
   */
  addTask: (task: Task) => void;

  /**
   * Update a task
   */
  updateTask: (taskId: string, updates: Partial<Task>) => void;

  /**
   * Remove a task from the store
   */
  removeTask: (taskId: string) => void;

  /**
   * Set the current task ID
   */
  setCurrentTaskId: (taskId: string | null) => void;

  /**
   * Update task usage (cost, tokens)
   */
  updateTaskUsage: (
    taskId: string,
    cost: number,
    inputTokens: number,
    outputTokens: number
  ) => void;

  /**
   * Set context usage percentage for a task
   */
  setContextUsage: (taskId: string, contextUsage: number) => void;

  /**
   * Update task settings
   */
  updateTaskSettings: (taskId: string, settings: TaskSettings) => void;

  // ============================================
  // Message Actions
  // ============================================

  /**
   * Set messages for a task (from database load)
   */
  setMessages: (taskId: string, messages: UIMessage[]) => void;

  /**
   * Add a message to a task
   * Returns the message ID
   */
  addMessage: (taskId: string, message: UIMessage) => string;

  /**
   * Update a message
   */
  updateMessage: (taskId: string, messageId: string, updates: Partial<UIMessage>) => void;

  /**
   * Update message content (convenience method for streaming)
   */
  updateMessageContent: (
    taskId: string,
    messageId: string,
    content: string,
    isStreaming?: boolean
  ) => void;

  /**
   * Delete a message
   */
  deleteMessage: (taskId: string, messageId: string) => void;

  /**
   * Delete messages from a specific index onwards
   */
  deleteMessagesFromIndex: (taskId: string, index: number) => void;

  /**
   * Clear all messages for a task
   */
  clearMessages: (taskId: string) => void;

  /**
   * Stop streaming for all messages in a task
   */
  stopStreaming: (taskId: string) => void;

  /**
   * Add a nested tool message to a parent tool message
   */
  addNestedToolMessage: (
    taskId: string,
    parentToolCallId: string,
    nestedMessage: UIMessage
  ) => void;

  // ============================================
  // LRU Cache Actions
  // ============================================

  /**
   * Touch message cache - move taskId to front of access order
   * Call this when messages are accessed or modified
   */
  touchMessageCache: (taskId: string) => void;

  /**
   * Evict oldest cached messages to stay under limit
   * Skips: currentTaskId, running tasks
   */
  evictOldestMessages: (runningTaskIds: string[]) => void;

  // ============================================
  // Loading State Actions
  // ============================================

  setLoadingTasks: (loading: boolean) => void;
  setLoadingMessages: (taskId: string, loading: boolean) => void;
  setError: (error: string | null) => void;

  // ============================================
  // Selectors (pure functions)
  // ============================================

  /**
   * Get a task by ID
   */
  getTask: (taskId: string) => Task | undefined;

  /**
   * Get all tasks as array (sorted by updatedAt desc)
   */
  getTaskList: () => Task[];

  /**
   * Get messages for a task
   */
  getMessages: (taskId: string) => UIMessage[];

  /**
   * Find message index by ID
   */
  findMessageIndex: (taskId: string, messageId: string) => number;

  /**
   * Get the last user message for a task
   */
  getLastUserMessage: (taskId: string) => UIMessage | null;
}

export const useTaskStore = create<TaskState>()(
  devtools(
    (set, get) => ({
      tasks: new Map(),
      currentTaskId: null,
      messages: new Map(),
      messageAccessOrder: [],
      loadingTasks: false,
      loadingMessages: new Set(),
      error: null,

      // ============================================
      // Task Actions
      // ============================================

      setTasks: (tasks) => {
        set(
          (state) => {
            // Create a new Map to ensure state change is detected
            const newTasks = new Map();
            for (const task of tasks) {
              newTasks.set(task.id, task);
            }
            return { tasks: newTasks };
          },
          false,
          'setTasks'
        );
      },

      addTask: (task) => {
        set(
          (state) => {
            state.tasks.set(task.id, task);
            return { tasks: state.tasks };
          },
          false,
          'addTask'
        );
      },

      updateTask: (taskId, updates) => {
        set(
          (state) => {
            const task = state.tasks.get(taskId);
            if (!task) return state;

            // Directly modify the object
            Object.assign(task, updates);
            return { tasks: state.tasks };
          },
          false,
          'updateTask'
        );
      },

      removeTask: (taskId) => {
        set(
          (state) => {
            state.tasks.delete(taskId);
            state.messages.delete(taskId);

            // Clear current task if it was deleted
            const newCurrentTaskId = state.currentTaskId === taskId ? null : state.currentTaskId;

            return {
              tasks: state.tasks,
              messages: state.messages,
              currentTaskId: newCurrentTaskId,
            };
          },
          false,
          'removeTask'
        );
      },

      setCurrentTaskId: (taskId) => {
        set({ currentTaskId: taskId }, false, 'setCurrentTaskId');
      },

      updateTaskUsage: (taskId, cost, inputTokens, outputTokens) => {
        set(
          (state) => {
            const task = state.tasks.get(taskId);
            if (!task) return state;

            // Direct update
            task.cost += cost;
            task.input_token += inputTokens;
            task.output_token += outputTokens;
            return { tasks: state.tasks };
          },
          false,
          'updateTaskUsage'
        );
      },

      setContextUsage: (taskId, contextUsage) => {
        set(
          (state) => {
            const task = state.tasks.get(taskId);
            if (!task) return state;

            task.context_usage = contextUsage;
            return { tasks: state.tasks };
          },
          false,
          'setContextUsage'
        );
      },

      updateTaskSettings: (taskId, settings) => {
        set(
          (state) => {
            const task = state.tasks.get(taskId);
            if (!task) return state;

            const existingSettings: TaskSettings = task.settings ? JSON.parse(task.settings) : {};
            task.settings = JSON.stringify({ ...existingSettings, ...settings });
            return { tasks: state.tasks };
          },
          false,
          'updateTaskSettings'
        );
      },

      // ============================================
      // Message Actions
      // ============================================

      setMessages: (taskId, messages) => {
        set(
          (state) => {
            const existingMessages = state.messages.get(taskId) || [];

            const loadedIds = new Set(messages.map((m) => m.id));
            const pendingMessages = existingMessages.filter((m) => !loadedIds.has(m.id));

            const merged = [...messages, ...pendingMessages];
            merged.sort(
              (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );

            // Direct set
            state.messages.set(taskId, merged);
            return { messages: state.messages };
          },
          false,
          'setMessages'
        );
      },

      addMessage: (taskId, message) => {
        const messageId = message.id || generateId();
        const fullMessage = { ...message, id: messageId };

        set(
          (state) => {
            // Directly modify the existing Map, avoiding creating new objects
            const existing = state.messages.get(taskId) || [];
            state.messages.set(taskId, [...existing, fullMessage]);

            // Only update timestamp for user messages
            const task = state.tasks.get(taskId);
            if (task && message.role === 'user') {
              task.updated_at = Date.now();
              task.message_count = (task.message_count ?? 0) + 1;
            }

            return {
              messages: state.messages,
              tasks: state.tasks,
            };
          },
          false,
          'addMessage'
        );

        return messageId;
      },

      updateMessage: (taskId, messageId, updates) => {
        set(
          (state) => {
            const messages = state.messages.get(taskId);
            if (!messages) return state;

            // Directly update messages
            const taskMessages = state.messages.get(taskId);
            if (!taskMessages) return state;

            const updatedMessages = taskMessages.map((msg) =>
              msg.id === messageId ? ({ ...msg, ...updates } as UIMessage) : msg
            );
            state.messages.set(taskId, updatedMessages);
            return { messages: state.messages };
          },
          false,
          'updateMessage'
        );
      },

      updateMessageContent: (taskId, messageId, content, isStreaming = false) => {
        set(
          (state) => {
            const messages = state.messages.get(taskId);
            if (!messages) return state;

            // Use Immer to directly modify, avoiding creating new Map and arrays
            const taskMessages = state.messages.get(taskId);
            if (!taskMessages) return state;

            // Directly modify messages in Map (Zustand still detects changes)
            const updatedMessages = taskMessages.map((msg) =>
              msg.id === messageId ? { ...msg, content, isStreaming } : msg
            );
            state.messages.set(taskId, updatedMessages);
            return { messages: state.messages };
          },
          false,
          'updateMessageContent'
        );
      },

      deleteMessage: (taskId, messageId) => {
        set(
          (state) => {
            const messages = state.messages.get(taskId);
            if (!messages) return state;

            // Direct modification
            state.messages.set(
              taskId,
              messages.filter((msg) => msg.id !== messageId)
            );
            return { messages: state.messages };
          },
          false,
          'deleteMessage'
        );
      },

      deleteMessagesFromIndex: (taskId, index) => {
        set(
          (state) => {
            const messages = state.messages.get(taskId);
            if (!messages) return state;

            state.messages.set(taskId, messages.slice(0, index));
            return { messages: state.messages };
          },
          false,
          'deleteMessagesFromIndex'
        );
      },

      clearMessages: (taskId) => {
        set(
          (state) => {
            state.messages.set(taskId, []);
            return { messages: state.messages };
          },
          false,
          'clearMessages'
        );
      },

      stopStreaming: (taskId) => {
        set(
          (state) => {
            const messages = state.messages.get(taskId);
            if (!messages) return state;

            // 直接修改
            const updatedMessages = messages.map((msg) => {
              const updates: Partial<UIMessage> = {};

              if ('isStreaming' in msg && msg.isStreaming) {
                updates.isStreaming = false;
              }
              if ('renderDoingUI' in msg && msg.renderDoingUI) {
                updates.renderDoingUI = false;
              }

              return Object.keys(updates).length > 0 ? { ...msg, ...updates } : msg;
            });
            state.messages.set(taskId, updatedMessages);
            return { messages: state.messages };
          },
          false,
          'stopStreaming'
        );
      },

      addNestedToolMessage: (taskId, parentToolCallId, nestedMessage) => {
        logger.info('[TaskStore] addNestedToolMessage called:', {
          taskId,
          parentToolCallId,
          nestedMessageId: nestedMessage.id,
        });

        set(
          (state) => {
            const messages = state.messages.get(taskId);
            if (!messages) {
              logger.warn('[TaskStore] No messages found for task:', taskId);
              return state;
            }

            let foundParent = false;
            const updatedMessages = messages.map((msg) => {
              // Find parent tool message by toolCallId (stored in content for tool messages)
              const isToolMessage = msg.role === 'tool';
              const toolContent =
                isToolMessage && Array.isArray(msg.content) ? msg.content[0] : null;
              const msgToolCallId = (toolContent as ToolMessageContent | null)?.toolCallId;

              if (isToolMessage && msgToolCallId === parentToolCallId) {
                foundParent = true;
                const existingNested = msg.nestedTools || [];
                const existingIndex = existingNested.findIndex((t) => t.id === nestedMessage.id);

                let updatedNested: UIMessage[];
                if (existingIndex >= 0) {
                  updatedNested = [...existingNested];
                  updatedNested[existingIndex] = nestedMessage;
                } else {
                  updatedNested = [...existingNested, nestedMessage];
                }

                return { ...msg, nestedTools: updatedNested };
              }
              return msg;
            });

            if (!foundParent) {
              logger.warn('[TaskStore] Parent message NOT FOUND for toolCallId:', parentToolCallId);
            }

            state.messages.set(taskId, updatedMessages);
            return { messages: state.messages };
          },
          false,
          'addNestedToolMessage'
        );
      },

      // ============================================
      // LRU Cache Actions
      // ============================================

      touchMessageCache: (taskId) => {
        set(
          (state) => {
            const filtered = state.messageAccessOrder.filter((id) => id !== taskId);
            return { messageAccessOrder: [taskId, ...filtered] };
          },
          false,
          'touchMessageCache'
        );
      },

      evictOldestMessages: (runningTaskIds) => {
        set(
          (state) => {
            const protectedIds = new Set(
              [state.currentTaskId, ...runningTaskIds].filter(Boolean) as string[]
            );

            // Find evictable tasks (not protected, oldest first)
            const evictable = [...state.messageAccessOrder]
              .reverse()
              .filter((id) => !protectedIds.has(id) && state.messages.has(id));

            const excess = state.messages.size - MAX_CACHED_TASK_MESSAGES;
            const toEvict = evictable.slice(0, Math.max(0, excess));

            if (toEvict.length === 0) return state;

            const newOrder = state.messageAccessOrder.filter((id) => !toEvict.includes(id));

            for (const taskId of toEvict) {
              state.messages.delete(taskId);
              logger.info('[TaskStore] Evicted messages for task', { taskId });
            }

            return { messages: state.messages, messageAccessOrder: newOrder };
          },
          false,
          'evictOldestMessages'
        );
      },

      // ============================================
      // Loading State Actions
      // ============================================

      setLoadingTasks: (loading) => {
        set({ loadingTasks: loading }, false, 'setLoadingTasks');
      },

      setLoadingMessages: (taskId, loading) => {
        set(
          (state) => {
            if (loading) {
              state.loadingMessages.add(taskId);
            } else {
              state.loadingMessages.delete(taskId);
            }
            return { loadingMessages: state.loadingMessages };
          },
          false,
          'setLoadingMessages'
        );
      },

      setError: (error) => {
        set({ error }, false, 'setError');
      },

      // ============================================
      // Selectors
      // ============================================

      getTask: (taskId) => {
        return get().tasks.get(taskId);
      },

      getTaskList: () => {
        const tasks = Array.from(get().tasks.values());
        // Sort by updated_at descending, then by created_at descending for stability
        return tasks.sort((a, b) => {
          if (b.updated_at !== a.updated_at) {
            return b.updated_at - a.updated_at;
          }
          // Same updated_at, use created_at as tie-breaker
          return b.created_at - a.created_at;
        });
      },

      getMessages: (taskId) => {
        return get().messages.get(taskId) || EMPTY_MESSAGES;
      },

      findMessageIndex: (taskId, messageId) => {
        const messages = get().messages.get(taskId) || [];
        return messages.findIndex((msg) => msg.id === messageId);
      },

      getLastUserMessage: (taskId) => {
        const messages = get().messages.get(taskId) || [];
        const userMessages = messages.filter((msg) => msg.role === 'user');
        return userMessages.length > 0 ? userMessages[userMessages.length - 1] : null;
      },
    }),
    {
      name: 'task-store',
      enabled: import.meta.env.DEV,
    }
  )
);

// Export store instance for direct access in non-React contexts
export const taskStore = useTaskStore;
