import { describe, it, expect } from 'vitest';
import { WindowCloseGuard } from './closeGuard';

describe('WindowCloseGuard', () => {
  it('allows closing when there are no unsaved changes', () => {
    const guard = new WindowCloseGuard();
    expect(guard.handleClose()).toBe('allow');
  });

  it('prompts when there are unsaved changes and closes the window after the user proceeds', () => {
    const guard = new WindowCloseGuard();
    guard.setHasUnsavedChanges(true);
    expect(guard.handleClose()).toBe('prompt');
    expect(guard.respond(true)).toBe('close');
    expect(guard.handleClose()).toBe('allow');
  });

  it('quits the app after approval when the close was triggered by an app quit', () => {
    const guard = new WindowCloseGuard();
    guard.setHasUnsavedChanges(true);
    guard.markQuitRequested();
    expect(guard.handleClose()).toBe('prompt');
    expect(guard.respond(true)).toBe('quit');
  });

  it('keeps the window open and forgets the pending quit when the user cancels', () => {
    const guard = new WindowCloseGuard();
    guard.setHasUnsavedChanges(true);
    guard.markQuitRequested();
    expect(guard.respond(false)).toBe('none');
    expect(guard.handleClose()).toBe('prompt');
    expect(guard.respond(true)).toBe('close');
  });

  it('allows closing once the renderer reports all changes saved', () => {
    const guard = new WindowCloseGuard();
    guard.setHasUnsavedChanges(true);
    guard.setHasUnsavedChanges(false);
    expect(guard.handleClose()).toBe('allow');
  });

  it('reset clears approval and unsaved state for a new window', () => {
    const guard = new WindowCloseGuard();
    guard.setHasUnsavedChanges(true);
    guard.respond(true);
    guard.reset();
    guard.setHasUnsavedChanges(true);
    expect(guard.handleClose()).toBe('prompt');
  });
});
