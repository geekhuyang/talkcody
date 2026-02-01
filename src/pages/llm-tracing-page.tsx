import { ChevronDown, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocale } from '@/hooks/use-locale';
import { logger } from '@/lib/logger';
import { databaseService } from '@/services/database-service';
import type { SpanEventRecord, SpanRecord, TraceDetail, TraceSummary } from '@/types/trace';

const MAX_JSON_PREVIEW = 2000;
const MAX_PAYLOAD_HEIGHT = '24rem';

function formatTimestamp(value: number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function formatDuration(startedAt: number, endedAt: number | null) {
  if (!endedAt || endedAt < startedAt) return '--';
  const durationMs = endedAt - startedAt;
  if (durationMs < 1000) return `${durationMs}ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(2)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder.toFixed(1)}s`;
}

function formatDurationMs(durationMs: number) {
  if (durationMs < 1000) return `${durationMs}ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(2)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder.toFixed(1)}s`;
}

function formatJsonPreview(value: unknown) {
  if (value == null) return '—';
  try {
    const serialized = JSON.stringify(value, null, 2);
    if (serialized.length <= MAX_JSON_PREVIEW) return serialized;
    return `${serialized.slice(0, MAX_JSON_PREVIEW)}...`;
  } catch {
    return String(value);
  }
}

function shouldShowFullPayload(event: SpanEventRecord) {
  return (
    event.eventType === 'http.request.body' ||
    event.eventType === 'http.response.body' ||
    event.eventType === 'gen_ai.response.body'
  );
}

function getSpanLabel(span: SpanRecord) {
  return span.name || span.id;
}

// Build span hierarchy tree
function buildSpanTree(spans: SpanRecord[]): SpanNode[] {
  const spanMap = new Map<string, SpanNode>();
  const roots: SpanNode[] = [];

  // First pass: create nodes
  for (const span of spans) {
    spanMap.set(span.id, {
      span,
      children: [],
      depth: 0,
    });
  }

  // Second pass: build hierarchy
  for (const span of spans) {
    const node = spanMap.get(span.id)!;
    if (span.parentSpanId && spanMap.has(span.parentSpanId)) {
      const parent = spanMap.get(span.parentSpanId)!;
      parent.children.push(node);
      node.depth = parent.depth + 1;
    } else {
      roots.push(node);
    }
  }

  // Sort by start time
  const sortByTime = (a: SpanNode, b: SpanNode) => a.span.startedAt - b.span.startedAt;
  roots.sort(sortByTime);
  for (const node of spanMap.values()) {
    node.children.sort(sortByTime);
  }

  return roots;
}

interface SpanNode {
  span: SpanRecord;
  children: SpanNode[];
  depth: number;
}

export function LLMTracingPage() {
  const { t } = useLocale();
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TraceDetail | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSpans, setExpandedSpans] = useState<Set<string>>(new Set());

  const loadTraces = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      const list = await databaseService.getTraces();
      setTraces(list);
      if (list.length > 0) {
        setSelectedTraceId((current) => current ?? list[0]?.id ?? null);
      } else {
        setSelectedTraceId(null);
        setDetail(null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t.Tracing.loadError;
      setError(message);
      logger.error('Failed to load traces', err);
    } finally {
      setLoadingList(false);
    }
  }, [t.Tracing.loadError]);

  const loadTraceDetail = useCallback(
    async (traceId: string) => {
      setLoadingDetail(true);
      setError(null);
      try {
        const result = await databaseService.getTraceDetails(traceId);
        setDetail(result);
        // Expand all spans by default
        if (result?.spans) {
          setExpandedSpans(new Set(result.spans.map((s) => s.id)));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : t.Tracing.loadError;
        setError(message);
        logger.error('Failed to load trace detail', err);
      } finally {
        setLoadingDetail(false);
      }
    },
    [t.Tracing.loadError]
  );

  useEffect(() => {
    loadTraces();
  }, [loadTraces]);

  useEffect(() => {
    if (selectedTraceId) {
      loadTraceDetail(selectedTraceId);
    }
  }, [selectedTraceId, loadTraceDetail]);

  const selectedTrace = detail?.trace ?? null;
  const spanEventsMap = detail?.eventsBySpanId ?? {};

  // Build span tree for hierarchical display
  const spanTree = useMemo(() => {
    if (!detail?.spans) return [];
    return buildSpanTree(detail.spans);
  }, [detail?.spans]);

  // Calculate timeline bounds
  const timelineBounds = useMemo(() => {
    if (!detail?.spans?.length) return null;
    const start = Math.min(...detail.spans.map((s) => s.startedAt));
    const end = Math.max(...detail.spans.map((s) => s.endedAt ?? s.startedAt));
    return { start, end, duration: Math.max(end - start, 0) };
  }, [detail?.spans]);

  const traceTiming = useMemo(() => {
    if (timelineBounds) {
      return {
        startedAt: timelineBounds.start,
        endedAt: timelineBounds.end,
      };
    }
    return selectedTrace
      ? {
          startedAt: selectedTrace.startedAt,
          endedAt: selectedTrace.endedAt ?? null,
        }
      : null;
  }, [selectedTrace, timelineBounds]);

  const toggleSpanExpanded = useCallback((spanId: string) => {
    setExpandedSpans((prev) => {
      const next = new Set(prev);
      if (next.has(spanId)) {
        next.delete(spanId);
      } else {
        next.add(spanId);
      }
      return next;
    });
  }, []);

  const traceListContent = useMemo(() => {
    if (loadingList) {
      return (
        <div className="space-y-2 p-4">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
        </div>
      );
    }

    if (error) {
      return <div className="p-4 text-sm text-red-600 dark:text-red-400">{error}</div>;
    }

    if (traces.length === 0) {
      return <div className="p-4 text-sm text-muted-foreground">{t.Tracing.emptyDescription}</div>;
    }

    return (
      <div className="space-y-2 p-3">
        {traces.map((trace) => {
          const isSelected = trace.id === selectedTraceId;
          return (
            <button
              key={trace.id}
              type="button"
              className={`w-full rounded border px-3 py-2 text-left transition ${
                isSelected
                  ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950 dark:text-blue-200'
                  : 'border-transparent hover:border-gray-200 hover:bg-gray-50 dark:hover:border-gray-800 dark:hover:bg-gray-900'
              }`}
              onClick={() => setSelectedTraceId(trace.id)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-xs">{trace.id}</span>
                <Badge variant="secondary">{trace.spanCount} spans</Badge>
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>{formatTimestamp(trace.startedAt)}</span>
                <span>{formatDuration(trace.startedAt, trace.endedAt)}</span>
              </div>
            </button>
          );
        })}
      </div>
    );
  }, [error, loadingList, selectedTraceId, t.Tracing.emptyDescription, traces]);

  // Render span tree node recursively
  const renderSpanNode = useCallback(
    (node: SpanNode): React.ReactNode => {
      const span = node.span;
      const isExpanded = expandedSpans.has(span.id);
      const hasChildren = node.children.length > 0;
      const events = spanEventsMap[span.id] ?? [];

      return (
        <div key={span.id} className="select-none">
          <div
            className="flex items-center gap-1 py-1 px-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded cursor-pointer"
            style={{ paddingLeft: `${node.depth * 20 + 8}px` }}
            onClick={() => toggleSpanExpanded(span.id)}
          >
            {hasChildren ? (
              isExpanded ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              )
            ) : (
              <span className="w-4" />
            )}
            <span className="text-sm font-medium">{getSpanLabel(span)}</span>
            <Badge variant="outline" className="ml-2 text-xs">
              {formatDuration(span.startedAt, span.endedAt)}
            </Badge>
          </div>
          {isExpanded && (
            <div className="mt-1">
              <Card className="ml-4">
                <CardHeader className="py-3">
                  <CardDescription className="font-mono text-xs">{span.id}</CardDescription>
                  <div className="text-xs text-muted-foreground">
                    Started: {formatTimestamp(span.startedAt)}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  {span.attributes && Object.keys(span.attributes).length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground mb-1">
                        {t.Tracing.attributesLabel}
                      </div>
                      <pre className="max-h-48 overflow-auto rounded bg-gray-50 p-3 text-xs dark:bg-gray-900">
                        {formatJsonPreview(span.attributes)}
                      </pre>
                    </div>
                  )}
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground mb-1">
                      {t.Tracing.eventsTitle} ({events.length})
                    </div>
                    {events.length === 0 ? (
                      <div className="text-xs text-muted-foreground">{t.Tracing.noEvents}</div>
                    ) : (
                      <div className="space-y-1">
                        {events.map((event) => (
                          <TraceEventRow key={event.id} event={event} />
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
              {node.children.map((child) => renderSpanNode(child))}
            </div>
          )}
        </div>
      );
    },
    [expandedSpans, spanEventsMap, t.Tracing, toggleSpanExpanded]
  );

  // Render timeline view
  const renderTimelineView = useCallback(() => {
    if (!detail?.spans?.length || !timelineBounds) {
      return <div className="p-6 text-sm text-muted-foreground">{t.Tracing.noSpans}</div>;
    }

    const { start, duration } = timelineBounds;

    // Flatten spans for timeline (show all spans, not just roots)
    const flattenSpans = (nodes: SpanNode[], result: SpanNode[] = []) => {
      for (const node of nodes) {
        result.push(node);
        flattenSpans(node.children, result);
      }
      return result;
    };
    const allSpans = flattenSpans(spanTree);

    return (
      <div className="space-y-4">
        <div className="relative">
          {/* Time markers */}
          <div className="relative h-6 border-b border-gray-200 dark:border-gray-800 mb-2">
            {[0, 25, 50, 75, 100].map((pct) => (
              <div
                key={pct}
                className="absolute text-xs text-muted-foreground transform -translate-x-1/2"
                style={{ left: `${pct}%` }}
              >
                {formatDurationMs((duration * pct) / 100)}
              </div>
            ))}
          </div>

          {/* Span bars */}
          <div className="space-y-1">
            {allSpans.map((node) => {
              const span = node.span;
              const spanStart = span.startedAt - start;
              const spanDuration = (span.endedAt ?? span.startedAt) - span.startedAt;
              const leftPercent = (spanStart / duration) * 100;
              const widthPercent = Math.max((spanDuration / duration) * 100, 0.5);

              return (
                <div
                  key={span.id}
                  className="flex items-center gap-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-900"
                  style={{ paddingLeft: `${node.depth * 16}px` }}
                >
                  <div className="w-32 truncate text-xs" title={getSpanLabel(span)}>
                    {getSpanLabel(span)}
                  </div>
                  <div className="flex-1 relative h-6 bg-gray-100 dark:bg-gray-800 rounded overflow-hidden">
                    <div
                      className="absolute h-full bg-blue-500 rounded transition-all"
                      style={{
                        left: `${Math.min(leftPercent, 100)}%`,
                        width: `${Math.min(widthPercent, 100 - leftPercent)}%`,
                      }}
                      title={`${getSpanLabel(span)}: ${formatDurationMs(spanDuration)}`}
                    />
                  </div>
                  <div className="w-16 text-xs text-muted-foreground text-right">
                    {formatDurationMs(spanDuration)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Span details */}
        <div className="mt-6">
          <h4 className="text-sm font-semibold mb-3">{t.Tracing.spansTitle}</h4>
          <div className="space-y-2">{spanTree.map((node) => renderSpanNode(node))}</div>
        </div>
      </div>
    );
  }, [
    detail?.spans,
    timelineBounds,
    t.Tracing.noSpans,
    t.Tracing.spansTitle,
    spanTree,
    renderSpanNode,
  ]);

  const detailContent = useMemo(() => {
    if (loadingDetail) {
      return (
        <div className="space-y-4 p-6">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-40 w-full" />
        </div>
      );
    }

    if (!selectedTrace) {
      return <div className="p-6 text-sm text-muted-foreground">{t.Tracing.selectTrace}</div>;
    }

    const startedAt = traceTiming?.startedAt ?? selectedTrace.startedAt;
    const endedAt = traceTiming?.endedAt ?? selectedTrace.endedAt;

    return (
      <div className="space-y-6 p-6">
        {/* Trace Header */}
        <div>
          <h2 className="text-lg font-semibold">{t.Tracing.detailTitle}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{selectedTrace.id}</p>
          <div className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
            <div>
              <span className="font-medium text-foreground">{t.Tracing.startedAtLabel}:</span>{' '}
              {formatTimestamp(startedAt)}
            </div>
            <div>
              <span className="font-medium text-foreground">{t.Tracing.durationLabel}:</span>{' '}
              {formatDuration(startedAt, endedAt ?? null)}
            </div>
            <div>
              <span className="font-medium text-foreground">{t.Tracing.spanCountLabel}:</span>{' '}
              {selectedTrace.spanCount}
            </div>
          </div>
        </div>

        {/* Span Content */}
        <div>
          <h3 className="text-base font-semibold mb-3">{t.Tracing.spansTitle}</h3>
          {detail?.spans.length ? (
            renderTimelineView()
          ) : (
            <div className="text-sm text-muted-foreground">{t.Tracing.noSpans}</div>
          )}
        </div>
      </div>
    );
  }, [detail, loadingDetail, selectedTrace, traceTiming, renderTimelineView, t.Tracing]);

  return (
    <div className="flex h-full flex-col bg-white dark:bg-gray-950">
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div>
          <h1 className="text-2xl font-bold">{t.Tracing.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t.Tracing.description}</p>
        </div>
        <Button onClick={loadTraces} disabled={loadingList}>
          {t.Common.refresh}
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-full max-w-sm border-r">
          <Card className="h-full rounded-none border-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t.Tracing.listTitle}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[calc(100vh-180px)]">{traceListContent}</ScrollArea>
            </CardContent>
          </Card>
        </div>
        <div className="flex-1 overflow-hidden">
          <ScrollArea className="h-[calc(100vh-140px)]">{detailContent}</ScrollArea>
        </div>
      </div>
    </div>
  );
}

function TraceEventRow({ event }: { event: SpanEventRecord }) {
  const showFullPayload = shouldShowFullPayload(event);
  const payloadPreview = showFullPayload
    ? JSON.stringify(event.payload, null, 2)
    : formatJsonPreview(event.payload);

  return (
    <details className="rounded border px-3 py-2 text-xs">
      <summary className="flex cursor-pointer items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{event.eventType}</Badge>
          <span className="text-muted-foreground">{formatTimestamp(event.timestamp)}</span>
        </div>
        <span className="text-muted-foreground truncate max-w-[200px]">{event.id}</span>
      </summary>
      <pre
        className="mt-2 overflow-auto rounded bg-gray-50 p-2 text-xs dark:bg-gray-900"
        style={{ maxHeight: MAX_PAYLOAD_HEIGHT }}
      >
        {payloadPreview}
      </pre>
    </details>
  );
}
