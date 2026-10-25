import { app } from 'electron';
import { dirname, join } from 'path';
import * as fs from 'fs';

export const MAX_RECENT_FILES = 15;
export const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

export interface AppSettings {
  /** Custom directory where session folder is stored. null = use userData/Documents default. */
  sessionDir: string | null;
  /** Last selected theme ('dark' | 'light'). null/undefined = default dark. */
  theme?: 'dark' | 'light' | null;
  /** Whether to verify SSL/TLS certificates by default for outbound HTTP/GraphQL requests. */
  verifySsl?: boolean;
  /** Default request timeout in milliseconds. */
  defaultTimeoutMs?: number;
  /** Whether to automatically follow HTTP 3xx redirects by default. */
  followRedirects?: boolean;
  /** Maximum HTTP redirects to follow by default. */
  maxRedirects?: number;
  /** Most recently opened/saved .awjc / .awj collection file paths (newest first). */
  recentFiles?: string[];
  /** Currently open collection file paths in the sidebar workspace. */
  openCollectionPaths?: string[];
  /** Last directory used in open/import/save file dialogs. */
  lastOpenDirectory?: string | null;
}

export interface SessionTabState {
  id: string;
  title: string;
  collectionPath: string | null;
  requestId: string | null;
  isDirty?: boolean;
  draftJson?: string;
}

export interface SessionState {
  activeTabId: string | null;
  activeCollectionPath?: string | null;
  activeEnvironmentByCollection?: Record<string, string | null>;
  openCollectionPaths?: string[];
  activeConfigTab?: 'params' | 'headers' | 'auth' | 'body' | 'captures' | 'assertions';
  splitLayout?: 'vertical' | 'horizontal';
  tabs: SessionTabState[];
}

/** Lazily compute settings file path (not at module load time) */
function getSettingsFilePath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

export function loadAppSettings(): AppSettings {
  try {
    const settingsFile = getSettingsFilePath();
    if (fs.existsSync(settingsFile)) {
      const parsed = JSON.parse(fs.readFileSync(settingsFile, 'utf-8')) as Partial<AppSettings>;
      return {
        sessionDir: parsed.sessionDir ?? null,
        theme: parsed.theme ?? 'dark',
        verifySsl: parsed.verifySsl ?? true,
        defaultTimeoutMs:
          typeof parsed.defaultTimeoutMs === 'number' && parsed.defaultTimeoutMs > 0
            ? parsed.defaultTimeoutMs
            : DEFAULT_REQUEST_TIMEOUT_MS,
        followRedirects: parsed.followRedirects ?? true,
        maxRedirects:
          typeof parsed.maxRedirects === 'number' && parsed.maxRedirects >= 0
            ? parsed.maxRedirects
            : 10,
        recentFiles: Array.isArray(parsed.recentFiles) ? parsed.recentFiles : [],
        openCollectionPaths: Array.isArray(parsed.openCollectionPaths)
          ? parsed.openCollectionPaths
          : [],
        lastOpenDirectory:
          typeof parsed.lastOpenDirectory === 'string' && parsed.lastOpenDirectory.length > 0
            ? parsed.lastOpenDirectory
            : null,
      };
    }
  } catch {
    // ignore corrupt settings
  }
  return {
    sessionDir: null,
    theme: 'dark',
    verifySsl: true,
    defaultTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    followRedirects: true,
    maxRedirects: 10,
    recentFiles: [],
    openCollectionPaths: [],
    lastOpenDirectory: null,
  };
}

