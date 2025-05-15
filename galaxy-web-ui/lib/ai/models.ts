export const DEFAULT_CHAT_MODEL: string = 'gpt-4o';

export interface ChatModel {
  id: string;
  name: string;
  description: string;
}

export const chatModels: Array<ChatModel> = [
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: '기본 모델',
  },
  {
    id: 'gpt-4.1-2025-04-14',
    name: 'GPT-4.1',
    description: '최신 모델',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o mini',
    description: '미니 모델',
  },
];
