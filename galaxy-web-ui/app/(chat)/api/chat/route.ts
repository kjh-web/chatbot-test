import {
  createDataStreamResponse,
  smoothStream,
  streamText,
} from 'ai';
import { generateUUID } from '@/lib/utils';
import { createClient } from '@supabase/supabase-js';
import { CohereEmbeddings } from "@langchain/cohere";
import { Document } from "@langchain/core/documents";
import { SupabaseVectorStore } from "@langchain/community/vectorstores/supabase";
import { OpenAI } from 'openai';
import { myProvider } from '@/lib/ai/providers';
import { isProductionEnvironment, API_BASE_URL } from '@/lib/constants';
import { getProxyImageUrl, extractImagesFromText, type ImageData } from '@/lib/ai';
import { auth } from '@/app/(auth)/auth';

// 렌더 백엔드 서버 URL
const RENDER_BACKEND_URL = 'https://galaxy-rag-chatbot.onrender.com';

// 환경 변수 설정
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const COHERE_API_KEY = process.env.COHERE_API_KEY || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Supabase 클라이언트 설정
const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// 임베딩 모델 설정
const cohere_embeddings = new CohereEmbeddings({
  model: "embed-v4.0",
  apiKey: COHERE_API_KEY
});

// OpenAI 설정
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY
});

// 벡터 스토어 설정
const text_vectorstore = new SupabaseVectorStore(
  cohere_embeddings,
  {
    client,
    tableName: "text_embeddings",
    queryName: "match_text_embeddings"
  }
);

// 이미지 캐시 (성능 최적화)
let cachedImages: string[] = [];
let lastCacheTime = 0;

// Supabase에서 이미지 목록 가져오기
async function getAvailableImages() {
  try {
    // 캐시가 5분 이내에 갱신됐으면 캐시 사용
    const now = Date.now();
    if (cachedImages.length > 0 && now - lastCacheTime < 5 * 60 * 1000) {
      return cachedImages;
    }
    
    // Supabase Storage에서 이미지 목록 가져오기
    const { data, error } = await client
      .storage
      .from('images')
      .list();
    
    if (error) {
      console.error('이미지 목록 가져오기 오류:', error);
      return [];
    }
    
    // 이미지 파일만 필터링
    const imageFiles = data
      .filter((item: any) => !item.id.endsWith('/') && 
             (item.name.endsWith('.jpg') || 
              item.name.endsWith('.jpeg') || 
              item.name.endsWith('.png')))
      .map((item: any) => item.name);
    
    console.log(`Supabase에서 ${imageFiles.length}개 이미지 목록 로드됨`);
    
    // 캐시 업데이트
    cachedImages = imageFiles;
    lastCacheTime = now;
    
    return imageFiles;
  } catch (error) {
    console.error('이미지 목록 가져오기 중 오류:', error);
    return [];
  }
}

