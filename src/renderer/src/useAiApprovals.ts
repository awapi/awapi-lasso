import { useCallback, useRef, useState } from 'react';
import type { AiApprovalRequest } from './aiToolHost';

export interface PendingApproval extends AiApprovalRequest {
  id: number;
}

export interface UseAiApprovalsResult {
  pending: PendingApproval[];
  /** Resolves true when the user approves, false when they decline or the turn ends. */
  request: (request: AiApprovalRequest) => Promise<boolean>;
  resolve: (id: number, approved: boolean) => void;
  /** Declines everything still waiting (turn cancelled or finished). */
  declineAll: () => void;
}

export function useAiApprovals(): UseAiApprovalsResult {
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const resolversRef = useRef(new Map<number, (approved: boolean) => void>());
  const counterRef = useRef(0);

  const resolve = useCallback((id: number, approved: boolean) => {
    resolversRef.current.get(id)?.(approved);
    resolversRef.current.delete(id);
    setPending(prev => prev.filter(p => p.id !== id));
  }, []);

  const request = useCallback(
    (req: AiApprovalRequest) =>
      new Promise<boolean>(resolvePromise => {
        const id = ++counterRef.current;
        resolversRef.current.set(id, resolvePromise);
        setPending(prev => [...prev, { ...req, id }]);
      }),
    [],
  );

  const declineAll = useCallback(() => {
    for (const resolver of resolversRef.current.values()) resolver(false);
    resolversRef.current.clear();
    setPending([]);
  }, []);

  return { pending, request, resolve, declineAll };
}