export function saveAppSettings(settings: Partial<AppSettings>): AppSettings {
  const current = loadAppSettings();
  const merged: AppSettings = {
    ...current,
    ...settings,
    sessionDir: settings.sessionDir !== undefined ? settings.sessionDir : current.sessionDir,
  };
  const settingsFile = getSettingsFilePath();
  const dir = join(app.getPath('userData'));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(settingsFile, JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

/** Return the list of recently opened/saved collection file paths (newest first). */
export function getRecentFiles(): string[] {
  const list = loadAppSettings().recentFiles;
  return Array.isArray(list) ? list : [];
}

/**
 * Add a collection file path to the top of the recent files list, deduplicating any
 * existing entry and capping at `MAX_RECENT_FILES`.
 */
export function addRecentFile(filePath: string): string[] {
  if (!filePath || typeof filePath !== 'string') return getRecentFiles();
  const existing = getRecentFiles().filter(p => p !== filePath);
  const updated = [filePath, ...existing].slice(0, MAX_RECENT_FILES);
  const dir = dirname(filePath);
  saveAppSettings({
    recentFiles: updated,
    ...(dir && dir !== '.' ? { lastOpenDirectory: dir } : {}),
  });
  return updated;
}

/**
 * Return the last directory used in open/import/save file dialogs, or fall back to
 * the directory of the most recent file if available.
 */
export function getLastOpenDirectory(): string | undefined {
  const settings = loadAppSettings();
  if (settings.lastOpenDirectory && fs.existsSync(settings.lastOpenDirectory)) {
    return settings.lastOpenDirectory;
  }
  if (Array.isArray(settings.recentFiles) && settings.recentFiles.length > 0) {
    const recentDir = dirname(settings.recentFiles[0]);
    if (recentDir && recentDir !== '.' && fs.existsSync(recentDir)) {
      return recentDir;
    }
  }
  return undefined;
}

/**
 * Record the directory of a newly opened, imported, or saved file path so subsequent
 * dialogs start in the same folder.
 */
export function setLastOpenDirectoryFromFile(filePath: string): string | null {
  if (!filePath || typeof filePath !== 'string') return loadAppSettings().lastOpenDirectory ?? null;
  const dir = dirname(filePath);
  if (!dir || dir === '.') return loadAppSettings().lastOpenDirectory ?? null;
  saveAppSettings({ lastOpenDirectory: dir });
  return dir;
}

/** Clear all recently opened/saved collection file paths. */
export function clearRecentFiles(): void {
  saveAppSettings({ recentFiles: [] });
}

/** Remove a single collection file path from the recent files list. */
export function removeRecentFile(filePath: string): string[] {
  const updated = getRecentFiles().filter(p => p !== filePath);
  saveAppSettings({ recentFiles: updated });
  return updated;
}

/**
 * Get the default backup/session folder location (user's Documents folder).
 */
export function getDefaultBackupDir(): string {
  return join(app.getPath('documents'), 'AwapiLasso', 'Backups');
}

export function getSessionDirPath(): string {
  const settings = loadAppSettings();
  const baseDir = settings.sessionDir || getDefaultBackupDir();
  return join(baseDir, 'session');
}

export function getSessionMetadataPath(): string {
  return join(getSessionDirPath(), 'session.json');
}

export function getUnsavedDraftsDirPath(): string {
  return join(getSessionDirPath(), 'drafts');
}

export function getUnsavedDraftPath(tabId: string): string {
  return join(getUnsavedDraftsDirPath(), `${tabId}.json`);
}

export function ensureSessionFolders(): void {
  const sessionDir = getSessionDirPath();
  const draftsDir = getUnsavedDraftsDirPath();
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
  if (!fs.existsSync(draftsDir)) fs.mkdirSync(draftsDir, { recursive: true });
}

/**
 * Save the current workspace session (open tabs, active collection/environment, and unsaved request drafts).
 */
export function saveSession(sessionData: SessionState): boolean {
  try {
    ensureSessionFolders();

    const currentTabIds = new Set<string>();
    const tabs = Array.isArray(sessionData.tabs) ? sessionData.tabs : [];

    for (const tab of tabs) {
      currentTabIds.add(tab.id);
      if (tab.draftJson && (tab.isDirty || !tab.collectionPath)) {
        fs.writeFileSync(getUnsavedDraftPath(tab.id), tab.draftJson, 'utf-8');
      }
    }

    const draftsDir = getUnsavedDraftsDirPath();
    if (fs.existsSync(draftsDir)) {
      const files = fs.readdirSync(draftsDir);
      for (const file of files) {
        const tabId = file.replace(/\.json$/, '');
        if (!currentTabIds.has(tabId)) {
          fs.unlinkSync(join(draftsDir, file));
        }
      }
    }

    const metadata: SessionState = {
      activeTabId: sessionData.activeTabId ?? null,
      activeCollectionPath: sessionData.activeCollectionPath ?? null,
      activeEnvironmentByCollection: sessionData.activeEnvironmentByCollection ?? {},
      openCollectionPaths: Array.isArray(sessionData.openCollectionPaths)
        ? sessionData.openCollectionPaths
        : [],
      ...(sessionData.activeConfigTab ? { activeConfigTab: sessionData.activeConfigTab } : {}),
      ...(sessionData.splitLayout ? { splitLayout: sessionData.splitLayout } : {}),
      tabs: tabs.map(tab => ({
        id: tab.id,
        title: tab.title,
        collectionPath: tab.collectionPath ?? null,
        requestId: tab.requestId ?? null,
        isDirty: tab.isDirty ?? false,
      })),
    };

    fs.writeFileSync(getSessionMetadataPath(), JSON.stringify(metadata, null, 2), 'utf-8');
    if (Array.isArray(sessionData.openCollectionPaths)) {
      saveAppSettings({ openCollectionPaths: sessionData.openCollectionPaths });
    }
    return true;
  } catch (error) {
    console.error('Failed to save session:', error);
    return false;
  }
}

/**
 * Load the previously saved workspace session from disk.
 */
export function loadSession(): SessionState | null {
  try {
    const metadataPath = getSessionMetadataPath();
    if (!fs.existsSync(metadataPath)) return null;

    const raw = JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as SessionState;
    const tabs: SessionTabState[] = [];

    for (const tab of raw.tabs || []) {
      const draftPath = getUnsavedDraftPath(tab.id);
      const draftJson = fs.existsSync(draftPath)
        ? fs.readFileSync(draftPath, 'utf-8')
        : undefined;
      tabs.push({
        id: tab.id,
        title: tab.title,
        collectionPath: tab.collectionPath ?? null,
        requestId: tab.requestId ?? null,
        isDirty: tab.isDirty ?? false,
        ...(draftJson !== undefined ? { draftJson } : {}),
      });
    }

    return {
      activeTabId: raw.activeTabId ?? null,
      activeCollectionPath: raw.activeCollectionPath ?? null,
      activeEnvironmentByCollection: raw.activeEnvironmentByCollection ?? {},
      openCollectionPaths: Array.isArray(raw.openCollectionPaths)
        ? raw.openCollectionPaths
        : [],
      ...(raw.activeConfigTab ? { activeConfigTab: raw.activeConfigTab } : {}),
      ...(raw.splitLayout ? { splitLayout: raw.splitLayout } : {}),
      tabs,
    };
  } catch (error) {
    console.error('Failed to load session:', error);
    return null;
  }
}
