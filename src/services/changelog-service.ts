// Changelog data service for What's New dialog

export interface ChangelogContent {
  added?: string[];
  changed?: string[];
  fixed?: string[];
  removed?: string[];
  security?: string[];
  deprecated?: string[];
}

export interface ChangelogEntry {
  version: string;
  date: string;
  en: ChangelogContent;
  zh: ChangelogContent;
}

// Changelog data - update this when releasing new versions
// Only include the most recent versions that users care about
export const CHANGELOG_DATA: ChangelogEntry[] = [
  {
    version: '0.2.1',
    date: '2025-12-27',
    en: {
      added: [
        'Add Qwen Code Free Provider, to save your coding cost',
        'Add Github Copilot Free Provider, to save your coding cost',
      ],
      changed: ['Improve context compaction logic, to better handle long conversations'],
    },
    zh: {
      added: [
        '新增 Qwen Code 免费提供商，节省您的编码成本',
        '新增 Github Copilot 免费提供商，节省您的编码成本',
      ],
      changed: ['优化上下文压缩逻辑，更好地处理长对话'],
    },
  },
  {
    version: '0.2.0',
    date: '2025-12-25',
    en: {
      added: [
        'Claude model support via Claude Pro/Max subscription',
        'OpenAI model support via ChatGPT Plus/Pro subscription',
        'LSP Support: Complete Language Server Protocol implementation with code navigation, code completion, go-to-definition, find references, and other core features, significantly improving code understanding and editing experience',
        'Exa Free Web Search: New Exa search engine provider for out-of-the-box web search',
        'Custom Terminal Font: Support for custom terminal font and font size settings',
        'MiniMax 2.1 model support (free to use via TalkCody Provider)',
        'GLM 4.7 model support (TalkCody supports hot model updates, latest excellent coding models are usually auto-updated within 12 hours)',
      ],
      changed: [
        'Improved write file and edit file tool result display',
        'Optimized Prompt Cache for further cost savings',
      ],
      fixed: [
        'Fixed Windows terminal related bug',
        'Fixed model selector list duplicate display bug',
        'Fixed write file tool failing to write files correctly in some cases',
        'Fixed incorrect git status display in multi-window scenarios',
      ],
    },
    zh: {
      added: [
        '支持通过 Claude Pro/Max 订阅，在 TalkCody 中使用 Claude 模型',
        '通过 ChatGPT Plus/Pro 订阅，在 TalkCody 中使用 OpenAI 模型',
        'LSP 支持：完整实现语言服务器协议，提供代码导航、代码补全、跳转到定义、查找引用等核心功能，大幅提升代码理解和编辑体验',
        'Exa 免费网页搜索：新增 Exa 搜索引擎提供商，让网页搜索开箱即用',
        '终端字体自定义：支持自定义终端字体和字号设置',
        '支持 MiniMax 2.1 模型（可以通过 TalkCody Provider 免费使用）',
        '支持 GLM 4.7 模型（TalkCody 支持模型热更新，一般最新的优秀 Coding 模型 12 小时会自动更新）',
      ],
      changed: [
        '优化 write file 和 edit file tool 的结果展示',
        '优化 Prompt Cache，进一步节省成本',
      ],
      fixed: [
        '修复 Windows 终端相关 bug',
        '修复模型选择器列表重复显示 bug',
        '修复 write file tool 在某些情况下无法正确写入文件的 bug',
        '修复多窗口下，git status 显示不对的 bug',
      ],
    },
  },
];

export function getChangelogForVersion(version: string): ChangelogEntry | undefined {
  return CHANGELOG_DATA.find((entry) => entry.version === version);
}

export function getLatestChangelog(): ChangelogEntry | undefined {
  return CHANGELOG_DATA[0];
}
