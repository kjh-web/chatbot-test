import { auth } from '@/app/(auth)/auth';
import { createClient } from '@supabase/supabase-js';

// Supabase 설정
const SUPABASE_URL = process.env.SUPABASE_URL || "https://ywvoksfszaelkceectaa.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3dm9rc2ZzemFlbGtjZWVjdGFhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NTU0ODUyMCwiZXhwIjoyMDYxMTI0NTIwfQ.KBkf30JIVTc-k0ysyZ_Fen1prSkNZe-p4c2nL6T37hE";

// Supabase 클라이언트 설정
const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// UUID 형식 검증 함수
const isValidUUID = (uuid: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};

// 스네이크 케이스 응답을 카멜 케이스로 변환하는 함수
const transformVoteData = (votes: any[]): any[] => {
  return votes.map(vote => ({
    chatId: vote.chat_id,
    messageId: vote.message_id,
    isUpvoted: vote.is_upvoted,
    id: vote.id
  }));
};

// 사용자의 최신 채팅 ID 조회 함수
async function getUserLatestChatId(userId: string): Promise<string | null> {
  try {
    // 사용자의 가장 최근 채팅 가져오기
    const { data: chats, error } = await client
      .from('chats')
      .select('id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1);
    
    if (error || !chats || chats.length === 0) {
      console.log(`[VOTE-API] 사용자 ${userId}의 채팅을 찾을 수 없습니다.`);
      return null;
    }
    
    console.log(`[VOTE-API] 사용자의 최신 채팅 ID: ${chats[0].id}`);
    return chats[0].id;
  } catch (error) {
    console.error('[VOTE-API] 사용자 채팅 조회 중 오류:', error);
    return null;
  }
}

// 채팅에서 특정 인덱스의 메시지 ID 찾기 함수
async function getMessageIdByIndex(chatId: string, messageIndex: number): Promise<string | null> {
  try {
    // 채팅의 모든 메시지 (생성시간 순)
    const { data: messages, error } = await client
      .from('messages')
      .select('id')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });
    
    if (error || !messages || messages.length === 0) {
      console.log(`[VOTE-API] 채팅 ${chatId}에 메시지가 없습니다.`);
      return null;
    }
    
    // 인덱스가 범위를 벗어나면 최신 메시지 사용
    if (messageIndex < 0 || messageIndex >= messages.length) {
      console.log(`[VOTE-API] 인덱스 ${messageIndex}가 범위를 벗어납니다. 마지막 메시지를 사용합니다.`);
      return messages[messages.length - 1].id;
    }
    
    console.log(`[VOTE-API] 인덱스 ${messageIndex}의 메시지 ID: ${messages[messageIndex].id}`);
    return messages[messageIndex].id;
  } catch (error) {
    console.error('[VOTE-API] 메시지 조회 중 오류:', error);
    return null;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get('chatId');

  console.log(`[VOTE-API] GET 요청 처리 시작: chatId=${chatId}`);

  const session = await auth();

  if (!session || !session.user || !session.user.email) {
    console.log(`[VOTE-API] 인증되지 않은 사용자의 요청`);
    return Response.json([], { status: 200 });
  }

  // 사용자 ID 가져오기
  let userId = session.user.id;
  console.log(`[VOTE-API] 사용자 정보: id=${userId}, email=${session.user.email}`);
  
  // 게스트 ID가 UUID 형식이 아니면 기본 UUID 사용
  if (!isValidUUID(userId)) {
    console.log(`[VOTE-API] 사용자 ID ${userId}는 UUID 형식이 아닙니다. 기본 UUID를 사용합니다.`);
    userId = "00000000-0000-0000-0000-000000000001";
  }

  // 1. 사용자의 최신 채팅 ID 조회
  const userChatId = await getUserLatestChatId(userId);

  if (!userChatId) {
    console.log(`[VOTE-API] 사용자의 채팅을 찾을 수 없습니다. 빈 배열을 반환합니다.`);
    return Response.json([], { status: 200 });
  }

  // chatId 파라미터가 없거나 최신 채팅 ID와 일치하지 않으면 최신 채팅의 투표 반환
  const targetChatId = (chatId && isValidUUID(chatId)) ? chatId : userChatId;
  
  console.log(`[VOTE-API] 투표 조회 대상 채팅 ID: ${targetChatId} (요청된 ID: ${chatId}, 최신 채팅 ID: ${userChatId})`);

  // Supabase로 투표 조회
  const { data: votes, error: votesError } = await client
    .from('votes')
    .select('*')
    .eq('chat_id', targetChatId);

  if (votesError) {
    console.error('[VOTE-API] 투표 조회 오류:', votesError);
    return new Response('Failed to get votes', { status: 500 });
  }

  console.log(`[VOTE-API] 투표 조회 성공: ${votes?.length || 0}개의 투표 발견`);
  
  // 응답 데이터를 카멜 케이스로 변환
  const transformedVotes = transformVoteData(votes || []);
  return Response.json(transformedVotes, { status: 200 });
}

