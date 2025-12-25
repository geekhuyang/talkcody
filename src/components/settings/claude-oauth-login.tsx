// src/components/settings/claude-oauth-login.tsx
// OAuth login component for Claude Pro/Max authentication

import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { Check, ExternalLink, Loader2, LogOut, X } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLocale } from '@/hooks/use-locale';
import { logger } from '@/lib/logger';
import { useClaudeOAuthStore } from '@/providers/oauth/claude-oauth-store';
import { useProviderStore } from '@/providers/stores/provider-store';

type FlowState = 'idle' | 'waiting-for-code' | 'exchanging' | 'connected';

const CLAUDE_OAUTH_DISCLAIMER_KEY = 'claude-oauth-disclaimer-agreed';

export function ClaudeOAuthLogin() {
  const { t } = useLocale();
  const authCodeId = useId();
  const disclaimerCheckboxId = useId();
  const [flowState, setFlowState] = useState<FlowState>('idle');
  const [authCode, setAuthCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const {
    isConnected,
    isLoading,
    error: storeError,
    initialize,
    startOAuth,
    completeOAuth,
    disconnect,
  } = useClaudeOAuthStore();

  // Disclaimer dialog state
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [disclaimerAgreed, setDisclaimerAgreed] = useState(false);

  // Initialize OAuth store on mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  // Sync flow state with connection status
  useEffect(() => {
    if (isConnected) {
      setFlowState('connected');
    } else if (flowState === 'connected') {
      setFlowState('idle');
    }
  }, [isConnected, flowState]);

  // Perform the actual OAuth flow
  const performOAuth = useCallback(async () => {
    setError(null);
    setAuthCode('');

    try {
      const url = await startOAuth();
      setFlowState('waiting-for-code');

      // Open OAuth URL in system browser
      await shellOpen(url);
      logger.info('[ClaudeOAuthLogin] Opened OAuth URL in browser');
    } catch (err) {
      logger.error('[ClaudeOAuthLogin] Failed to start OAuth:', err);
      setError(err instanceof Error ? err.message : t.Settings.claudeOAuth.connectionFailed);
      setFlowState('idle');
    }
  }, [startOAuth, t]);

  // Handle starting OAuth flow
  const handleStartOAuth = useCallback(async () => {
    // Check if user has already agreed to the disclaimer
    const hasAgreed = localStorage.getItem(CLAUDE_OAUTH_DISCLAIMER_KEY) === 'true';

    if (hasAgreed) {
      // User has agreed, proceed with OAuth
      await performOAuth();
    } else {
      // Show disclaimer dialog
      setShowDisclaimer(true);
      setDisclaimerAgreed(false);
    }
  }, [performOAuth]);

  // Handle disclaimer confirmation
  const handleDisclaimerConfirm = useCallback(async () => {
    if (!disclaimerAgreed) return;

    // Save agreement to localStorage
    localStorage.setItem(CLAUDE_OAUTH_DISCLAIMER_KEY, 'true');
    setShowDisclaimer(false);

    // Proceed with OAuth
    await performOAuth();
  }, [disclaimerAgreed, performOAuth]);

  // Handle submitting authorization code
  const handleSubmitCode = useCallback(async () => {
    if (!authCode.trim()) {
      setError(t.Settings.claudeOAuth.pasteCode);
      return;
    }

    setError(null);
    setFlowState('exchanging');

    try {
      await completeOAuth(authCode.trim());

      // Refresh provider store to pick up new OAuth credentials
      await useProviderStore.getState().refresh();

      toast.success(t.Settings.claudeOAuth.connected);
      setAuthCode('');
      setFlowState('connected');
    } catch (err) {
      logger.error('[ClaudeOAuthLogin] Failed to complete OAuth:', err);
      setError(err instanceof Error ? err.message : t.Settings.claudeOAuth.connectionFailed);
      setFlowState('waiting-for-code');
    }
  }, [authCode, completeOAuth, t]);

  // Handle disconnecting
  const handleDisconnect = useCallback(async () => {
    setError(null);

    try {
      await disconnect();

      // Refresh provider store to remove OAuth credentials
      await useProviderStore.getState().refresh();

      toast.success(t.Settings.claudeOAuth.disconnected);
      setFlowState('idle');
    } catch (err) {
      logger.error('[ClaudeOAuthLogin] Failed to disconnect:', err);
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    }
  }, [disconnect, t]);

  // Handle cancel during code entry
  const handleCancel = useCallback(() => {
    setFlowState('idle');
    setAuthCode('');
    setError(null);
  }, []);

  // Connected state
  if (flowState === 'connected' || isConnected) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
            <span className="text-sm text-green-600 dark:text-green-400">
              {t.Settings.claudeOAuth.connectedWithPlan}
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={handleDisconnect} disabled={isLoading}>
            {isLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <LogOut className="mr-2 h-4 w-4" />
            )}
            {t.Settings.claudeOAuth.disconnect}
          </Button>
        </div>
        {(error || storeError) && <p className="text-sm text-red-500">{error || storeError}</p>}
      </div>
    );
  }

  // Waiting for code state
  if (flowState === 'waiting-for-code' || flowState === 'exchanging') {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ExternalLink className="h-4 w-4" />
          <span>{t.Settings.claudeOAuth.browserOpened}</span>
        </div>

        <div className="space-y-2">
          <Label htmlFor={authCodeId} className="text-sm">
            {t.Settings.claudeOAuth.pasteCodeLabel}
          </Label>
          <div className="flex gap-2">
            <Input
              id={authCodeId}
              type="text"
              placeholder={t.Settings.claudeOAuth.codePlaceholder}
              value={authCode}
              onChange={(e) => setAuthCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSubmitCode();
                }
              }}
              disabled={flowState === 'exchanging'}
              className="font-mono text-sm"
            />
            <Button
              onClick={handleSubmitCode}
              disabled={flowState === 'exchanging' || !authCode.trim()}
            >
              {flowState === 'exchanging' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {t.Settings.claudeOAuth.connect}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleCancel}
              disabled={flowState === 'exchanging'}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {(error || storeError) && <p className="text-sm text-red-500">{error || storeError}</p>}
      </div>
    );
  }

  // Idle state - show sign in button
  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium">{t.Settings.claudeOAuth.title}</p>
            <p className="text-xs text-muted-foreground">{t.Settings.claudeOAuth.description}</p>
          </div>
          <Button onClick={handleStartOAuth} disabled={isLoading}>
            {isLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ExternalLink className="mr-2 h-4 w-4" />
            )}
            {t.Settings.claudeOAuth.signIn}
          </Button>
        </div>

        {(error || storeError) && <p className="text-sm text-red-500">{error || storeError}</p>}
      </div>

      {/* Disclaimer Dialog */}
      <Dialog open={showDisclaimer} onOpenChange={setShowDisclaimer}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t.Settings.claudeOAuth.disclaimer.dialogTitle}</DialogTitle>
            <DialogDescription>
              {t.Settings.claudeOAuth.disclaimer.dialogDescription}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md bg-muted p-4 text-sm space-y-3">
              <p>
                Please read the{' '}
                <a
                  href={t.Settings.claudeOAuth.disclaimer.termsLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline font-medium"
                >
                  Terms of Use & Disclaimer
                </a>{' '}
                before proceeding.
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id={disclaimerCheckboxId}
                checked={disclaimerAgreed}
                onCheckedChange={(checked) => setDisclaimerAgreed(checked === true)}
              />
              <label
                htmlFor={disclaimerCheckboxId}
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                {t.Settings.claudeOAuth.disclaimer.checkboxLabel}
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDisclaimer(false)}>
              {t.Settings.claudeOAuth.disclaimer.cancelButton}
            </Button>
            <Button onClick={handleDisclaimerConfirm} disabled={!disclaimerAgreed}>
              {t.Settings.claudeOAuth.disclaimer.confirmButton}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
