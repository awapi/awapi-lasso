import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { AiTurnEvent } from '../../shared/aiTypes';
import { toApiMessages, useAiChat } from './useAiChat';

describe('toApiMessages', () => {
  it('drops errored and empty messages', () => {
    expect(
      toApiMessages([
        { id: '1', role: 'user', content: 'hi' },
        { id: '2', role: 'assistant', content: 'oops', error: true },
        { id: '3', role: 'assistant', content: '  ' },
        { id: '4', role: 'assistant', content: 'ok' },
      ]),
    ).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'ok' },
    ]);
  });
});

describe('useAiChat', () => {
  let emit: (e: AiTurnEvent) => void;
  let aiSend: ReturnType<typeof vi.fn>;
  let aiCancel: ReturnType<typeof vi.fn>;
  let aiToolResult: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    aiSend = vi.fn().mockResolvedValue({ started: true });
    aiCancel = vi.fn().mockResolvedValue(true);
    aiToolResult = vi.fn().mockResolvedValue(true);
    window.electronAPI = {
      aiSend,
      aiCancel,
      aiToolResult,
      onAiEvent: vi.fn((cb: (e: AiTurnEvent) => void) => {
        emit = cb;
        return () => {};
      }),
    } as unknown as Window['electronAPI'];
  });

  const lastTurnId = () => (aiSend.mock.calls.at(-1)![0] as { turnId: string }).turnId;

  it('sends history with fresh context and streams the reply', async () => {
    const getContext = vi.fn(() => ({ secretValues: [] as string[] }));
    const { result } = renderHook(() => useAiChat({ getContext }));

    await act(async () => {
      await result.current.send('  why 500?  ');
    });
    expect(result.current.isStreaming).toBe(true);
    expect(aiSend).toHaveBeenCalledWith({
      turnId: expect.any(String),
      messages: [{ role: 'user', content: 'why 500?' }],
      context: { secretValues: [] },
      toolsEnabled: false,
    });

    act(() => {
      emit({ turnId: lastTurnId(), event: { type: 'text-delta', text: 'Because ' } });
      emit({ turnId: lastTurnId(), event: { type: 'text-delta', text: 'bug' } });
      emit({ turnId: lastTurnId(), event: { type: 'done', stopReason: 'stop' } });
    });
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.messages.map(m => m.content)).toEqual(['why 500?', 'Because bug']);

    await act(async () => {
      await result.current.send('more');
    });
    expect((aiSend.mock.calls.at(-1)![0] as { messages: unknown[] }).messages).toEqual([
      { role: 'user', content: 'why 500?' },
      { role: 'assistant', content: 'Because bug' },
      { role: 'user', content: 'more' },
    ]);
  });

  it('ignores events from other turns and blocks concurrent sends', async () => {
    const { result } = renderHook(() => useAiChat({ getContext: () => undefined }));
    await act(async () => {
      await result.current.send('a');
    });
    act(() => emit({ turnId: 'other', event: { type: 'text-delta', text: 'zzz' } }));
    expect(result.current.messages[1].content).toBe('');
    await act(async () => {
      await result.current.send('b');
    });
    expect(aiSend).toHaveBeenCalledTimes(1);
  });

  it('shows provider errors on the assistant message and allows sending again', async () => {
    const { result } = renderHook(() => useAiChat({ getContext: () => undefined }));
    await act(async () => {
      await result.current.send('a');
    });
    act(() => emit({ turnId: lastTurnId(), event: { type: 'error', message: 'No API key' } }));
    expect(result.current.messages[1]).toMatchObject({ content: 'No API key', error: true });
    expect(result.current.isStreaming).toBe(false);
    await act(async () => {
      await result.current.send('b');
    });
    expect((aiSend.mock.calls.at(-1)![0] as { messages: unknown[] }).messages).toEqual([
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
    ]);
  });

  it('handles cancellation and send failures', async () => {
    const { result } = renderHook(() => useAiChat({ getContext: () => undefined }));
    await act(async () => {
      await result.current.send('a');
    });
    const turnId = lastTurnId();
    act(() => result.current.stop());
    expect(aiCancel).toHaveBeenCalledWith(turnId);
    act(() => emit({ turnId, event: { type: 'done', stopReason: 'cancelled' } }));
    expect(result.current.messages[1].cancelled).toBe(true);

    aiSend.mockRejectedValueOnce(new Error('ipc down'));
    await act(async () => {
      await result.current.send('b');
    });
    await waitFor(() => expect(result.current.messages[3]).toMatchObject({ content: 'ipc down', error: true }));
    expect(result.current.isStreaming).toBe(false);
  });

  it('clear cancels an active turn and resets the conversation', async () => {
    const { result } = renderHook(() => useAiChat({ getContext: () => undefined }));
    await act(async () => {
      await result.current.send('a');
    });
    const turnId = lastTurnId();
    act(() => result.current.clear());
    expect(aiCancel).toHaveBeenCalledWith(turnId);
    expect(result.current.messages).toEqual([]);
    expect(result.current.isStreaming).toBe(false);
  });

  describe('workspace tools', () => {
    const toolEvent = (turnId: string, id: string, name = 'get_request'): AiTurnEvent => ({
      turnId,
      event: { type: 'tool-call', call: { id, name, arguments: {} } },
    });

    it('enables tools, executes tool calls, shows activity, and replies with the result', async () => {
      const executeTool = vi.fn().mockResolvedValue({ ok: true, content: '{"a":1}' });
      const { result } = renderHook(() => useAiChat({ getContext: () => undefined, executeTool }));
      await act(async () => {
        await result.current.send('look');
      });
      expect((aiSend.mock.calls[0][0] as { toolsEnabled: boolean }).toolsEnabled).toBe(true);

      await act(async () => {
        emit(toolEvent(lastTurnId(), 't::c1'));
      });
      await waitFor(() => expect(aiToolResult).toHaveBeenCalledWith('t::c1', { ok: true, content: '{"a":1}' }));
      expect(executeTool).toHaveBeenCalledWith({ id: 't::c1', name: 'get_request', arguments: {} });
      expect(result.current.messages[1].tools).toEqual([{ id: 't::c1', name: 'get_request', status: 'done' }]);
    });

    it('marks failed and declined tools and survives executor exceptions', async () => {
      const executeTool = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, content: 'The user declined this action.' })
        .mockResolvedValueOnce({ ok: false, content: 'No request' })
        .mockRejectedValueOnce(new Error('kaboom'));
      const { result } = renderHook(() => useAiChat({ getContext: () => undefined, executeTool }));
      await act(async () => {
        await result.current.send('x');
      });
      for (const id of ['t::a', 't::b', 't::c']) {
        await act(async () => {
          emit(toolEvent(lastTurnId(), id));
        });
      }
      await waitFor(() => expect(aiToolResult).toHaveBeenCalledTimes(3));
      expect(result.current.messages[1].tools?.map(t => t.status)).toEqual(['declined', 'error', 'error']);
      expect(aiToolResult).toHaveBeenLastCalledWith('t::c', { ok: false, content: 'Tool failed: kaboom' });
    });

    it('reports tools unavailable without an executor', async () => {
      const { result } = renderHook(() => useAiChat({ getContext: () => undefined }));
      await act(async () => {
        await result.current.send('x');
      });
      await act(async () => {
        emit(toolEvent(lastTurnId(), 't::z'));
      });
      await waitFor(() =>
        expect(aiToolResult).toHaveBeenCalledWith('t::z', { ok: false, content: expect.stringContaining('not available') }),
      );
    });

    it('notifies onTurnEnd on completion, stop, error, and clear', async () => {
      const onTurnEnd = vi.fn();
      const { result } = renderHook(() => useAiChat({ getContext: () => undefined, onTurnEnd }));
      await act(async () => {
        await result.current.send('x');
      });
      act(() => emit({ turnId: lastTurnId(), event: { type: 'done' } }));
      expect(onTurnEnd).toHaveBeenCalledTimes(1);
      await act(async () => {
        await result.current.send('y');
      });
      act(() => result.current.stop());
      expect(onTurnEnd).toHaveBeenCalledTimes(2);
      act(() => emit({ turnId: lastTurnId(), event: { type: 'error', message: 'bad' } }));
      expect(onTurnEnd).toHaveBeenCalledTimes(3);
      act(() => result.current.clear());
      expect(onTurnEnd).toHaveBeenCalledTimes(4);
    });
  });
});