export async function PATCH(request: Request) {
  console.log(`[VOTE-API] PATCH 요청 처리 시작`);
  
  try {
  const {
      messageIndex, // 메시지 인덱스 (필수)
      type,         // 투표 타입 (up/down)
      chatId        // 프론트엔드에서 전달한 chatId (사용하지 않음)
    }: { 
      messageIndex: number;
      type: 'up' | 'down';
      chatId?: string;
    } = await request.json();

    console.log(`[VOTE-API] 요청 데이터: 메시지 인덱스=${messageIndex}, 타입=${type}`);

    if (messageIndex === undefined || !type) {
      console.log(`[VOTE-API] 오류: 필수 파라미터 누락`);
      return new Response('messageIndex and type are required', { status: 400 });
  }

  const session = await auth();

  if (!session || !session.user || !session.user.email) {
      console.log(`[VOTE-API] 인증되지 않은 사용자의 요청`);
    return new Response('Unauthorized', { status: 401 });
  }

  // 사용자 ID 검증 및 변환
  let userId = session.user.id;
    
    console.log(`[VOTE-API] 사용자 정보: id=${userId}, email=${session.user.email}`);
  
  // 게스트 ID가 UUID 형식이 아니면 기본 UUID 사용
  if (!isValidUUID(userId)) {
      console.log(`[VOTE-API] 사용자 ID ${userId}는 UUID 형식이 아닙니다. 기본 UUID를 사용합니다.`);
    // 게스트 사용자에게 고정 UUID 할당 (테스트용)
    userId = "00000000-0000-0000-0000-000000000001";
  }

    // 1. 사용자의 최신 채팅 ID 조회
    const userChatId = await getUserLatestChatId(userId);

    if (!userChatId) {
      console.log(`[VOTE-API] 사용자의 채팅을 찾을 수 없습니다. 임시 응답을 반환합니다.`);
      // 채팅이 없으면 임시 응답
      const mockVoteData = [{
        id: Math.random().toString(36).substring(2, 15),
        chat_id: chatId || "unknown",
        message_id: "unknown",
        is_upvoted: type === 'up'
      }];
      
      const transformedResult = transformVoteData(mockVoteData);
      return Response.json(transformedResult, { status: 200 });
    }
    
    // 2. 채팅에서 메시지 인덱스에 해당하는 메시지 ID 조회
    const messageId = await getMessageIdByIndex(userChatId, messageIndex);
    
    if (!messageId) {
      console.log(`[VOTE-API] 메시지를 찾을 수 없습니다. 임시 응답을 반환합니다.`);
      // 메시지가 없으면 임시 응답
      const mockVoteData = [{
        id: Math.random().toString(36).substring(2, 15),
        chat_id: userChatId,
        message_id: "unknown",
        is_upvoted: type === 'up'
      }];
      
      const transformedResult = transformVoteData(mockVoteData);
      return Response.json(transformedResult, { status: 200 });
  }

    // 3. 기존 투표 확인
  const { data: existingVote, error: existingVoteError } = await client
      .from('votes')
    .select('*')
    .eq('message_id', messageId)
      .eq('chat_id', userChatId);

  if (existingVoteError) {
      console.error('[VOTE-API] 기존 투표 조회 오류:', existingVoteError);
    return new Response('Failed to get existing vote', { status: 500 });
  }

    console.log(`[VOTE-API] 기존 투표 조회 결과: ${existingVote?.length || 0}개 발견`);

  let result;
  if (existingVote && existingVote.length > 0) {
    // 기존 투표 업데이트
      console.log(`[VOTE-API] 기존 투표 업데이트 시도: ${existingVote[0].id}`);
    const { data, error } = await client
        .from('votes')
        .update({ 
          is_upvoted: type === 'up'
        })
        .eq('id', existingVote[0].id)
        .select();
    
    result = { data, error };
  } else {
    // 새 투표 삽입
      console.log(`[VOTE-API] 새 투표 생성 시도 (사용자 채팅: ${userChatId}, 메시지: ${messageId})`);
    const { data, error } = await client
        .from('votes')
      .insert([{
          chat_id: userChatId,
        message_id: messageId,
        is_upvoted: type === 'up'
        }])
        .select();
    
    result = { data, error };
  }

  if (result.error) {
      console.error('[VOTE-API] 투표 저장 오류:', result.error);
      // 오류 발생 시 임시 응답
      const mockVoteData = [{
        id: Math.random().toString(36).substring(2, 15),
        chat_id: userChatId,
        message_id: messageId,
        is_upvoted: type === 'up'
      }];
      
      const transformedResult = transformVoteData(mockVoteData);
      return Response.json(transformedResult, { status: 200 });
    }

    console.log('[VOTE-API] 투표 저장 성공:', result.data);
    
    // 응답 데이터를 카멜 케이스로 변환
    const transformedResult = transformVoteData(result.data || []);
    return Response.json(transformedResult, { status: 200 });
  } catch (error) {
    console.error('[VOTE-API] 요청 처리 중 오류 발생:', error);
    return new Response(`Internal server error: ${error instanceof Error ? error.message : 'Unknown error'}`, { status: 500 });
  }
}
