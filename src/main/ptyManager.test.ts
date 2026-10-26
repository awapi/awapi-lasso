import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PtyManager, buildPtyEnv, clampDimension, type PtyManagerDeps, type PtyProcess, type SpawnPty } from './ptyManager';
import type { ShellSpec } from './terminalDetection';

const ZSH: ShellSpec = { id: '/bin/zsh', label: 'zsh', detail: '/bin/zsh', file: '/bin/zsh', args: ['-l'] };

function createFakePty() {
  let dataListener: ((d: string) => void) | null = null;
  let exitListener: ((e: { exitCode: number }) => void) | null = null;
  const pty = {
    onData: vi.fn((l: (d: string) => void) => { dataListener = l; }),
    onExit: vi.fn((l: (e: { exitCode: number }) => void) => { exitListener = l; }),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
  } satisfies PtyProcess;
  return {
    pty,
    emitData: (d: string) => dataListener?.(d),
    emitExit: (exitCode: number) => exitListener?.({ exitCode }),
  };
}

function setup(overrides: Partial<PtyManagerDeps> = {}) {
  const fakes: ReturnType<typeof createFakePty>[] = [];
  const spawnPty = vi.fn<SpawnPty>(() => {
    const fake = createFakePty();
    fakes.push(fake);
    return fake.pty;
  });
  const deps: PtyManagerDeps = {
    platform: 'darwin',
    env: { PATH: '/usr/bin', ELECTRON_RUN_AS_NODE: '1' },
    loadSpawnPty: vi.fn(async () => spawnPty),
    resolveShell: () => ZSH,
    resolveCwd: target => (target ? '/project' : '/Users/me'),
    sendData: vi.fn(),
    sendExit: vi.fn(),
    flushDelayMs: 5,
    ...overrides,
  };
  return { manager: new PtyManager(deps), deps, spawnPty, fakes };
}

describe('clampDimension', () => {
  it('floors and clamps to 1..1000, with a fallback for invalid values', () => {
    expect(clampDimension(80.9, 1)).toBe(80);
    expect(clampDimension(0, 24)).toBe(1);
    expect(clampDimension(5000, 24)).toBe(1000);
    expect(clampDimension('80', 24)).toBe(24);
    expect(clampDimension(NaN, 24)).toBe(24);
  });
});

describe('buildPtyEnv', () => {
  it('sanitizes the env, advertises truecolor, and merges shell-specific vars', () => {
    expect(buildPtyEnv({ PATH: '/bin', NODE_ENV: 'x', LANG: 'fr_FR.UTF-8' }, 'darwin', { CHERE_INVOKING: '1' })).toEqual({
      PATH: '/bin',
      LANG: 'fr_FR.UTF-8',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'AwapiLasso',
      CHERE_INVOKING: '1',
    });
  });

  it('defaults LANG to UTF-8 on macOS only', () => {
    expect(buildPtyEnv({}, 'darwin').LANG).toBe('en_US.UTF-8');
    expect(buildPtyEnv({}, 'linux').LANG).toBeUndefined();
  });
});

