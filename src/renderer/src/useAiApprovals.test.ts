import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAiApprovals } from './useAiApprovals';

const info = { tool: 'update_request', risk: 'write' as const, title: 'Edit', lines: ['URL → x'] };

describe('useAiApprovals', () => {
  it('queues requests and resolves them with the user decision', async () => {
    const { result } = renderHook(() => useAiApprovals());
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = result.current.request(info);
      second = result.current.request({ ...info, title: 'Other' });
    });
    expect(result.current.pending.map(p => p.title)).toEqual(['Edit', 'Other']);

    act(() => result.current.resolve(result.current.pending[0].id, true));
    await expect(first).resolves.toBe(true);
    expect(result.current.pending).toHaveLength(1);

    act(() => result.current.resolve(result.current.pending[0].id, false));
    await expect(second).resolves.toBe(false);
    expect(result.current.pending).toHaveLength(0);
  });

  it('declines everything still pending', async () => {
    const { result } = renderHook(() => useAiApprovals());
    let a!: Promise<boolean>;
    let b!: Promise<boolean>;
    act(() => {
      a = result.current.request(info);
      b = result.current.request(info);
    });
    act(() => result.current.declineAll());
    await expect(Promise.all([a, b])).resolves.toEqual([false, false]);
    expect(result.current.pending).toEqual([]);
  });

  it('ignores resolving unknown ids', () => {
    const { result } = renderHook(() => useAiApprovals());
    expect(() => act(() => result.current.resolve(999, true))).not.toThrow();
  });
});
