import { describe, expect, it } from 'vitest';
import { listAnthropicModels, streamAnthropicChat } from './anthropicProvider';
import { getListModels, getStreamChat } from './index';
import {
  listOpenAiCompatibleModels,
  listOpenAiModels,
  streamOpenAiChat,
  streamOpenAiCompatibleChat,
} from './openaiProvider';

describe('getStreamChat', () => {
  it('selects the implementation for each provider', () => {
    expect(getStreamChat('anthropic')).toBe(streamAnthropicChat);
    expect(getStreamChat('openai')).toBe(streamOpenAiChat);
    expect(getStreamChat('openai-compatible')).toBe(streamOpenAiCompatibleChat);
  });
});

describe('getListModels', () => {
  it('selects the implementation for each provider', () => {
    expect(getListModels('anthropic')).toBe(listAnthropicModels);
    expect(getListModels('openai')).toBe(listOpenAiModels);
    expect(getListModels('openai-compatible')).toBe(listOpenAiCompatibleModels);
  });
});
