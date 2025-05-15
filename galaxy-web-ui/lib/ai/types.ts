export interface ImageData {
  url: string;
  page?: string;
  relevance_score?: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: ImageData[];
}

export interface ChatResponse {
  answer: string;
  context?: string;
  images?: ImageData[];
  debug_info?: any;
} 