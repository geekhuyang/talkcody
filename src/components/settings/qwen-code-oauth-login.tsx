// src/components/settings/qwen-code-oauth-login.tsx
// OAuth login component for Qwen Code authentication

import { Check, Loader2, LogOut, X } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLocale } from '@/hooks/use-locale';
import { logger } from '@/lib/logger';
import { useQwenCodeOAuthStore } from '@/providers/oauth/qwen-code-oauth-store';
import { useProviderStore } from '@/providers/stores/provider-store';

type FlowState = 'idle' | 'testing' | 'connected';

// Default Qwen Code OAuth credentials path
const DEFAULT_QWEN_OAUTH_PATH = '~/.qwen/oauth_creds.json';

export function QwenCodeOAuthLogin() {
  const { t } = useLocale();
  const inputId = useId();
  const [flowState, setFlowState] = useState<FlowState>('idle');
  const [tokenPath, setTokenPath] = useState('');
  const [error, setError] = useState<string | null>(null);

  const {
    isConnected,
    isLoading,
    error: storeError,
    tokenPath: storedPath,
    initialize,
    setTokenPath: saveTokenPath,
    testConnection,
    disconnect,
  } = useQwenCodeOAuthStore();

  // Initialize OAuth store on mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  // Sync local state with store
  useEffect(() => {
    if (storedPath) {
      setTokenPath(storedPath);
    }
    if (isConnected) {
      setFlowState('connected');
    } else if (flowState === 'connected') {
      setFlowState('idle');
    }
  }, [storedPath, isConnected, flowState]);

  // Sync error from store
  useEffect(() => {
    if (storeError) {
      setError(storeError);
    }
  }, [storeError]);

  // Initialize with default path if empty
  useEffect(() => {
    if (!tokenPath && !storedPath) {
      setTokenPath(DEFAULT_QWEN_OAUTH_PATH);
    }
  }, [tokenPath, storedPath]);

  // Handle using default path
  const handleUseDefaultPath = useCallback(() => {
    setTokenPath(DEFAULT_QWEN_OAUTH_PATH);
    setError(null);
  }, []);

  // Handle testing connection
  const handleTestConnection = useCallback(async () => {
    if (!tokenPath.trim()) {
      setError(t.Settings.qwenOAuth.pathRequired);
      return;
    }

    setError(null);
    setFlowState('testing');

    try {
      // Save token path first
      await saveTokenPath(tokenPath.trim());

      // Test the connection
      const success = await testConnection();

      if (success) {
        // Refresh provider store to pick up new OAuth credentials
        await useProviderStore.getState().refresh();

        toast.success(t.Settings.qwenOAuth.connected);
        setFlowState('connected');
      } else {
        setError(t.Settings.qwenOAuth.testFailed);
        setFlowState('idle');
      }
    } catch (err) {
      logger.error('[QwenOAuthLogin] Failed to test connection:', err);
      setError(err instanceof Error ? err.message : t.Settings.qwenOAuth.testFailed);
      setFlowState('idle');
    }
  }, [tokenPath, saveTokenPath, testConnection, t]);

  // Handle disconnecting
  const handleDisconnect = useCallback(async () => {
    setError(null);

    try {
      await disconnect();

      // Refresh provider store to remove OAuth credentials
      await useProviderStore.getState().refresh();

      toast.success(t.Settings.qwenOAuth.disconnected);
      setTokenPath('');
      setFlowState('idle');
    } catch (err) {
      logger.error('[QwenOAuthLogin] Failed to disconnect:', err);
      setError(err instanceof Error ? err.message : t.Settings.qwenOAuth.disconnectFailed);
    }
  }, [disconnect, t]);

  // Connected state
  if (isConnected && flowState === 'connected') {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-green-600">
          <Check size={16} className="flex-shrink-0" />
          <span className="font-medium">{t.Settings.qwenOAuth.connected}</span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleDisconnect}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t.Common.loading}
              </>
            ) : (
              <>
                <LogOut className="mr-2 h-4 w-4" />
                {t.Settings.qwenOAuth.disconnect}
              </>
            )}
          </Button>
        </div>

        {storedPath && (
          <div className="text-xs text-muted-foreground">
            <div className="font-medium">{t.Settings.qwenOAuth.tokenPath}:</div>
            <div className="mt-1 font-mono break-all">{storedPath}</div>
          </div>
        )}
      </div>
    );
  }

  // Not connected - show path input
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor={`${inputId}`}>{t.Settings.qwenOAuth.tokenPathLabel}</Label>
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              id={inputId}
              type="text"
              placeholder={DEFAULT_QWEN_OAUTH_PATH}
              value={tokenPath}
              onChange={(e) => {
                setTokenPath(e.target.value);
                setError(null);
              }}
              className="flex-1 font-mono text-sm"
            />
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={handleTestConnection}
              disabled={isLoading || !tokenPath.trim()}
            >
              {flowState === 'testing' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t.Settings.qwenOAuth.testing}
                </>
              ) : (
                t.Settings.qwenOAuth.testConnection
              )}
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleUseDefaultPath}
              disabled={isLoading}
              className="text-xs"
            >
              {t.Settings.qwenOAuth.useDefault || 'Use Default Path'}
            </Button>
          </div>
        </div>

        {/* Error display */}
        {error && (
          <div className="flex items-start gap-2 text-sm text-red-600">
            <X size={16} className="flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Help text */}
        <div className="text-xs text-muted-foreground space-y-1">
          <p>{t.Settings.qwenOAuth.helpText}</p>
          <p className="font-mono">
            {t.Settings.qwenOAuth.defaultLocation || 'Default location'}: {DEFAULT_QWEN_OAUTH_PATH}
          </p>
        </div>
      </div>
    </div>
  );
}