// API 응답에서 이미지 URL을 정규화하는 함수
function normalizeImageUrls(content: string): string {
  // 디버그 로그
  console.log('이미지 URL 정규화 처리 시작');
  console.log('원본 응답 일부:', content.substring(0, 200));
  
  // 이미지 패턴 감지
  const hasImagePattern = content.includes('[이미지');
  const hasSupabaseUrl = content.includes('ywvoksfszaelkceectaa.supabase.co');
  
  console.log('응답에 [이미지] 패턴 포함:', hasImagePattern);
  console.log('응답에 Supabase URL 포함:', hasSupabaseUrl);
  
  if (hasImagePattern) {
    const matches = content.match(/\[이미지[^\n]*\n[^\n]+/g);
    if (matches) {
      console.log('발견된 이미지 패턴 수:', matches.length);
      console.log('발견된 이미지 패턴:', matches);
    }
  }

  // URL에서 이중 슬래시를 단일 슬래시로 변환 (프로토콜 다음의 이중 슬래시는 제외)
  const result = content.replace(/([^:])\/\/+/g, '$1/');
  
  // 정규화 후 변화가 있는지 확인
  const isChanged = result !== content;
  console.log('URL 정규화 후 변경 발생:', isChanged);
  
  return result;
}

// 갤럭시 챗봇 검색 기능 구현
async function searchDocuments(query: string) {
  try {
    // 검색 쿼리 정규화
    const normalized_query = query.trim().replace(/[.!?]$/, '');
    
    try {
      // 쿼리 임베딩 생성
      const queryEmbedding = await cohere_embeddings.embedQuery(normalized_query);
      
      // 텍스트 검색 수행 - SQL 함수를 직접 호출하는 방식으로 변경
      try {
        const { data: vectorResults, error } = await client.rpc(
          'match_text_embeddings', 
          { 
            query_embedding: queryEmbedding,
            match_threshold: 0.5,
            match_count: 5
          }
        );
        
        if (error) throw error;
        
        if (!vectorResults || vectorResults.length === 0) {
          return "매뉴얼에서 관련 정보를 찾을 수 없습니다.";
        }
        
        // 검색 결과를 Document 형식으로 변환
        const searchResults = vectorResults.map((item: { 
          id: string; 
          content: string; 
          metadata: any; 
          similarity: number;
        }) => {
          const doc = new Document({
            pageContent: item.content,
            metadata: item.metadata || {}
          });
          return [doc, item.similarity];
        });
        
        // 검색 결과 형식화
        let result_text = "";
        const reference_pages: string[] = [];
        
        for (const [doc, score] of searchResults) {
          result_text += `내용: ${doc.pageContent}\n`;
          if (doc.metadata?.category) {
            result_text += `카테고리: ${doc.metadata.category || '없음'}\n`;
          }
          if (doc.metadata?.page) {
            result_text += `페이지: ${doc.metadata.page || '없음'}\n`;
            
            // 참조 페이지 수집
            if (doc.metadata.page && !reference_pages.includes(doc.metadata.page)) {
              reference_pages.push(doc.metadata.page);
            }
          }
          result_text += "\n";
        }
        
        // 참조 페이지 정보 추가
        if (reference_pages.length > 0) {
          reference_pages.sort();
          result_text += "\n\n💡 추가 정보가 필요하면 매뉴얼의 관련 섹션을 참고해보세요.";
        }
        
        return result_text;
      } catch (rpcError) {
        console.error("RPC 호출 오류:", rpcError);
        throw rpcError;
      }
      
    } catch (vectorError) {
      console.error("벡터 검색 오류:", vectorError);
      
      // 벡터 검색 실패 시 기본 응답 제공
      return `
"갤럭시 S25 사용 관련 정보가 필요하시면 질문해 주세요. 현재 벡터 검색에 일시적인 문제가 있지만, 일반적인 질문에 대해서는 답변해 드릴 수 있습니다."

기기에 대한 기본 정보:
- 갤럭시 S25는 삼성전자의 최신 스마트폰입니다.
- 강력한 성능과 혁신적인 카메라 시스템을 갖추고 있습니다.
- AI 기능이 향상되어 사용자 경험을 개선했습니다.
      `;
    }
  } catch (error: any) {
    console.error("검색 중 오류 발생:", error);
    return `검색 중 오류가 발생했습니다: ${error.message}`;
  }
}

// 게스트 사용자 생성 또는 가져오기
async function getOrCreateGuestUser() {
  try {
    // 게스트 이메일 생성
    const guestEmail = `guest_${generateUUID()}@example.com`;
    
    // 사용자 저장
    const { data: user, error } = await client
      .from('users')
      .insert([{ email: guestEmail }])
      .select('id')
      .single();
    
    if (error) {
      // 오류 발생 시 고정 게스트 ID 반환 (임시 방편)
      console.error('게스트 사용자 생성 오류:', error);
      return "00000000-0000-0000-0000-000000000000";
    }
    
    return user.id;
  } catch (error) {
    console.error('게스트 사용자 생성 오류:', error);
    // 항상 유효한 UUID 반환
    return "00000000-0000-0000-0000-000000000000";
  }
}

// 사용자 ID 가져오기 (인증된 사용자 또는 게스트)
async function getUserId() {
  try {
    // 세션에서 사용자 정보 가져오기
    const session = await auth();
    
    if (session?.user?.id) {
      // 인증된 사용자인 경우 세션 ID 사용
      console.log('[인증] 세션에서 사용자 ID 가져옴:', session.user.id);
      return session.user.id;
    } else {
      // 인증되지 않은 사용자인 경우 게스트 ID 생성
      const guestId = await getOrCreateGuestUser();
      console.log('[게스트] 게스트 사용자 ID 생성:', guestId);
      return guestId;
    }
  } catch (error) {
    console.error('사용자 ID 가져오기 오류:', error);
    return getOrCreateGuestUser(); // 오류 발생 시 게스트 ID 사용
  }
}

// 채팅 저장
async function saveChat(userId: string, title: string, customId?: string) {
  try {
    // 채팅 ID 결정 (제공된 ID 또는 새 UUID)
    const chatId = customId || generateUUID();
    
    const { data: chat, error } = await client
      .from('chats')
      .insert([
        {
          id: chatId, // 제공된 ID 사용 또는 새 UUID 사용
          user_id: userId,
          title: title,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          visibility: 'private'
        }])
      .select('id')
      .single();
    
    if (error) {
      console.error('채팅 저장 오류:', error);
      return null;
    }
    
    return chat.id;
  } catch (error) {
    console.error('채팅 저장 오류:', error);
    return null;
  }
}

// 메시지 저장
async function saveMessage(chatId: string, role: string, content: string) {
  try {
    // content 형식 로깅 및 검증 강화
    console.log(`메시지 저장 시도 - 역할: ${role}, 내용 타입: ${typeof content}`);
    
    // 객체 또는 배열 형태 검증
    let safeContent: string;
    let contentIsJsonStr = false;
    
    // JSON 문자열인지 확인 (배열 또는 객체 형태의 문자열)
    if (typeof content === 'string') {
      if ((content.startsWith('[') && content.endsWith(']')) || 
          (content.startsWith('{') && content.endsWith('}'))) {
        try {
          // 유효한 JSON인지 파싱해서 확인
          JSON.parse(content);
          safeContent = content; // 이미 JSON 문자열이면 그대로 사용
          contentIsJsonStr = true;
          console.log('이미 JSON 문자열 형식입니다. 변환 없이 사용합니다.');
        } catch (e) {
          // 유효한 JSON이 아니면 일반 문자열로 처리
          safeContent = content;
          console.log('JSON 형식처럼 보이지만 파싱 불가능한 일반 문자열입니다.');
        }
      } else if (content === '[object Object]') {
        console.log('경고: [object Object] 문자열이 직접 전달됨');
        // 이미 문자열화된 [object Object]가 전달된 경우 빈 객체로 대체
        safeContent = '{}';
      } else {
        // 일반 문자열
        safeContent = content;
      }
    } else {
      // 문자열이 아닌 경우 JSON으로 변환
      console.log('문자열이 아닌 내용이 전달됨:', content);
      safeContent = JSON.stringify(content);
      console.log('문자열로 변환 후:', safeContent);
    }
    
    // parts 필드 구성 - JSON 문자열이면 파싱하여 사용, 아니면 text 타입으로 구성
    let parts;
    if (contentIsJsonStr) {
      try {
        // 이미 JSON 문자열인 경우, 그대로 파싱하여 사용
        parts = JSON.parse(safeContent);
        console.log('기존 JSON parts 구조 사용:', parts);
      } catch (e) {
        // 파싱에 실패한 경우 기본 구조 사용
        parts = [{ type: 'text', text: safeContent }];
        console.log('JSON 파싱 실패, 기본 parts 구조 사용');
      }
    } else {
      // 일반 문자열인 경우 기본 text 타입으로 구성
      parts = [{ type: 'text', text: safeContent }];
    }
    
    // 디버그를 위한 최종 데이터 구조 로깅
    console.log('최종 저장 데이터 구조:');
    console.log('- content:', typeof safeContent, safeContent.length > 100 ? safeContent.substring(0, 100) + '...' : safeContent);
    console.log('- parts:', typeof parts, Array.isArray(parts) ? parts.length : 'not array');
    
    const { data: message, error } = await client
      .from('messages')
      .insert([{
        chat_id: chatId,
        role: role,
        content: safeContent,
        parts: parts,
        attachments: [],
        created_at: new Date().toISOString()
      }])
      .select('id')
      .single();
    
    if (error) {
      console.error('메시지 저장 오류:', error);
      return null;
    }
    
    console.log(`메시지 성공적으로 저장됨 - ID: ${message.id}, 내용 길이: ${safeContent.length}`);
    return message.id;
  } catch (error) {
    console.error('메시지 저장 오류:', error);
    return null;
  }
}

// 채팅 가져오기
async function getChatById(chatId: string) {
  try {
    // 채팅 ID가 없으면 null 반환
    if (!chatId) {
      console.log('채팅 ID가 제공되지 않았습니다.');
      return null;
    }

    const { data, error } = await client
      .from('chats')
      .select('*')
      .eq('id', chatId);
    
    if (error) {
      // PGRST116 오류 처리 추가
      if (error.code === 'PGRST116') {
        console.log(`채팅 ID ${chatId}에 해당하는 결과가 없습니다. PGRST116 오류`);
        return null;
      }
      console.error('채팅 가져오기 오류:', error);
      return null;
    }
    
    // 결과가 없는 경우 처리
    if (!data || data.length === 0) {
      console.log(`채팅 ID ${chatId}에 해당하는 채팅이 없습니다. 빈 배열을 반환합니다`);
      return null;
    }
    
    // 첫 번째 결과 반환
    return data[0];
  } catch (error) {
    console.error('채팅 가져오기 오류:', error);
    return null;
  }
}

// 세션에서 사용자 정보 가져오기
async function getUserFromSession() {
  try {
    const session = await auth();
    if (session?.user?.id) {
      console.log("[인증] 세션에서 사용자 정보 가져옴:", {
        id: session.user.id,
        email: session.user.email || "이메일 없음",
        type: session.user.type || "타입 없음"
      });
      return session.user;
    }
    return null;
  } catch (error) {
    console.error("세션 사용자 정보 가져오기 오류:", error);
    return null;
  }
}

// 채팅 ID와 사용자 ID 간의 매핑 저장 함수
async function saveChatUserMapping(nextAuthId: string, chatId: string) {
  try {
    if (!nextAuthId || !chatId) {
      console.log('유효하지 않은 매핑 정보:', { nextAuthId, chatId });
      return;
    }

    console.log(`채팅 사용자 매핑 저장 시도: ${nextAuthId} -> ${chatId}`);

    // 이미 존재하는지 확인
    const { data: existingMapping } = await client
      .from('user_mappings')
      .select('id')
      .eq('next_auth_id', nextAuthId)
      .eq('chat_id', chatId)
      .single();
    
    if (existingMapping) {
      console.log(`이미 존재하는 매핑 발견: ${nextAuthId} -> ${chatId}`);
      return;
    }

    // 새 매핑 저장
    const { error } = await client
      .from('user_mappings')
      .insert({
        next_auth_id: nextAuthId,
        supabase_id: nextAuthId, // 세션 ID를 supabaseId로 사용
        chat_id: chatId,
        created_at: new Date().toISOString()
      });
    
    if (error) {
      console.error('매핑 저장 오류:', error);
    } else {
      console.log(`매핑 저장 성공: ${nextAuthId} -> ${chatId}`);
    }
  } catch (error) {
    console.error('매핑 저장 중 오류:', error);
  }
}

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const json = await request.json();
    console.log('받은 요청 본문:', JSON.stringify(json).substring(0, 500) + '...'); // 디버깅 로그 추가
    
    // 더 유연한 요청 구조 처리
    let query = '';
    let userMessage;
    
    // 다양한 요청 형식 처리
    if (json.messages && Array.isArray(json.messages) && json.messages.length > 0) {
      // 메시지 배열이 있는 경우 마지막 메시지 사용
      userMessage = json.messages[json.messages.length - 1];
      query = typeof userMessage.content === 'string' ? userMessage.content : '';
    } else if (json.message && typeof json.message === 'object') {
      // message 객체가 직접 전달된 경우
      userMessage = json.message;
      query = typeof userMessage.content === 'string' ? userMessage.content : '';
    } else if (json.content && typeof json.content === 'string') {
      // content가 직접 전달된 경우
      query = json.content;
      userMessage = { role: 'user', content: query };
    } else if (typeof json.query === 'string') {
      // query 필드가 전달된 경우
      query = json.query;
      userMessage = { role: 'user', content: query };
    }
    
    // 최소한의 유효성 검사
    if (!query) {
      console.error('유효하지 않은 메시지 내용:', json);
      return new Response('유효한 메시지 내용이 필요합니다.', { status: 400 });
    }
    
    // 채팅 ID 처리 - UUID 형식 확인 및 변환
    let chatId = json.id || json.chatId;
    
    // UUID 형식을 검증하는 함수 추가
    const isValidUUID = (uuid: string): boolean => {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      return uuidRegex.test(uuid);
    };
    
    // UUID가 아닌 경우 새 UUID 생성
    if (chatId && !isValidUUID(chatId)) {
      console.log(`전달된 ID ${chatId}는, UUID 형식이 아닙니다. 새 UUID를 생성합니다.`);
      chatId = generateUUID();
    }
    
    // 채팅 히스토리를 위한 데이터 저장 (비동기로 처리)
    let userId: string | null = null;
    let newChatId: string | null = null;
    
    try {
      // 인증된 사용자 또는 게스트 사용자 ID 가져오기
      userId = await getUserId();
      
      if (userId) {
        if (chatId) {
          // 클라이언트가 보낸 채팅 ID를 항상 그대로 사용
          console.log(`클라이언트가 제공한 채팅 ID ${chatId}를 사용합니다.`);
          newChatId = chatId;
          
          // DB에 존재하지 않아도 새로 생성하지 않음
          const existingChat = await getChatById(chatId);
          if (!existingChat) {
            // 최초 1회만 저장 (DB에 없는 경우)
            console.log(`최초 저장: 채팅 ID ${chatId}를 DB에 저장합니다.`);
            await saveChat(userId, `${query.substring(0, 50)}...`, chatId);
          }
        } else {
          // 채팅 ID가 없는 경우에만 새로 생성 (최초 접속 시)
          console.log(`새 채팅 시작: 새 채팅 ID를 생성합니다. 사용자 ID: ${userId}`);
          newChatId = await saveChat(userId, `${query.substring(0, 50)}...`);
        }
        
        if (newChatId) {
          console.log(`채팅 ID ${newChatId}에 메시지를 저장합니다.`);
          // 사용자 메시지 저장
          const messageId = await saveMessage(newChatId, 'user', query);
          if (!messageId) {
            console.warn('사용자 메시지 저장에 실패했습니다.');
          } else {
            console.log(`메시지 ID ${messageId}가 성공적으로 저장되었습니다.`);
          }
          
          // 세션에서 사용자 정보를 가져와서 매핑 테이블에 저장
          const session = await auth();
          if (session?.user?.id) {
            console.log(`인증된 사용자 발견: ${session.user.id}, 매핑 저장 시도`);
            await saveChatUserMapping(session.user.id, newChatId);
          }
        }
      }
    } catch (dbError) {
      console.error('DB 저장 오류:', dbError);
      // DB 저장 오류가 있어도 챗봇 응답은 계속 진행
    }
    
    // 갤럭시 챗봇 검색 로직 적용
    const searchContext = await searchDocuments(query);
    
    // 시스템 프롬프트 설정
    const systemPromptText = `
    당신은 삼성 갤럭시 S25의 친절하고 도움이 되는 가상 도우미입니다. 
    사용자의 질문에 대해 상세하고 유용한 정보를 제공하며, 필요한 경우 단계별 안내를 해주세요.
    기술적인 정보뿐만 아니라 실제 사용자가 이해하기 쉽고 도움이 되는 조언도 함께 제공해 주세요.
    친근하고 대화하듯 답변하되, 정확한 정보를 제공하는 것이 가장 중요합니다.

    참고할 정보는 다음과 같습니다:
    ${searchContext}
    
    === 중요: 이미지 URL 포함 방법 ===
    이미지가 필요한 경우 반드시 아래 형식을 정확히 따라주세요:
    
    [이미지 1]
    https://ywvoksfszaelkceectaa.supabase.co/storage/v1/object/public/images/galaxy_s25_[type]_p[page]_[position]_[hash].jpg
    
    여러 이미지를 포함할 경우 다음과 같이 각 이미지에 번호를 부여하세요:
    
    [이미지 1]
    https://ywvoksfszaelkceectaa.supabase.co/storage/v1/object/public/images/galaxy_s25_[type]_p[page]_[position]_[hash].jpg
    
    [이미지 2]
    https://ywvoksfszaelkceectaa.supabase.co/storage/v1/object/public/images/galaxy_s25_[type]_p[page]_[position]_[hash].jpg

    여기서:
    - [type]: 이미지 유형 (사용 가능한 타입: chart, figure만 허용됨)
    - [page]: 페이지 번호 (숫자)
    - [position]: 이미지 위치 (top, mid, bot)
    - [hash]: 고유 식별자 (16진수 해시)

    *** 중요: 관련 내용에 대한 이미지가 있을 경우 포함해주세요. 모든 응답에 이미지가 필요한 것은 아닙니다. ***
    *** 중요: 유효한 이미지 타입은 chart와 figure만 사용 가능합니다. screen이나 diagram 등 다른 타입은 사용하지 마세요. ***
    *** 중요: 한 응답에 여러 이미지가 필요한 경우 [이미지 1], [이미지 2]와 같이 번호를 순차적으로 증가시켜 사용하세요. ***
    
    사용 가능한 실제 이미지 목록 (실제 존재하는 파일만 사용하세요):
    galaxy_s25_figure_p5_mid_66ed6d2a.jpg
    galaxy_s25_figure_p87_mid_2fbf3d6e.jpg
    galaxy_s25_figure_p72_mid_a816e8bc.jpg
    galaxy_s25_figure_p91_mid_f5f60248.jpg
    galaxy_s25_figure_p56_mid_6e381743.jpg
    galaxy_s25_figure_p9_mid_b9ae8b72.jpg
    galaxy_s25_chart_p44_bot_c831a541.jpg
    galaxy_s25_figure_p11_mid_0dbbd981.jpg
    galaxy_s25_figure_p44_mid_8fee8dc1.jpg
    galaxy_s25_figure_p46_mid_604a76d4.jpg
    galaxy_s25_figure_p85_bot_79a4e6d5.jpg
    galaxy_s25_figure_p27_bot_284e581e.jpg
    galaxy_s25_figure_p74_mid_c2913726.jpg
    galaxy_s25_figure_p135_mid_705fc78a.jpg
    galaxy_s25_figure_p110_mid_18747ac9.jpg
    galaxy_s25_figure_p30_mid_f93b057b.jpg
    galaxy_s25_figure_p66_mid_f180ba24.jpg
    galaxy_s25_figure_p7_mid_e3dee85a.jpg
    galaxy_s25_figure_p84_mid_e48bdada.jpg
    galaxy_s25_figure_p71_mid_0a105f98.jpg
    galaxy_s25_chart_p79_mid_6112d671.jpg
    galaxy_s25_chart_p43_mid_0fb137a8.jpg
    galaxy_s25_figure_p14_mid_de9837a9.jpg
    galaxy_s25_figure_p24_mid_72dfd867.jpg
    galaxy_s25_chart_p92_mid_648f80d3.jpg
    galaxy_s25_figure_p63_mid_09b84c91.jpg
    galaxy_s25_figure_p6_mid_4fcab36d.jpg
    galaxy_s25_figure_p73_mid_66e59639.jpg
    galaxy_s25_figure_p118_mid_bb0b15b4.jpg
    galaxy_s25_figure_p4_mid_de795101.jpg
    `;
    
    // 스트리밍 응답 생성
    const response = createDataStreamResponse({
      execute: async (dataStream) => {
        // AI에 전달할 메시지 구성 
        const aiMessages = Array.isArray(json.messages) && json.messages.length > 0 
          ? json.messages 
          : [{ role: 'user' as const, content: query }];
        
        // 디버그 모드 설정
        const isDebugMode = true;
        console.log('디버그 모드 활성화 여부:', isDebugMode);
    
        // 스트림 텍스트 생성 옵션
        const streamTextOptions = {
          model: myProvider.languageModel('chat-model'),
          system: systemPromptText,
          messages: aiMessages,
          experimental_transform: smoothStream({
            chunking: /\n\n|\n(?=\[이미지)/,  // 빈 줄 또는 이미지 패턴 시작 부분을 기준으로 분할
            delayInMs: 0  // 딜레이 없이 빠르게 전송
          }),
          experimental_generateMessageId: generateUUID,
          experimental_telemetry: {
            isEnabled: isProductionEnvironment,
            functionId: 'stream-text',
          }
        };
        
        console.log('스트림 응답 시작됨');
        
        // 채팅 ID 정보 로깅
        if (newChatId) {
          const chatInfo = {
            chatId: newChatId,
            originalChatId: chatId,
            chatIdChanged: newChatId !== chatId
          };
          
          console.log(`새 채팅 ID 생성됨 (헤더에 포함됨): ${JSON.stringify(chatInfo)}`);
        }
        
        // streamText 호출 (간단하게 스트리밍만 처리)
        const result = streamText(streamTextOptions);
        
        try {
          // 스트림 소비 및 병합 (단순하게 유지)
          result.consumeStream();
          await result.mergeIntoDataStream(dataStream);
          
          console.log('스트림 처리 완료');
          
          // 참고: 실제 응답 저장은 프론트엔드에서 최종 렌더링된 응답을 캡처하여 
          // 별도의 API 호출을 통해 처리하도록 변경
          // 이 단계에서는 사용자 메시지만 저장하고, 어시스턴트 응답은 프론트엔드에서 전송 예정
        } catch (error) {
          console.error('응답 처리 오류:', error);
        }
      }
    });
    
    // 응답 헤더에 채팅 ID 추가
    response.headers.set('X-Chat-ID', newChatId || chatId || '');
    
    return response;
  } catch (error) {
    console.error("오류:", error);
    return new Response('요청 처리 중 오류가 발생했습니다.', {
      status: 500,
    });
  }
}

