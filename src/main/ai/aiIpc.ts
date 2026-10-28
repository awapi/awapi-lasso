import {
  AI_PROVIDER_IDS,
  isAiProviderId,
  type AiKeyStatus,
  type AiListModelsResult,
  type AiSendRequest,
  type AiSettings,
  type AiTestConnectionResult,
  type AiTurnEvent,
} from '../../shared/aiTypes';
import type { SecretStoreDeps } from '../secretStore';
import {
  clearAiKey,
  hasAiKey,
  loadAiSettings,
  saveAiSettings,
  setAiKey,
  type AiSettingsFsDeps,
} from './aiSettingsStore';
import { cancelAiTurn, listAiModels, resolveAiToolResult, runAiTurn, testAiConnection } from './aiService';

export const AI_EVENT_CHANNEL = 'ai:event';

export interface AiIpcMainLike {
  // Mirrors Electron's `IpcMain.handle` signature, whose listener args are `any[]`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle(channel: string, listener: (event: unknown, ...args: any[]) => unknown): void;
}

export interface AiIpcDeps {
  fsDeps: AiSettingsFsDeps;
  secretDeps: SecretStoreDeps;
  /**
   * Delivers a streamed event. `origin` is the IPC event of the `ai:send` call, so the event can go back
   * to the window that started the turn.
   */
  sendEvent: (event: AiTurnEvent, origin: unknown) => void;
  /** Secrets known only to Main (keychain values, cached OAuth 2.0 tokens), scrubbed from AI traffic. */
  getMainSecretValues?: () => string[];
  /**
   * Fetch used for every provider call. Main passes Electron's `net.fetch`, so AI traffic follows the OS proxy
   * settings (incl. PAC) and trusts the OS certificate store (corporate root CAs). Defaults to Node's `fetch`.
   */
  fetchImpl?: typeof fetch;
}

export type AiSetKeyResult = { ok: true } | { ok: false; error: string };

/**
 * Registers `ai:*` IPC handlers. API keys are write-only from the renderer: only `ai:getKeyStatus`
 * (boolean) is exposed for reading, and plaintext keys never cross the process boundary.
 */
export function registerAiIpc(ipcMain: AiIpcMainLike, deps: AiIpcDeps): void {
  ipcMain.handle('ai:getSettings', (): AiSettings => loadAiSettings(deps.fsDeps));

  ipcMain.handle(
    'ai:saveSettings',
    (_event, partial: Partial<AiSettings>): AiSettings =>
      saveAiSettings(partial && typeof partial === 'object' ? partial : {}, deps.fsDeps),
  );

  ipcMain.handle(
    'ai:getKeyStatuses',
    (): AiKeyStatus[] =>
      AI_PROVIDER_IDS.map(provider => ({ provider, hasKey: hasAiKey(provider, deps.secretDeps) })),
  );

  ipcMain.handle('ai:setKey', (_event, provider: unknown, apiKey: unknown): AiSetKeyResult => {
    if (!isAiProviderId(provider) || typeof apiKey !== 'string') {
      return { ok: false, error: 'Invalid provider or API key.' };
    }
    try {
      setAiKey(provider, apiKey, deps.secretDeps);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('ai:clearKey', (_event, provider: unknown): boolean =>
    isAiProviderId(provider) ? clearAiKey(provider, deps.secretDeps) : false,
  );

  ipcMain.handle(
    'ai:testConnection',
    (): Promise<AiTestConnectionResult> =>
      testAiConnection({ fsDeps: deps.fsDeps, secretDeps: deps.secretDeps, fetchImpl: deps.fetchImpl }),
  );

  ipcMain.handle(
    'ai:listModels',
    (): Promise<AiListModelsResult> =>
      listAiModels({ fsDeps: deps.fsDeps, secretDeps: deps.secretDeps, fetchImpl: deps.fetchImpl }),
  );

  ipcMain.handle('ai:send', (origin, request: AiSendRequest): { started: boolean } => {
    if (!request || typeof request.turnId !== 'string' || request.turnId === '') {
      return { started: false };
    }
    void runAiTurn(request, {
      fsDeps: deps.fsDeps,
      secretDeps: deps.secretDeps,
      emit: turnEvent => deps.sendEvent(turnEvent, origin),
      getMainSecretValues: deps.getMainSecretValues,
      fetchImpl: deps.fetchImpl,
    });
    return { started: true };
  });

  ipcMain.handle('ai:toolResult', (_event, callId: unknown, result: unknown): boolean =>
    resolveAiToolResult(callId, result),
  );

  ipcMain.handle('ai:cancel', (_event, turnId: unknown): boolean =>
    typeof turnId === 'string' ? cancelAiTurn(turnId) : false,
  );
}
