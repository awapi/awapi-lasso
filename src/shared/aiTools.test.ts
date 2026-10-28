import { describe, expect, it } from 'vitest';
import { AI_TOOLS, AI_TOOL_NAMES, getAiTool } from './aiTools';

describe('AI tool definitions', () => {
  it('has unique snake_case names, descriptions, and object schemas', () => {
    const names = AI_TOOLS.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of AI_TOOLS) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.parameters.type).toBe('object');
    }
    expect(AI_TOOL_NAMES.size).toBe(AI_TOOLS.length);
  });

  it('classifies risk: reads are free, edits and sending need approval', () => {
    expect(getAiTool('get_request')?.risk).toBe('read');
    expect(getAiTool('get_response')?.risk).toBe('read');
    expect(getAiTool('get_graphql_schema')?.risk).toBe('read');
    expect(getAiTool('validate_graphql_query')?.risk).toBe('read');
    expect(getAiTool('update_request')?.risk).toBe('write');
    expect(getAiTool('update_graphql_operation')?.risk).toBe('write');
    expect(getAiTool('create_request')?.risk).toBe('write');
    expect(getAiTool('set_environment_variables')?.risk).toBe('write');
    expect(getAiTool('send_request')?.risk).toBe('run');
    expect(getAiTool('load_graphql_schema')?.risk).toBe('run');
    expect(getAiTool('nope')).toBeUndefined();
  });

  it('never offers a way to read or write auth credentials', () => {
    const update = getAiTool('update_request')!;
    const changes = (update.parameters.properties as Record<string, { properties: Record<string, unknown> }>)
      .changes;
    expect(Object.keys(changes.properties)).not.toContain('auth');
    expect(AI_TOOLS.some(t => /auth|secret_value|token/i.test(t.name))).toBe(false);
  });
});
