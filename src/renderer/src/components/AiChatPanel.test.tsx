import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {
  AiChatPanel,
  AI_PANEL_DEFAULT_WIDTH,
  AI_PANEL_MAX_WIDTH,
  AI_PANEL_MIN_WIDTH,
  AI_PANEL_WIDTH_STORAGE_KEY,
  parseMessageBlocks,
} from './AiChatPanel';
import { ThemeProvider } from '../context/ThemeContext';
import { createDefaultAiSettings, type AiTurnEvent } from '../../../shared/aiTypes';
import type { AiToolWorkspace } from '../aiToolHost';
import { createDefaultHttpRequest, createEmptyCollection } from '../../../shared/collectionSchema';

describe('parseMessageBlocks', () => {
  it('splits prose and fenced code with languages', () => {
    expect(parseMessageBlocks('Try:\n```graphql\n{ me { id } }\n```\nDone')).toEqual([
      { type: 'text', content: 'Try:\n' },
      { type: 'code', lang: 'graphql', content: '{ me { id } }' },
      { type: 'text', content: 'Done' },
    ]);
  });

  it('treats an unterminated fence as code while streaming', () => {
    expect(parseMessageBlocks('Here:\n```json\n{"a":')).toEqual([
      { type: 'text', content: 'Here:\n' },
      { type: 'code', lang: 'json', content: '{"a":' },
    ]);
  });

  it('handles plain text, empty input and untagged fences', () => {
    expect(parseMessageBlocks('hello')).toEqual([{ type: 'text', content: 'hello' }]);
    expect(parseMessageBlocks('')).toEqual([]);
    expect(parseMessageBlocks('```\nx\n```')).toEqual([{ type: 'code', lang: undefined, content: 'x' }]);
  });
});

