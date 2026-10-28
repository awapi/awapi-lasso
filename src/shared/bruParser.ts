/**
 * Minimal parser for Bruno's `.bru` files: a sequence of top-level `name { ... }` / `name [ ... ]`
 * blocks whose closing brace sits at column 0.
 */

export interface BruDictEntry {
  key: string;
  value: string;
  /** False when the entry is prefixed with `~`. */
  enabled: boolean;
}

export interface BruListItem {
  value: string;
  enabled: boolean;
}

export type BruBlock =
  | { kind: 'dict'; name: string; entries: BruDictEntry[] }
  | { kind: 'text'; name: string; text: string }
  | { kind: 'list'; name: string; items: BruListItem[] };

const HTTP_METHOD_BLOCKS = new Set([
  'get',
  'post',
  'put',
  'delete',
  'patch',
  'options',
  'head',
  'connect',
  'trace',
]);

const DICT_BLOCKS = new Set([
  'meta',
  'http',
  'params:query',
  'params:path',
  'query',
  'headers',
  'auth',
  'body:form-urlencoded',
  'body:multipart-form',
  'body:file',
  'vars',
  'vars:pre-request',
  'vars:post-response',
  'assert',
  'settings',
]);

export function isBruMethodBlock(name: string): boolean {
  return HTTP_METHOD_BLOCKS.has(name);
}

function isDictBlock(name: string): boolean {
  return DICT_BLOCKS.has(name) || HTTP_METHOD_BLOCKS.has(name) || name.startsWith('auth:');
}

/** Removes up to `width` leading spaces from every line. */
function dedent(lines: string[], width: number): string[] {
  const prefix = new RegExp(`^ {0,${width}}`);
  return lines.map(line => line.replace(prefix, ''));
}

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') start++;
  while (end > start && lines[end - 1].trim() === '') end--;
  return lines.slice(start, end);
}

function parseDictLines(lines: string[]): BruDictEntry[] {
  const entries: BruDictEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    let text = lines[i].trim();
    if (!text) continue;
    const enabled = !text.startsWith('~');
    if (!enabled) text = text.slice(1);

    let key: string;
    let rest: string;
    if (text.startsWith('"')) {
      // Quoted keys may contain `:`; `\"` escapes a quote.
      const close = text.search(/(?<!\\)"\s*:/);
      if (close <= 0) continue;
      key = text.slice(1, close).replace(/\\"/g, '"');
      rest = text.slice(text.indexOf(':', close) + 1);
    } else {
      const colon = text.indexOf(':');
      if (colon === -1) continue;
      key = text.slice(0, colon).trim();
      rest = text.slice(colon + 1);
    }
    let value = rest.trim();

    if (value === "'''") {
      const body: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== "'''") {
        body.push(lines[i]);
        i++;
      }
      value = dedent(body, 4).join('\n');
    }
    if (key) entries.push({ key, value, enabled });
  }
  return entries;
}

function parseListLines(lines: string[]): BruListItem[] {
  return lines
    .join('\n')
    .split(/[,\n]/)
    .map(item => item.trim())
    .filter(Boolean)
    .map(item =>
      item.startsWith('~') ? { value: item.slice(1).trim(), enabled: false } : { value: item, enabled: true },
    );
}

/** Parses a `.bru` document into its top-level blocks, in file order. */
export function parseBru(content: string): BruBlock[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const blocks: BruBlock[] = [];

  let i = 0;
  while (i < lines.length) {
    const header = /^([A-Za-z][\w:.-]*)\s*([{[])\s*([}\]])?\s*$/.exec(lines[i]);
    i++;
    if (!header) continue;
    const [, name, open, closedInline] = header;
    const closing = open === '{' ? '}' : ']';

    const body: string[] = [];
    if (!closedInline) {
      while (i < lines.length && lines[i].trimEnd() !== closing) {
        body.push(lines[i]);
        i++;
      }
      i++; // skip the closing line
    }

    if (open === '[') {
      blocks.push({ kind: 'list', name, items: parseListLines(body) });
    } else if (isDictBlock(name)) {
      blocks.push({ kind: 'dict', name, entries: parseDictLines(body) });
    } else {
      blocks.push({ kind: 'text', name, text: trimBlankEdges(dedent(body, 2)).join('\n') });
    }
  }
  return blocks;
}

/** Entries of the first dict block called `name` (empty when absent). */
export function bruDict(blocks: BruBlock[], name: string): BruDictEntry[] {
  const block = blocks.find(b => b.name === name);
  return block?.kind === 'dict' ? block.entries : [];
}

/** Value of `key` in the first dict block called `name`. */
export function bruDictValue(blocks: BruBlock[], name: string, key: string): string | undefined {
  return bruDict(blocks, name).find(e => e.key === key)?.value;
}

/** Text of the first text block called `name`. */
export function bruText(blocks: BruBlock[], name: string): string | undefined {
  const block = blocks.find(b => b.name === name);
  return block?.kind === 'text' ? block.text : undefined;
}

/** Items of the first list block called `name` (empty when absent). */
export function bruList(blocks: BruBlock[], name: string): BruListItem[] {
  const block = blocks.find(b => b.name === name);
  return block?.kind === 'list' ? block.items : [];
}
