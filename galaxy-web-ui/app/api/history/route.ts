import { auth } from '@/app/(auth)/auth';
import type { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Supabase 설정
const SUPABASE_URL = process.env.SUPABASE_URL || "https://ywvoksfszaelkceectaa.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3dm9rc2ZzemFlbGtjZWVjdGFhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NTU0ODUyMCwiZXhwIjoyMDYxMTI0NTIwfQ.KBkf30JIVTc-k0ysyZ_Fen1prSkNZe-p4c2nL6T37hE";

// Supabase 클라이언트 설정 (IPv4만 사용하도록 강제)
const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: true,
  },
  global: {
    fetch: (url, options) => {
      return fetch(url, {
        ...options,
        // IPv4만 사용하도록 강제
        headers: {
          ...options?.headers,
          'Family-Preference': 'IPv4',
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });
    }
  }
});

// UUID 형식 검증 함수
const isValidUUID = (uuid: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};

// 테스트용 알려진 사용자 ID 목록
const KNOWN_USER_IDS = [
  "0f705e4c-9270-4dd4-8b55-5f46ec04c196",
  "58e0ea15-3c59-46aa-bd69-3751bb0a0b4b",
  "00000000-0000-0000-0000-000000000001"
];

// 사용자 ID 매핑 확인 함수 - chat_id 파라미터 추가
const getUserIdMapping = async (nextAuthId: string, chatId?: string) => {
  try {
    // 특정 채팅 ID에 대한 매핑이 있는지 확인
    if (chatId) {
      const { data: chatMapping, error: chatMappingError } = await client
        .from('user_mappings')
        .select('supabase_id')
        .eq('next_auth_id', nextAuthId)
        .eq('chat_id', chatId)
        .single();
      
      if (!chatMappingError && chatMapping && chatMapping.supabase_id) {
        console.log(`채팅 ID ${chatId}에 대한 매핑 발견: ${nextAuthId} -> ${chatMapping.supabase_id}`);
        return chatMapping.supabase_id;
      }
    }
    
    // 사용자의 모든 매핑 확인 (chat_id에 관계없이)
    const { data: mappings, error: mappingError } = await client
      .from('user_mappings')
      .select('supabase_id')
      .eq('next_auth_id', nextAuthId);

    if (!mappingError && mappings && mappings.length > 0) {
      // 첫 번째 매핑 사용
      const firstMapping = mappings[0];
      console.log(`매핑 테이블에서 ID 찾음: ${nextAuthId} -> ${firstMapping.supabase_id}`);
      return firstMapping.supabase_id;
    }

    // 매핑이 없으면 기본 ID 목록 사용
    console.log(`매핑 테이블에서 ID를 찾지 못함: ${nextAuthId}. 기본 ID 목록 사용`);
    const allPossibleIds = [nextAuthId, ...KNOWN_USER_IDS];
    return allPossibleIds;
  } catch (error) {
    console.error("ID 매핑 조회 중 오류:", error);
    // 오류 발생 시 기본 ID 목록 반환
    return [nextAuthId, ...KNOWN_USER_IDS];
  }
};

// 채팅 조회 시 새 매핑 저장
const saveNewChatMapping = async (nextAuthId: string, supabaseId: string, chatId: string) => {
  try {
    // 이미 존재하는지 확인
    const { data: existingMapping } = await client
      .from('user_mappings')
      .select('id')
      .eq('next_auth_id', nextAuthId)
      .eq('chat_id', chatId)
      .single();
    
    if (!existingMapping) {
      // 새 채팅 매핑 저장
      const { error } = await client
        .from('user_mappings')
        .insert({
          next_auth_id: nextAuthId,
          supabase_id: supabaseId,
          chat_id: chatId,
          created_at: new Date().toISOString()
        });
      
      if (error) {
        console.error(`채팅 ID ${chatId}에 대한 매핑 저장 실패:`, error);
      } else {
        console.log(`채팅 ID ${chatId}에 대한 새 매핑 저장 성공: ${nextAuthId} -> ${supabaseId}`);
      }
    }
  } catch (error) {
    console.error("채팅 매핑 저장 중 오류:", error);
  }
};