describe('PtyManager', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('spawns the configured shell in the resolved folder', async () => {
    const { manager, spawnPty } = setup();
    const result = await manager.create(1, { cwd: '/project/a.awjc', cols: 120, rows: 30 });

    expect(result).toEqual({ ok: true, id: 1, cwd: '/project', shell: 'zsh' });
    expect(spawnPty).toHaveBeenCalledWith('/bin/zsh', ['-l'], expect.objectContaining({
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: '/project',
    }));
    const env = spawnPty.mock.calls[0][2].env;
    expect(env.PATH).toBe('/usr/bin');
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });

  it('uses the home folder and default size when no options are given', async () => {
    const { manager, spawnPty } = setup();
    expect(await manager.create(1, undefined)).toMatchObject({ ok: true, cwd: '/Users/me' });
    expect(spawnPty.mock.calls[0][2]).toMatchObject({ cols: 80, rows: 24 });
  });

  it('reports a missing shell, an unavailable node-pty, and spawn failures', async () => {
    expect(await setup({ resolveShell: () => null }).manager.create(1, {})).toMatchObject({ ok: false });
    expect(await setup({ loadSpawnPty: async () => { throw new Error('no binary'); } }).manager.create(1, {})).toEqual({
      ok: false,
      error: 'The integrated terminal is unavailable: no binary',
    });
    const failing = setup({ loadSpawnPty: async () => () => { throw new Error('posix_spawnp failed'); } });
    expect(await failing.manager.create(1, {})).toEqual({ ok: false, error: 'Could not start zsh: posix_spawnp failed' });
    expect(failing.manager.size).toBe(0);
  });

  it('coalesces output before sending it to the owning window', async () => {
    const { manager, deps, fakes } = setup();
    await manager.create(7, {});
    fakes[0].emitData('a');
    fakes[0].emitData('b');
    expect(deps.sendData).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5);
    expect(deps.sendData).toHaveBeenCalledTimes(1);
    expect(deps.sendData).toHaveBeenCalledWith(7, { id: 1, data: 'ab' });
  });

  it('flushes pending output, then reports exit and forgets the session', async () => {
    const { manager, deps, fakes } = setup();
    await manager.create(7, {});
    fakes[0].emitData('bye');
    fakes[0].emitExit(3);

    expect(deps.sendData).toHaveBeenCalledWith(7, { id: 1, data: 'bye' });
    expect(deps.sendExit).toHaveBeenCalledWith(7, { id: 1, exitCode: 3 });
    expect(manager.size).toBe(0);
  });

  it('only lets the owning window write, resize, or kill a session', async () => {
    const { manager, fakes } = setup();
    await manager.create(1, {});

    manager.write(2, 1, 'rm -rf /\r');
    manager.resize(2, 1, 10, 10);
    manager.kill(2, 1);
    expect(fakes[0].pty.write).not.toHaveBeenCalled();
    expect(fakes[0].pty.resize).not.toHaveBeenCalled();
    expect(fakes[0].pty.kill).not.toHaveBeenCalled();

    manager.write(1, 1, 'ls\r');
    manager.write(1, 1, { not: 'a string' });
    manager.resize(1, 1, 100, 40);
    expect(fakes[0].pty.write).toHaveBeenCalledTimes(1);
    expect(fakes[0].pty.write).toHaveBeenCalledWith('ls\r');
    expect(fakes[0].pty.resize).toHaveBeenCalledWith(100, 40);

    manager.kill(1, 1);
    expect(fakes[0].pty.kill).toHaveBeenCalled();
    expect(manager.size).toBe(0);
  });

  it('drops output and exit events after a session is killed', async () => {
    const { manager, deps, fakes } = setup();
    await manager.create(1, {});
    fakes[0].emitData('pending');
    manager.kill(1, 1);
    fakes[0].emitData('late');
    fakes[0].emitExit(0);
    vi.advanceTimersByTime(10);

    expect(deps.sendData).not.toHaveBeenCalled();
    expect(deps.sendExit).not.toHaveBeenCalled();
  });

  it('kills all sessions for a closed window, or all sessions on quit', async () => {
    const { manager, fakes } = setup();
    await manager.create(1, {});
    await manager.create(1, {});
    await manager.create(2, {});

    manager.killAllForOwner(1);
    expect(fakes.map(f => f.pty.kill.mock.calls.length)).toEqual([1, 1, 0]);
    expect(manager.size).toBe(1);

    manager.killAll();
    expect(fakes[2].pty.kill).toHaveBeenCalled();
    expect(manager.size).toBe(0);
  });

  it('ignores errors from resizing or killing an already-exited process', async () => {
    const { manager, fakes } = setup();
    await manager.create(1, {});
    fakes[0].pty.resize.mockImplementation(() => { throw new Error('exited'); });
    fakes[0].pty.kill.mockImplementation(() => { throw new Error('exited'); });

    expect(() => manager.resize(1, 1, 10, 10)).not.toThrow();
    expect(() => manager.kill(1, 1)).not.toThrow();
  });
});