// 채팅 목록 조회
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Number.parseInt(searchParams.get('limit') || '10');
    
    // 최근 채팅 목록 조회
    const { data: chats, error } = await client
      .from('chats')
      .select('id, title, created_at, user_id')
      .order('created_at', { ascending: false })
      .limit(limit);
    
    if (error) {
      console.error('채팅 목록 조회 오류:', error);
      return new Response('채팅 목록 조회 중 오류가 발생했습니다.', { status: 500 });
    }
    
    return Response.json(chats);
  } catch (error) {
    console.error('채팅 목록 조회 오류:', error);
    return new Response('채팅 목록 조회 중 오류가 발생했습니다.', { status: 500 });
  }
}

// DELETE 함수는 우선 인증 로직을 제거하고 단순화
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return new Response('찾을 수 없는 채팅입니다.', { status: 404 });
  }

  try {
    // 채팅 삭제
    const { error } = await client
      .from('chats')
      .delete()
      .eq('id', id);
    
    if (error) {
      console.error('채팅 삭제 오류:', error);
      return new Response('채팅 삭제 중 오류가 발생했습니다.', { status: 500 });
    }
    
    return Response.json({ deleted: true }, { status: 200 });
  } catch (error) {
    console.error('채팅 삭제 오류:', error);
    return new Response('채팅 삭제 중 오류가 발생했습니다.', { status: 500 });
  }
}