export async function GET(request: NextRequest) {
  console.log("===== GET /api/history API 호출됨 =====");
  const { searchParams } = request.nextUrl;

  const limit = Number.parseInt(searchParams.get('limit') || '10');
  const startingAfter = searchParams.get('starting_after');
  const endingBefore = searchParams.get('ending_before');
  
  // 세션 ID 또는 현재 시간을 가져옴 (세션별 채팅 필터링용)
  const sessionId = searchParams.get('session_id') || '';
  // 특정 채팅 ID 파라미터 추가
  const chatId = searchParams.get('chat_id') || '';
  
  console.log(`요청 파라미터: limit=${limit}, startingAfter=${startingAfter}, endingBefore=${endingBefore}, sessionId=${sessionId}, chatId=${chatId}`);

  if (startingAfter && endingBefore) {
    console.log("오류: starting_after와 ending_before가 동시에 제공됨");
    return Response.json(
      'Only one of starting_after or ending_before can be provided!',
      { status: 400 },
    );
  }

  const session = await auth();
  
  // 디버깅 로그 추가
  console.log("세션 정보:", {
    인증상태: session?.user?.id ? "인증됨" : "인증 안됨",
    유저ID: session?.user?.id || "없음",
    이메일: session?.user?.email || "없음",
    이름: session?.user?.name || "없음",
    타입: session?.user?.type || "없음"
  });

  if (!session?.user?.id) {
    console.log("오류: 인증되지 않은 사용자");
    // 비로그인 사용자에게는 빈 응답을 반환 (401 대신)
    return Response.json({ chats: [], hasMore: false });
  }
  
  // 게스트 사용자는 대화 이력을 보지 않음
  if (session.user.type === 'guest') {
    console.log("게스트 사용자는 대화 이력을 볼 수 없습니다");
    return Response.json({ chats: [], hasMore: false });
  }

  try {
    // 현재 사용자 ID 로깅
    const currentUserId = session.user.id;
    console.log(`현재 사용자 ID: ${currentUserId}`);
    
    // 매핑 테이블을 통해 사용 가능한 사용자 ID 목록 가져오기
    // 특정 채팅 ID가 있는 경우 해당 매핑 사용
    const userIds = await getUserIdMapping(currentUserId, chatId);
    console.log(`조회할 사용자 ID: ${Array.isArray(userIds) ? userIds.join(', ') : userIds}`);
    
    // 모든 채팅 조회 쿼리 생성
    let query = client
      .from('chats')
      .select('id, title, created_at, user_id');
    
    // 단일 ID인 경우 eq, 다중 ID인 경우 in 사용  
    if (Array.isArray(userIds)) {
      query = query.in('user_id', userIds);
      console.log(`여러 사용자 ID로 채팅 조회 중: ${userIds.length}개 ID`);
    } else {
      query = query.eq('user_id', userIds);
      console.log(`단일 사용자 ID로 채팅 조회 중: ${userIds}`);
    }
    
    // 특정 채팅 ID가 지정된 경우 해당 채팅만 조회
    if (chatId && isValidUUID(chatId)) {
      query = query.eq('id', chatId);
      console.log(`특정 채팅 ID로 필터링: ${chatId}`);
    }
    
    // 최신순 정렬 및 제한 적용
    query = query
      .order('created_at', { ascending: false })
      .limit(limit + 1);
    
    // 페이지네이션 처리
    if (startingAfter) {
      console.log(`startingAfter=${startingAfter} 이후 채팅 조회 중`);
      const { data: selectedChat } = await client
        .from('chats')
        .select('created_at')
        .eq('id', startingAfter)
        .single();

      if (selectedChat) {
        console.log(`기준 채팅 created_at: ${selectedChat.created_at}`);
        query = query.gt('created_at', selectedChat.created_at);
      } else {
        console.log(`startingAfter=${startingAfter}에 해당하는 채팅을 찾을 수 없음`);
      }
    } else if (endingBefore) {
      console.log(`endingBefore=${endingBefore} 이전 채팅 조회 중`);
      const { data: selectedChat } = await client
        .from('chats')
        .select('created_at')
        .eq('id', endingBefore)
        .single();

      if (selectedChat) {
        console.log(`기준 채팅 created_at: ${selectedChat.created_at}`);
        query = query.lt('created_at', selectedChat.created_at);
      } else {
        console.log(`endingBefore=${endingBefore}에 해당하는 채팅을 찾을 수 없음`);
      }
    }

    const { data: chats, error } = await query;

    if (error) {
      console.error('채팅 목록 조회 오류:', error);
      console.log(`오류 세부 정보: ${JSON.stringify(error)}`);
      
      return Response.json({ error: '채팅 목록을 불러올 수 없습니다' }, { status: 500 });
    }

    console.log(`채팅 목록 조회 결과: ${chats?.length || 0}개의 채팅 발견`);
    if (chats && chats.length > 0) {
      console.log('첫 번째 채팅:', {
        id: chats[0].id,
        title: chats[0].title,
        created_at: chats[0].created_at,
        user_id: chats[0].user_id
      });
      
      // 발견된 각 채팅에 대해 매핑 정보 저장
      // Array.isArray 체크는 typescript 타입 검사를 위한 것
      if (!Array.isArray(userIds) && chats.length > 0) {
        // 각 채팅에 대해 매핑 저장
        for (const chat of chats) {
          await saveNewChatMapping(currentUserId, userIds, chat.id);
        }
      }
    } else {
      console.log('채팅 기록이 없습니다.');
    }
    
    const hasMore = chats ? chats.length > limit : false;
    const slicedChats = hasMore ? chats.slice(0, limit) : chats || [];

    return Response.json({
      chats: slicedChats.map((chat) => ({
        id: chat.id,
        title: chat.title,
        created_at: chat.created_at,
        createdAt: chat.created_at,
        userId: chat.user_id,
        user_id: chat.user_id,
        visibility: 'private',
      })),
      hasMore,
    });
  } catch (error: any) {
    console.error('채팅 목록 조회 중 오류 발생:', error);
    
    return Response.json(
      { error: `채팅 목록을 불러올 수 없습니다: ${error.message}` },
      { status: 500 },
    );
  }
} 