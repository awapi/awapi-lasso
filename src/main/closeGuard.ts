/**
 * Tracks whether the renderer has unsaved collection changes and decides whether a
 * main-window `close` event may proceed or must first prompt the user (Save / Don't Save / Cancel).
 * Kept free of Electron imports so it can be unit tested directly.
 */
export type CloseDecision = 'allow' | 'prompt';
export type CloseResponseAction = 'quit' | 'close' | 'none';

export class WindowCloseGuard {
  private hasUnsavedChanges = false;
  private closeApproved = false;
  private quitRequested = false;

  /** Resets state for a freshly created window. */
  reset(): void {
    this.hasUnsavedChanges = false;
    this.closeApproved = false;
    this.quitRequested = false;
  }

  setHasUnsavedChanges(value: boolean): void {
    this.hasUnsavedChanges = value;
  }

  /** Called from `app.on('before-quit')` so an approved close continues quitting the app (macOS Cmd+Q). */
  markQuitRequested(): void {
    this.quitRequested = true;
  }

  /** Called from the window `close` event. When `prompt`, the caller must `preventDefault()` and ask the renderer. */
  handleClose(): CloseDecision {
    if (this.closeApproved || !this.hasUnsavedChanges) {
      return 'allow';
    }
    return 'prompt';
  }

  /** Applies the renderer's answer to a close prompt and returns what the main process should do next. */
  respond(proceed: boolean): CloseResponseAction {
    if (!proceed) {
      this.quitRequested = false;
      return 'none';
    }
    this.closeApproved = true;
    return this.quitRequested ? 'quit' : 'close';
  }
}