// AI 응답 메시지 저장을 위한 추가 API 엔드포인트 - 프론트엔드에서 캡처한 응답 저장용
export async function PUT(request: Request) {
  try {
    const json = await request.json();
    const { chatId, content, metadata } = json;
    
    if (!chatId || !content) {
      return new Response('채팅 ID와 메시지 내용은 필수입니다.', { status: 400 });
    }
    
    console.log('프론트엔드에서 캡처한 응답 저장 요청 받음:', {
      chatId,
      contentLength: content.length
    });
    
    // 채팅 ID가 존재하는지 확인
    const existingChat = await getChatById(chatId);
    
    // 채팅이 존재하지 않으면 DB에 저장만 하고 ID는 변경하지 않음
    if (!existingChat) {
      console.log(`채팅 ID ${chatId}가 존재하지 않습니다. 동일한 ID로 DB에 저장합니다.`);
      
      // 인증된 사용자 ID 가져오기
      const userId = await getUserId();
      
      if (userId) {
        // DB에 저장 (ID 변경 없음)
        const title = content.substring(0, 50) + '...'; // 내용의 일부를 제목으로 사용
        await saveChat(userId, title, chatId); // chatId를 그대로 사용하기 위해 ID 직접 전달
        
        console.log(`채팅을 DB에 저장했습니다. ID: ${chatId} (변경 없음)`);
        
        // 세션에서 사용자 정보를 가져와서 매핑 테이블에 저장
        const session = await auth();
        if (session?.user?.id) {
          console.log(`인증된 사용자 발견: ${session.user.id}, 새 채팅과 매핑 저장`);
          await saveChatUserMapping(session.user.id, chatId);
        }
      } else {
        console.error('사용자 ID를 찾을 수 없어 새 채팅을 생성할 수 없습니다.');
        return new Response('인증된 사용자를 찾을 수 없습니다.', { status: 403 });
      }
    }
    
    // content가 문자열인지 확인 (안전 처리)
    const safeContent = typeof content === 'string' ? content : JSON.stringify(content);
    
    // parts 필드 구성 - 안전한 문자열 사용
    const parts = [{ 
      type: 'text', 
      text: safeContent 
    }];
    
    // 이미지 추출 시도
    let extractedImages: any[] = [];
    try {
      extractedImages = extractImagesFromText(safeContent);
      console.log('프론트엔드 응답에서 이미지 추출:', extractedImages.length);
    } catch (imageError) {
      console.error('이미지 추출 오류:', imageError);
    }
    
    // 기본 메시지 데이터
    const messageData: any = {
      chat_id: chatId, // 항상 원래 채팅 ID 사용
      role: 'assistant',
      content: safeContent,
      parts: parts,
      created_at: new Date().toISOString()
    };
    
    // 추출된 이미지가 있으면 첨부
    if (extractedImages.length > 0) {
      messageData.attachments = extractedImages;
    } 
    // 별도로 전달된 메타데이터가 있으면 추가
    else if (metadata?.images && Array.isArray(metadata.images) && metadata.images.length > 0) {
      console.log(`이미지 메타데이터 ${metadata.images.length}개 처리 중`);
      
      try {
        // 이미지 정보를 안전하게 저장
        messageData.metadata = { 
          images: metadata.images,
          isStreamResponse: true
        };
        messageData.attachments = metadata.images;
        
        console.log('이미지 정보 저장 완료:', messageData.attachments.length);
      } catch (imgError) {
        console.error('이미지 정보 처리 오류:', imgError);
        messageData.attachments = [];
      }
    } else {
      console.log('이미지 없음, 빈 attachments 설정');
      messageData.attachments = [];
    }
    
    // 메시지 저장
    const { data: message, error } = await client
      .from('messages')
      .insert([messageData])
      .select('id')
      .single();
    
    if (error) {
      console.error('프론트엔드 캡처 메시지 저장 오류:', error);
      return new Response('메시지 저장 중 오류가 발생했습니다.', { status: 500 });
    }
    
    console.log('프론트엔드 캡처 메시지 저장 성공 - ID:', message.id);
    
    // 성공 응답에 이미지 정보와 최종 사용된 채팅 ID도 포함
    return Response.json({ 
      success: true, 
      messageId: message.id,
      chatId: chatId, // 최종 사용된 채팅 ID 반환
      originalChatId: chatId, // 원래 요청된 채팅 ID
      chatIdChanged: false, // 채팅 ID가 변경되었는지 여부
      hasImages: extractedImages.length > 0 || !!(metadata && metadata.images && metadata.images.length > 0),
      imageCount: extractedImages.length || metadata?.images?.length || 0
    });
  } catch (error) {
    console.error('AI 응답 저장 오류:', error);
    return new Response('요청 처리 중 오류가 발생했습니다.', { status: 500 });
  }
}