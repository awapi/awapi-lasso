import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from './markdown';

describe('parseInline', () => {
  it('parses code, bold, italic and links, keeping plain text', () => {
    expect(parseInline('Use `GET` with **care** and *style* — see [docs](https://x.test/a).')).toEqual([
      { type: 'text', text: 'Use ' },
      { type: 'code', text: 'GET' },
      { type: 'text', text: ' with ' },
      { type: 'strong', children: [{ type: 'text', text: 'care' }] },
      { type: 'text', text: ' and ' },
      { type: 'em', children: [{ type: 'text', text: 'style' }] },
      { type: 'text', text: ' — see ' },
      { type: 'link', text: 'docs', url: 'https://x.test/a' },
      { type: 'text', text: '.' },
    ]);
  });

  it('nests emphasis and leaves snake_case, lone asterisks and code contents alone', () => {
    expect(parseInline('**bold _it_**')).toEqual([
      { type: 'strong', children: [{ type: 'text', text: 'bold ' }, { type: 'em', children: [{ type: 'text', text: 'it' }] }] },
    ]);
    expect(parseInline('user_id and api_key')).toEqual([{ type: 'text', text: 'user_id and api_key' }]);
    expect(parseInline('2 * 3 * 4')).toEqual([{ type: 'text', text: '2 * 3 * 4' }]);
    expect(parseInline('`**not bold**`')).toEqual([{ type: 'code', text: '**not bold**' }]);
  });
});

describe('parseMarkdown', () => {
  it('parses headings, paragraphs with line breaks, rules and quotes', () => {
    const blocks = parseMarkdown('## Why it failed\nThe server said\n401.\n\n---\n> note one\n> note two');
    expect(blocks.map(b => b.type)).toEqual(['heading', 'paragraph', 'rule', 'quote']);
    expect(blocks[0]).toMatchObject({ level: 2, content: [{ type: 'text', text: 'Why it failed' }] });
    expect(blocks[1]).toMatchObject({ lines: [[{ text: 'The server said' }], [{ text: '401.' }]] });
    expect(blocks[3]).toMatchObject({ lines: [[{ text: 'note one' }], [{ text: 'note two' }]] });
  });

  it('parses ordered and nested unordered lists with continuation lines', () => {
    const [ordered, unordered] = parseMarkdown('3. first\n4. second\n\n- a\n  - a.1\n    more text\n- b');
    expect(ordered).toMatchObject({ type: 'list', ordered: true, start: 3, items: [{ depth: 0 }, { depth: 0 }] });
    expect(unordered).toMatchObject({
      type: 'list',
      ordered: false,
      items: [
        { depth: 0, content: [{ text: 'a' }] },
        { depth: 1, content: [{ text: 'a.1' }, { text: ' ' }, { text: 'more text' }] },
        { depth: 0, content: [{ text: 'b' }] },
      ],
    });
  });

  it('parses tables with alignment and escaped pipes', () => {
    const [table] = parseMarkdown('| Header | Value |\n|:---|---:|\n| `Accept` | a \\| b |\n| X-Id | 1 |\n\nafter');
    expect(table).toMatchObject({
      type: 'table',
      align: ['left', 'right'],
      header: [[{ text: 'Header' }], [{ text: 'Value' }]],
      rows: [
        [[{ type: 'code', text: 'Accept' }], [{ text: 'a | b' }]],
        [[{ text: 'X-Id' }], [{ text: '1' }]],
      ],
    });
  });

  it('treats a lone pipe line without a separator as a paragraph', () => {
    expect(parseMarkdown('a | b')).toEqual([{ type: 'paragraph', lines: [[{ type: 'text', text: 'a | b' }]] }]);
    expect(parseMarkdown('')).toEqual([]);
  });
});
