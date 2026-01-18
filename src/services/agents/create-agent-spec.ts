export interface CreateAgentSpec {
  id?: string;
  name: string;
  description?: string;
  systemPrompt: string;
  tools?: string[];
  modelType?: string;
  rules?: string;
  outputFormat?: string;
  dynamicPrompt?: {
    enabled?: boolean;
    providers?: string[];
    variables?: Record<string, string>;
    providerSettings?: Record<string, unknown>;
  };
  defaultSkills?: string[];
  role?: 'read' | 'write';
  canBeSubagent?: boolean;
  hidden?: boolean;
}

const JSON_BLOCK_RE = /```json\s*([\s\S]*?)```/i;
const ANY_BLOCK_RE = /```([\s\S]*?)```/i;

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cleaned = value.map((item) => String(item).trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned : undefined;
}

function normalizeRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const normalized: Record<string, string> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === 'string') {
      normalized[key] = item;
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function extractJsonCandidate(text: string): string | null {
  const jsonMatch = text.match(JSON_BLOCK_RE);
  if (jsonMatch?.[1]) {
    return jsonMatch[1].trim();
  }

  const anyMatch = text.match(ANY_BLOCK_RE);
  if (anyMatch?.[1]) {
    return anyMatch[1].trim();
  }

  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  return null;
}

export function extractAgentSpecFromText(text: string): CreateAgentSpec | null {
  const candidate = extractJsonCandidate(text);
  if (!candidate) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const spec = parsed as Record<string, unknown>;
  if (typeof spec.name !== 'string' || typeof spec.systemPrompt !== 'string') {
    return null;
  }

  const dynamicPrompt = spec.dynamicPrompt as CreateAgentSpec['dynamicPrompt'] | undefined;

  return {
    id: typeof spec.id === 'string' ? spec.id : undefined,
    name: spec.name,
    description: typeof spec.description === 'string' ? spec.description : undefined,
    systemPrompt: spec.systemPrompt,
    tools: normalizeStringArray(spec.tools),
    modelType: typeof spec.modelType === 'string' ? spec.modelType : undefined,
    rules: typeof spec.rules === 'string' ? spec.rules : undefined,
    outputFormat: typeof spec.outputFormat === 'string' ? spec.outputFormat : undefined,
    dynamicPrompt: dynamicPrompt
      ? {
          enabled: typeof dynamicPrompt.enabled === 'boolean' ? dynamicPrompt.enabled : undefined,
          providers: normalizeStringArray(dynamicPrompt.providers),
          variables: normalizeRecord(dynamicPrompt.variables),
          providerSettings:
            dynamicPrompt.providerSettings && typeof dynamicPrompt.providerSettings === 'object'
              ? dynamicPrompt.providerSettings
              : undefined,
        }
      : undefined,
    defaultSkills: normalizeStringArray(spec.defaultSkills),
    role: spec.role === 'read' || spec.role === 'write' ? spec.role : undefined,
    canBeSubagent: typeof spec.canBeSubagent === 'boolean' ? spec.canBeSubagent : undefined,
    hidden: typeof spec.hidden === 'boolean' ? spec.hidden : undefined,
  };
}
