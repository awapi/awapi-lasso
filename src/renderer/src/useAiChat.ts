import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AiChatContext,
  AiChatMessage,
  AiToolCall,
  AiToolResult,
  AiTurnEvent,
} from '../../shared/aiTypes';

export type ToolActivityStatus = 'running' | 'done' | 'error' | 'declined';

export interface ToolActivity {
  id: string;
  name: string;
  status: ToolActivityStatus;
}

export interface UiChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Set on assistant messages that ended with a provider/transport error. */
  error?: boolean;
  cancelled?: boolean;
  /** Workspace tools the assistant used while producing this message. */
  tools?: ToolActivity[];
}

export interface UseAiChatOptions {
  /** Called at send time so the assistant sees the currently active request/response. */
  getContext: () => AiChatContext | undefined;
  /** Runs a workspace tool for the assistant. When omitted the assistant is chat-only. */
  executeTool?: (call: AiToolCall) => Promise<AiToolResult>;
  /** Called when a turn ends (done, error, cancel) so pending approvals can be dismissed. */
  onTurnEnd?: () => void;
}

export interface UseAiChatResult {
  messages: UiChatMessage[];
  isStreaming: boolean;
  send: (text: string) => Promise<void>;
  stop: () => void;
  clear: () => void;
}

let messageCounter = 0;
const nextId = (prefix: string): string => `${prefix}_${Date.now().toString(36)}_${++messageCounter}`;

export function toApiMessages(messages: UiChatMessage[]): AiChatMessage[] {
  return messages
    .filter(m => !m.error && m.content.trim() !== '')
    .map(m => ({ role: m.role, content: m.content }));
}

export function useAiChat({ getContext, executeTool, onTurnEnd }: UseAiChatOptions): UseAiChatResult {
  const [messages, setMessages] = useState<UiChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const activeTurnRef = useRef<string | null>(null);
  const assistantIdRef = useRef<string | null>(null);
  const messagesRef = useRef<UiChatMessage[]>([]);
  messagesRef.current = messages;
  const executeToolRef = useRef(executeTool);
  executeToolRef.current = executeTool;
  const onTurnEndRef = useRef(onTurnEnd);
  onTurnEndRef.current = onTurnEnd;

  const patchAssistant = useCallback((assistantId: string | null, patch: (m: UiChatMessage) => UiChatMessage) => {
    setMessages(prev => prev.map(m => (m.id === assistantId ? patch(m) : m)));
  }, []);

  const endTurn = useCallback(() => {
    activeTurnRef.current = null;
    assistantIdRef.current = null;
    setIsStreaming(false);
    onTurnEndRef.current?.();
  }, []);

  useEffect(() => {
    const runTool = async (turnId: string, assistantId: string | null, call: AiToolCall) => {
      const api = window.electronAPI;
      const setStatus = (status: ToolActivityStatus) =>
        patchAssistant(assistantId, m => ({
          ...m,
          tools: (m.tools ?? []).map(t => (t.id === call.id ? { ...t, status } : t)),
        }));
      let result: AiToolResult;
      try {
        const execute = executeToolRef.current;
        result = execute
          ? await execute(call)
          : { ok: false, content: 'Workspace tools are not available.' };
      } catch (error) {
        result = { ok: false, content: `Tool failed: ${error instanceof Error ? error.message : String(error)}` };
      }
      // The turn may have ended (cancelled) while the tool ran; its status chip is still updated.
      setStatus(result.ok ? 'done' : /declined/i.test(result.content) ? 'declined' : 'error');
      if (activeTurnRef.current === turnId) await api?.aiToolResult?.(call.id, result);
    };

    const unsubscribe = window.electronAPI?.onAiEvent?.((turnEvent: AiTurnEvent) => {
      if (turnEvent.turnId !== activeTurnRef.current) return;
      const assistantId = assistantIdRef.current;
      const { event } = turnEvent;
      if (event.type === 'text-delta') {
        patchAssistant(assistantId, m => ({ ...m, content: m.content + event.text }));
        return;
      }
      if (event.type === 'tool-call') {
        patchAssistant(assistantId, m => ({
          ...m,
          tools: [...(m.tools ?? []), { id: event.call.id, name: event.call.name, status: 'running' }],
        }));
        void runTool(turnEvent.turnId, assistantId, event.call);
        return;
      }
      if (event.type === 'error') {
        patchAssistant(assistantId, m => ({ ...m, content: event.message, error: true }));
      } else if (event.stopReason === 'cancelled') {
        patchAssistant(assistantId, m => ({ ...m, cancelled: true }));
      }
      endTurn();
    });
    return () => unsubscribe?.();
  }, [patchAssistant, endTurn]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      const api = window.electronAPI;
      if (!trimmed || activeTurnRef.current || !api?.aiSend) return;

      const userMessage: UiChatMessage = { id: nextId('msg'), role: 'user', content: trimmed };
      const assistantMessage: UiChatMessage = { id: nextId('msg'), role: 'assistant', content: '' };
      const turnId = nextId('turn');
      const history = toApiMessages([...messagesRef.current, userMessage]);

      activeTurnRef.current = turnId;
      assistantIdRef.current = assistantMessage.id;
      setMessages(prev => [...prev, userMessage, assistantMessage]);
      setIsStreaming(true);

      try {
        const result = await api.aiSend({
          turnId,
          messages: history,
          context: getContext(),
          toolsEnabled: Boolean(executeToolRef.current),
        });
        if (!result.started) throw new Error('The assistant could not start this request.');
      } catch (error) {
        if (activeTurnRef.current === turnId) {
          const message = error instanceof Error ? error.message : String(error);
          patchAssistant(assistantMessage.id, m => ({ ...m, content: message, error: true }));
          endTurn();
        }
      }
    },
    [getContext, patchAssistant, endTurn],
  );

  const stop = useCallback(() => {
    const turnId = activeTurnRef.current;
    if (turnId) void window.electronAPI?.aiCancel?.(turnId);
    onTurnEndRef.current?.();
  }, []);

  const clear = useCallback(() => {
    const turnId = activeTurnRef.current;
    if (turnId) void window.electronAPI?.aiCancel?.(turnId);
    activeTurnRef.current = null;
    assistantIdRef.current = null;
    setIsStreaming(false);
    setMessages([]);
    onTurnEndRef.current?.();
  }, []);

  return { messages, isStreaming, send, stop, clear };
}
