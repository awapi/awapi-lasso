import * as path from 'path';
import type { BrunoSourceFile } from '../shared/brunoImporter';

export interface BrunoReaderDirEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
}

export interface BrunoReaderDeps {
  readDir: (dirPath: string) => BrunoReaderDirEntry[];
  readFile: (filePath: string) => string;
}

/** Guards against picking a huge directory (e.g. a home folder) by mistake. */
export const MAX_BRUNO_FILES = 5000;

const ALWAYS_IGNORED = new Set(['node_modules', '.git']);

/**
 * Reads `bruno.json` and every `.bru` file under `rootDir`, skipping the folders listed in the
 * collection's `ignore` setting. Returned paths are relative to `rootDir` and use `/`.
 */
export function readBrunoCollectionFolder(rootDir: string, deps: BrunoReaderDeps): BrunoSourceFile[] {
  const configPath = path.join(rootDir, 'bruno.json');
  let configContent: string;
  try {
    configContent = deps.readFile(configPath);
  } catch {
    throw new Error(`Not a Bruno collection folder: bruno.json was not found in "${rootDir}"`);
  }

  const ignored = new Set(ALWAYS_IGNORED);
  try {
    const config = JSON.parse(configContent) as { ignore?: unknown };
    if (Array.isArray(config.ignore)) {
      for (const entry of config.ignore) if (typeof entry === 'string') ignored.add(entry);
    }
  } catch {
    // Invalid JSON is reported by the importer with a clearer message.
  }

  const files: BrunoSourceFile[] = [{ path: 'bruno.json', content: configContent }];
  const walk = (relDir: string): void => {
    for (const entry of deps.readDir(path.join(rootDir, relDir))) {
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        if (!ignored.has(entry.name) && !ignored.has(relPath)) walk(relPath);
      } else if (entry.isFile && entry.name.toLowerCase().endsWith('.bru')) {
        if (files.length > MAX_BRUNO_FILES) {
          throw new Error(`"${rootDir}" has more than ${MAX_BRUNO_FILES} .bru files; pick the collection folder itself`);
        }
        files.push({ path: relPath, content: deps.readFile(path.join(rootDir, relPath)) });
      }
    }
  };
  walk('');
  return files;
}
