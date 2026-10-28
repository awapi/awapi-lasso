/**
 * A small, dependency-free Markdown subset for assistant answers. It produces a plain tree that is rendered
 * as React elements (never as HTML strings), so model output cannot inject markup. Fenced code blocks are
 * split out earlier by `parseMessageBlocks`; this handles the prose between them.
 */

export type MdInline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong'; children: MdInline[] }
  | { type: 'em'; children: MdInline[] }
  | { type: 'link'; text: string; url: string };

export type MdAlign = 'left' | 'center' | 'right' | null;

export type MdBlock =
  | { type: 'heading'; level: number; content: MdInline[] }
  | { type: 'paragraph'; lines: MdInline[][] }
  | { type: 'list'; ordered: boolean; start: number; items: Array<{ depth: number; content: MdInline[] }> }
  | { type: 'quote'; lines: MdInline[][] }
  | { type: 'table'; header: MdInline[][]; align: MdAlign[]; rows: MdInline[][][] }
  | { type: 'rule' };

const INLINE_PATTERN =
  /`([^`]+)`|\*\*(?=\S)(.+?)\*\*|__(?=\S)(.+?)__|\*(?=[^\s*])(.+?)\*|(?<![\w])_(?=[^\s_])(.+?)_(?![\w])|\[([^\]]+)\]\(([^)\s]+)\)/;

export function parseInline(text: string): MdInline[] {
  const out: MdInline[] = [];
  let rest = text;
  while (rest.length > 0) {
    const match = INLINE_PATTERN.exec(rest);
    if (!match) {
      out.push({ type: 'text', text: rest });
      break;
    }
    if (match.index > 0) out.push({ type: 'text', text: rest.slice(0, match.index) });
    const [, code, strongA, strongB, emA, emB, linkText, linkUrl] = match;
    if (code !== undefined) out.push({ type: 'code', text: code });
    else if (strongA !== undefined || strongB !== undefined) {
      out.push({ type: 'strong', children: parseInline(strongA ?? strongB) });
    } else if (emA !== undefined || emB !== undefined) {
      out.push({ type: 'em', children: parseInline(emA ?? emB) });
    } else out.push({ type: 'link', text: linkText, url: linkUrl });
    rest = rest.slice(match.index + match[0].length);
  }
  return out;
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|(\d{1,9})[.)])\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'));
}

function alignOf(cell: string): MdAlign {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  return left ? 'left' : null;
}

export function parseMarkdown(text: string): MdBlock[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: MdBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', lines: paragraph.map(parseInline) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') {
      flushParagraph();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ type: 'heading', level: heading[1].length, content: parseInline(heading[2]) });
      continue;
    }

    if (RULE.test(line)) {
      flushParagraph();
      blocks.push({ type: 'rule' });
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      flushParagraph();
      const header = splitRow(line);
      const align = splitRow(lines[i + 1]).map(alignOf);
      const rows: MdInline[][][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitRow(lines[i]).map(parseInline));
        i += 1;
      }
      i -= 1;
      blocks.push({ type: 'table', header: header.map(parseInline), align, rows });
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item) {
      flushParagraph();
      const ordered = item[3] !== undefined;
      const list: Extract<MdBlock, { type: 'list' }> = {
        type: 'list',
        ordered,
        start: ordered ? Number(item[3]) : 1,
        items: [],
      };
      const baseIndent = item[1].length;
      while (i < lines.length) {
        const current = LIST_ITEM.exec(lines[i]);
        if (current) {
          const depth = Math.max(0, Math.floor((current[1].length - baseIndent) / 2));
          list.items.push({ depth, content: parseInline(current[4]) });
        } else if (lines[i].trim() !== '' && /^\s+/.test(lines[i]) && list.items.length > 0) {
          // Indented continuation line of the previous item.
          const last = list.items[list.items.length - 1];
          last.content = [...last.content, { type: 'text', text: ' ' }, ...parseInline(lines[i].trim())];
        } else {
          break;
        }
        i += 1;
      }
      i -= 1;
      blocks.push(list);
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      flushParagraph();
      const quoted: MdInline[][] = [];
      while (i < lines.length) {
        const current = QUOTE.exec(lines[i]);
        if (!current) break;
        quoted.push(parseInline(current[1]));
        i += 1;
      }
      i -= 1;
      blocks.push({ type: 'quote', lines: quoted });
      continue;
    }

    paragraph.push(line.trim());
  }
  flushParagraph();
  return blocks;
}
