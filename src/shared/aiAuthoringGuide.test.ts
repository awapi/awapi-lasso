import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCollectionFile } from './awjcSerializer';
import { isDynamicVariableName } from './interpolation';

const root = resolve(__dirname, '../..');
const guide = readFileSync(resolve(root, 'docs/ai-authoring-guide.md'), 'utf8');
const schemaSource = readFileSync(resolve(__dirname, 'collectionSchema.ts'), 'utf8');
const interpolationSource = readFileSync(resolve(__dirname, 'interpolation.ts'), 'utf8');

const yamlBlocks = [...guide.matchAll(/```yaml\n([\s\S]*?)```/g)].map(m => m[1]);

/** Extracts the string literals of `export type <name> = 'a' | 'b' ...;` from the schema source. */
function unionLiterals(typeName: string): string[] {
  const match = schemaSource.match(new RegExp(`export type ${typeName}\\s*=([^;]+);`));
  if (!match) throw new Error(`Type ${typeName} not found in collectionSchema.ts`);
  return [...match[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
}

describe('docs/ai-authoring-guide.md', () => {
  it('contains yaml examples', () => {
    expect(yamlBlocks.length).toBeGreaterThan(0);
  });

  it('full collection template parses with the real parser', () => {
    const full = yamlBlocks.find(b => b.startsWith('awapiLasso'));
    expect(full).toBeDefined();
    const { collection } = parseCollectionFile(full as string);
    expect(collection.items.length).toBeGreaterThan(0);
  });

  it('request recipes parse when placed in a collection', () => {
    const recipes = yamlBlocks.filter(b => b.startsWith('- kind: request'));
    expect(recipes.length).toBeGreaterThan(0);
    for (const recipe of recipes) {
      const indented = recipe
        .split('\n')
        .map(line => `  ${line}`)
        .join('\n');
      const doc = `awapiLasso: "1.0"\nkind: Collection\nmetadata: { id: a, name: b }\nitems:\n${indented}`;
      expect(() => parseCollectionFile(doc)).not.toThrow();
    }
  });

  it.each([
    'AuthType',
    'RequestBodyMode',
    'OAuth2GrantType',
    'OAuth2ClientAuthMethod',
    'AssertionOperator',
    'AssertionTarget',
    'CaptureScope',
    'CaptureSource',
    'GraphQLSchemaSourceMode',
  ])('documents every %s value from collectionSchema.ts', typeName => {
    const missing = unionLiterals(typeName).filter(value => !guide.includes(value));
    expect(missing, `Add to docs/ai-authoring-guide.md: ${missing.join(', ')}`).toEqual([]);
  });

  it('documents every built-in dynamic variable and no unknown ones', () => {
    const builtIns = [...interpolationSource.matchAll(/^\s+(\$\w+):\s*\{/gm)].map(m => m[1]);
    expect(builtIns.length).toBeGreaterThan(0);
    for (const name of builtIns) {
      expect(guide, `Missing {{${name}}}`).toContain(`{{${name}}}`);
    }
    const used = [...guide.matchAll(/\{\{(\$\w+)\}\}/g)].map(m => m[1]);
    for (const name of used) {
      expect(isDynamicVariableName(name), `Unknown built-in {{${name}}}`).toBe(true);
    }
  });
});
