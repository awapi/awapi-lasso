import type { AiProviderId } from '../../../shared/aiTypes';
import { listAnthropicModels, streamAnthropicChat } from './anthropicProvider';
import {
  listOpenAiCompatibleModels,
  listOpenAiModels,
  streamOpenAiChat,
  streamOpenAiCompatibleChat,
} from './openaiProvider';
import type { ListModels, StreamChat } from './types';

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

export function getListModels(provider: AiProviderId): ListModels {
  switch (provider) {
    case 'anthropic':
      return listAnthropicModels;
    case 'openai-compatible':
      return listOpenAiCompatibleModels;
    case 'openai':
    default:
      return listOpenAiModels;
  }
}

export * from './types';
