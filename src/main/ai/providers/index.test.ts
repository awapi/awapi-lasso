import { describe, expect, it } from 'vitest';
import { streamAnthropicChat } from './anthropicProvider';
import { getStreamChat } from './index';
import { streamOpenAiChat, streamOpenAiCompatibleChat } from './openaiProvider';

describe('getStreamChat', () => {
  it('selects the implementation for each provider', () => {
    expect(getStreamChat('anthropic')).toBe(streamAnthropicChat);
    expect(getStreamChat('openai')).toBe(streamOpenAiChat);
    expect(getStreamChat('openai-compatible')).toBe(streamOpenAiCompatibleChat);
  });
});