describe('AiChatPanel', () => {
  let emit: (e: AiTurnEvent) => void;
  let api: Record<string, ReturnType<typeof vi.fn>>;

  const setup = (hasKey: boolean, props: Partial<React.ComponentProps<typeof AiChatPanel>> = {}) => {
    api = {
      aiGetSettings: vi.fn().mockResolvedValue(createDefaultAiSettings()),
      aiGetKeyStatuses: vi.fn().mockResolvedValue([{ provider: 'openai', hasKey }]),
      aiSend: vi.fn().mockResolvedValue({ started: true }),
      aiCancel: vi.fn().mockResolvedValue(true),
      aiToolResult: vi.fn().mockResolvedValue(true),
      onAiEvent: vi.fn((cb: (e: AiTurnEvent) => void) => {
        emit = cb;
        return () => {};
      }),
      copyToClipboard: vi.fn().mockResolvedValue(undefined),
    };
    window.electronAPI = api as unknown as Window['electronAPI'];
    const getContext = vi.fn(() => ({ secretValues: [] as string[] }));
    render(
      <ThemeProvider>
        <AiChatPanel open onClose={vi.fn()} getContext={getContext} {...props} />
      </ThemeProvider>,
    );
    return { getContext };
  };

  beforeEach(() => {
    window.localStorage.clear();
  });

  it('shows onboarding with a privacy notice and disables input when no key is set', async () => {
    setup(false);
    await waitFor(() => expect(screen.getByTestId('ai-onboarding')).toBeInTheDocument());
    expect(screen.getByTestId('ai-onboarding')).toHaveTextContent('OS Keychain');
    expect(screen.getByTestId('ai-input')).toBeDisabled();
    expect(screen.queryByTestId('ai-quick-actions')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('ai-setup-btn'));
    expect(await screen.findByTestId('ai-settings-modal')).toBeInTheDocument();
  });

  it('is hidden but stays mounted when closed', () => {
    setup(true, { open: false });
    expect(screen.getByTestId('ai-chat-panel')).toHaveStyle({ display: 'none' });
  });

  it('sends a message on Enter with fresh context, streams the reply and renders code blocks', async () => {
    const { getContext } = setup(true);
    await waitFor(() => expect(screen.getByTestId('ai-provider-label')).toHaveTextContent('OpenAI'));

    const input = screen.getByTestId('ai-input');
    fireEvent.change(input, { target: { value: 'write a query' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(api.aiSend).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(api.aiSend).toHaveBeenCalledTimes(1));
    expect(getContext).toHaveBeenCalled();
    const request = api.aiSend.mock.calls[0][0] as { turnId: string; messages: unknown[] };
    expect(request.messages).toEqual([{ role: 'user', content: 'write a query' }]);
    expect(input).toHaveValue('');
    expect(screen.getByTestId('ai-stop-btn')).toBeInTheDocument();

    act(() => {
      emit({ turnId: request.turnId, event: { type: 'text-delta', text: 'Use:\n```graphql\n{ me { id } }\n```' } });
      emit({ turnId: request.turnId, event: { type: 'done' } });
    });
    expect(screen.getByTestId('ai-code-block')).toHaveTextContent('{ me { id } }');
    expect(screen.getByTestId('ai-send-btn')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('ai-copy-code-btn'));
    expect(api.copyToClipboard).toHaveBeenCalledWith('{ me { id } }');
  });

  it('runs quick actions and shows errors in the transcript', async () => {
    setup(true);
    await waitFor(() => screen.getByTestId('ai-quick-actions'));
    fireEvent.click(screen.getByTestId('ai-quick-explain-error'));
    await waitFor(() => expect(api.aiSend).toHaveBeenCalled());
    const request = api.aiSend.mock.calls[0][0] as { turnId: string; messages: Array<{ content: string }> };
    expect(request.messages[0].content).toMatch(/last response fail/);
    act(() => emit({ turnId: request.turnId, event: { type: 'error', message: 'Bad key' } }));
    expect(screen.getByTestId('ai-message-assistant')).toHaveTextContent('Bad key');
    expect(screen.queryByTestId('ai-quick-actions')).not.toBeInTheDocument();
  });

  it('stops generation and clears the conversation', async () => {
    setup(true);
    await waitFor(() => screen.getByTestId('ai-input'));
    fireEvent.change(screen.getByTestId('ai-input'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByTestId('ai-send-btn'));
    await waitFor(() => screen.getByTestId('ai-stop-btn'));
    fireEvent.click(screen.getByTestId('ai-stop-btn'));
    expect(api.aiCancel).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('ai-clear-btn'));
    expect(screen.queryByTestId('ai-message-user')).not.toBeInTheDocument();
    expect(screen.getByTestId('ai-quick-actions')).toBeInTheDocument();
  });

  it('calls onClose from the header button', async () => {
    const onClose = vi.fn();
    setup(true, { onClose });
    fireEvent.click(screen.getByTestId('ai-close-btn'));
    expect(onClose).toHaveBeenCalled();
  });

  it('resizes by dragging, clamps the width, persists it, and resets on double-click', async () => {
    setup(true);
    const panel = screen.getByTestId('ai-chat-panel');
    expect(panel).toHaveStyle({ width: `${AI_PANEL_DEFAULT_WIDTH}px` });
    const resizer = screen.getByTestId('ai-chat-resizer');

    fireEvent.mouseDown(resizer, { clientX: 1000 });
    fireEvent.mouseMove(window, { clientX: 900 });
    expect(panel).toHaveStyle({ width: `${AI_PANEL_DEFAULT_WIDTH + 100}px` });
    fireEvent.mouseMove(window, { clientX: -5000 });
    expect(panel).toHaveStyle({ width: `${AI_PANEL_MAX_WIDTH}px` });
    fireEvent.mouseMove(window, { clientX: 9000 });
    expect(panel).toHaveStyle({ width: `${AI_PANEL_MIN_WIDTH}px` });
    fireEvent.mouseUp(window);
    expect(window.localStorage.getItem(AI_PANEL_WIDTH_STORAGE_KEY)).toBe(String(AI_PANEL_MIN_WIDTH));

    fireEvent.doubleClick(resizer);
    expect(panel).toHaveStyle({ width: `${AI_PANEL_DEFAULT_WIDTH}px` });
  });

  it('restores a persisted width', () => {
    window.localStorage.setItem(AI_PANEL_WIDTH_STORAGE_KEY, '500');
    setup(true);
    expect(screen.getByTestId('ai-chat-panel')).toHaveStyle({ width: '500px' });
  });

  describe('workspace tools', () => {
    const makeWorkspace = () => {
      const request = createDefaultHttpRequest({ id: 'req_1', name: 'Users', url: '{{baseUrl}}/users' });
      const updateRequest = vi.fn();
      const workspace: AiToolWorkspace = {
        getCollections: () => [{ filePath: '/c.awjc', collection: createEmptyCollection('C', { items: [request] }) }],
        getActiveCollectionPath: () => '/c.awjc',
        getTabs: () => [{ id: 'tab1', collectionPath: '/c.awjc', request }],
        getActiveTabId: () => 'tab1',
        getResponse: () => null,
        getGraphqlSchema: () => null,
        getSecretValues: () => [],
        updateRequest,
        updateCollection: vi.fn(),
        addRequest: vi.fn(),
        openRequest: vi.fn().mockReturnValue(true),
        sendActiveRequest: vi.fn(),
      };
      return { workspace, updateRequest };
    };

    const startTurn = async () => {
      await waitFor(() => expect(screen.getByTestId('ai-input')).not.toBeDisabled());
      fireEvent.change(screen.getByTestId('ai-input'), { target: { value: 'change it' } });
      fireEvent.click(screen.getByTestId('ai-send-btn'));
      await waitFor(() => expect(api.aiSend).toHaveBeenCalled());
      return (api.aiSend.mock.calls[0][0] as { turnId: string; toolsEnabled: boolean });
    };

    it('lets the assistant read the workspace and shows what it did', async () => {
      const { workspace } = makeWorkspace();
      setup(true, { workspace });
      const turn = await startTurn();
      expect(turn.toolsEnabled).toBe(true);
      act(() => emit({ turnId: turn.turnId, event: { type: 'tool-call', call: { id: 'k1', name: 'get_request', arguments: {} } } }));
      await waitFor(() => expect(api.aiToolResult).toHaveBeenCalled());
      const [callId, result] = api.aiToolResult.mock.calls[0] as [string, { ok: boolean; content: string }];
      expect(callId).toBe('k1');
      expect(result.ok).toBe(true);
      expect(JSON.parse(result.content).url).toBe('{{baseUrl}}/users');
      expect(await screen.findByTestId('ai-tool-done')).toHaveTextContent('Read a request');
    });

    it('asks before applying an edit and applies it only after approval', async () => {
      const { workspace, updateRequest } = makeWorkspace();
      setup(true, { workspace });
      const turn = await startTurn();
      act(() =>
        emit({
          turnId: turn.turnId,
          event: { type: 'tool-call', call: { id: 'k2', name: 'update_request', arguments: { changes: { url: '{{baseUrl}}/v2' } } } },
        }),
      );
      const card = await screen.findByTestId('ai-approval');
      expect(card).toHaveTextContent('Edit request "Users"');
      expect(card).toHaveTextContent('Url → {{baseUrl}}/v2');
      expect(updateRequest).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId('ai-approve-btn'));
      await waitFor(() => expect(updateRequest).toHaveBeenCalledWith('req_1', expect.objectContaining({ url: '{{baseUrl}}/v2' })));
      await waitFor(() => expect(api.aiToolResult).toHaveBeenCalledWith('k2', expect.objectContaining({ ok: true })));
      expect(screen.queryByTestId('ai-approval')).not.toBeInTheDocument();
    });

    it('declining reports back to the assistant without changing anything', async () => {
      const { workspace, updateRequest } = makeWorkspace();
      setup(true, { workspace });
      const turn = await startTurn();
      act(() =>
        emit({
          turnId: turn.turnId,
          event: { type: 'tool-call', call: { id: 'k3', name: 'update_request', arguments: { changes: { name: 'Nope' } } } },
        }),
      );
      await screen.findByTestId('ai-approval');
      fireEvent.click(screen.getByTestId('ai-decline-btn'));
      await waitFor(() =>
        expect(api.aiToolResult).toHaveBeenCalledWith('k3', { ok: false, content: expect.stringContaining('declined') }),
      );
      expect(updateRequest).not.toHaveBeenCalled();
      expect(await screen.findByTestId('ai-tool-declined')).toBeInTheDocument();
    });

    it('applies edits without asking when the user enabled auto-apply', async () => {
      const { workspace, updateRequest } = makeWorkspace();
      setup(true, { workspace });
      api.aiGetSettings.mockResolvedValue({ ...createDefaultAiSettings(), autoApplyEdits: true });
      const turn = await startTurn();
      act(() =>
        emit({
          turnId: turn.turnId,
          event: { type: 'tool-call', call: { id: 'k4', name: 'update_request', arguments: { changes: { name: 'Auto' } } } },
        }),
      );
      await waitFor(() => expect(updateRequest).toHaveBeenCalled());
      expect(screen.queryByTestId('ai-approval')).not.toBeInTheDocument();
    });

    it('still asks, with a warning, before an auto-applied edit changes the request host', async () => {
      const { workspace, updateRequest } = makeWorkspace();
      setup(true, { workspace });
      api.aiGetSettings.mockResolvedValue({ ...createDefaultAiSettings(), autoApplyEdits: true });
      const turn = await startTurn();
      act(() =>
        emit({
          turnId: turn.turnId,
          event: { type: 'tool-call', call: { id: 'k5', name: 'update_request', arguments: { changes: { url: 'https://evil.test/' } } } },
        }),
      );
      expect(await screen.findByTestId('ai-approval-warning')).toHaveTextContent('different host');
      expect(updateRequest).not.toHaveBeenCalled();
    });

    it('dismisses pending approvals when the turn is cancelled', async () => {
      const { workspace } = makeWorkspace();
      setup(true, { workspace });
      const turn = await startTurn();
      act(() =>
        emit({
          turnId: turn.turnId,
          event: { type: 'tool-call', call: { id: 'k5', name: 'update_request', arguments: { changes: { name: 'X' } } } },
        }),
      );
      await screen.findByTestId('ai-approval');
      fireEvent.click(screen.getByTestId('ai-stop-btn'));
      await waitFor(() => expect(screen.queryByTestId('ai-approval')).not.toBeInTheDocument());
    });

    it('is chat-only without a workspace', async () => {
      setup(true);
      const turn = await startTurn();
      expect(turn.toolsEnabled).toBe(false);
    });
  });
});
