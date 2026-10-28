import type { AiProviderId } from '../../../shared/aiTypes';
import { streamAnthropicChat } from './anthropicProvider';
import { streamOpenAiChat, streamOpenAiCompatibleChat } from './openaiProvider';
import type { StreamChat } from './types';

export function getStreamChat(provider: AiProviderId): StreamChat {
  switch (provider) {
    case 'anthropic':
      return streamAnthropicChat;
    case 'openai-compatible':
      return streamOpenAiCompatibleChat;
    case 'openai':
    default:
      return streamOpenAiChat;
  }
}

export * from './types';
