import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { auth } from '@/app/(auth)/auth';

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
          'Family-Preference': 'IPv4', // 이 헤더는 프록시나 서버 설정에 따라 작동할 수 있음
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });
    }
  }
});

// 로그인 성공 후 매핑 테이블에 NextAuth ID와 Supabase ID 저장
// chatId를 포함하도록 수정
const saveUserIdMapping = async (nextAuthId: string, supabaseId: string, chatId?: string) => {
  if (!nextAuthId || !supabaseId) return;
  
  try {
    // chatId가 제공된 경우 해당 채팅에 대한 매핑 생성/업데이트
    if (chatId) {
      // 특정 채팅에 대한 매핑이 이미 있는지 확인
      const { data: existingChatMapping } = await client
        .from('user_mappings')
        .select('*')
        .eq('next_auth_id', nextAuthId)
        .eq('chat_id', chatId)
        .single();
      
      if (existingChatMapping) {
        // 이미 존재하면 업데이트
        const { error: updateError } = await client
          .from('user_mappings')
          .update({ 
            supabase_id: supabaseId, 
            updated_at: new Date().toISOString() 
          })
          .eq('next_auth_id', nextAuthId)
          .eq('chat_id', chatId);
        
        if (updateError) {
          console.error(`채팅 ID ${chatId}에 대한 매핑 업데이트 실패:`, updateError);
        } else {
          console.log(`채팅 ID ${chatId}에 대한 매핑 업데이트 성공: ${nextAuthId} -> ${supabaseId}`);
        }
      } else {
        // 없으면 새로 생성
        const { error: insertError } = await client
          .from('user_mappings')
          .insert({
            next_auth_id: nextAuthId,
            supabase_id: supabaseId,
            chat_id: chatId,
            created_at: new Date().toISOString()
          });
        
        if (insertError) {
          console.error(`채팅 ID ${chatId}에 대한 매핑 생성 실패:`, insertError);
        } else {
          console.log(`채팅 ID ${chatId}에 대한 매핑 생성 성공: ${nextAuthId} -> ${supabaseId}`);
        }
      }
      return;
    }
    
    // 기본 매핑 (chatId 없는 경우) - 이전 로직 유지
    const { data: existingMapping } = await client
      .from('user_mappings')
      .select('*')
      .eq('next_auth_id', nextAuthId)
      .is('chat_id', null)
      .single();
    
    if (existingMapping) {
      // 이미 존재하면 업데이트
      const { error: updateError } = await client
        .from('user_mappings')
        .update({ supabase_id: supabaseId, updated_at: new Date().toISOString() })
        .eq('next_auth_id', nextAuthId)
        .is('chat_id', null);
      
      if (updateError) {
        console.error('사용자 ID 매핑 업데이트 실패:', updateError);
      } else {
        console.log(`사용자 ID 매핑 업데이트 성공: ${nextAuthId} -> ${supabaseId}`);
      }
    } else {
      // 없으면 새로 생성
      const { error: insertError } = await client
        .from('user_mappings')
        .insert({
          next_auth_id: nextAuthId,
          supabase_id: supabaseId,
          chat_id: null, // 기본 매핑은 chat_id가 null
          created_at: new Date().toISOString()
        });
      
      if (insertError) {
        console.error('사용자 ID 매핑 생성 실패:', insertError);
      } else {
        console.log(`사용자 ID 매핑 생성 성공: ${nextAuthId} -> ${supabaseId}`);
      }
    }
  } catch (error) {
    console.error('매핑 테이블 처리 중 오류:', error);
  }
};

// 로그인 API 핸들러
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, supabaseId, chatId } = body;
    
    console.log("로그인/매핑 API 호출 수신:", { 
      이메일: email || '없음', 
      chatId: chatId || '없음', 
      supabaseId: supabaseId || '없음' 
    });
    
    const session = await auth();
    
    if (!session?.user?.id) {
      return Response.json({ success: false, message: '인증되지 않은 사용자' }, { status: 401 });
    }
    
    const nextAuthId = session.user.id;
    console.log(`인증된 사용자 ID: ${nextAuthId}`);
    
    // chatId가 제공된 경우, 사용자 ID를 직접 supabaseId로 사용하여 매핑 저장
    if (chatId) {
      // supabaseId가 없거나 빈 문자열이면 nextAuthId 사용
      const effectiveSupabaseId = supabaseId && supabaseId !== '없음' ? supabaseId : nextAuthId;
      console.log(`채팅 ID ${chatId}에 대한 매핑 저장 시도. supabaseId: ${effectiveSupabaseId}`);
      await saveUserIdMapping(nextAuthId, effectiveSupabaseId, chatId);
      return Response.json({ 
        success: true, 
        userId: nextAuthId,
        chatId: chatId,
        mappingCreated: true
      });
    }
    // 기존 로직: supabaseId가 제공된 경우의 처리
    else if (supabaseId) {
      await saveUserIdMapping(nextAuthId, supabaseId);
    return Response.json({ success: true, userId: nextAuthId });
    } 
    else {
      console.log('supabaseId나 chatId가 제공되지 않아 매핑을 저장하지 않습니다');
      return Response.json({ 
        success: true, 
        userId: nextAuthId,
        message: '매핑 정보가 제공되지 않았습니다'
      });
    }
  } catch (error) {
    console.error('로그인 처리 중 오류:', error);
    return Response.json({ 
      success: false, 
      message: '로그인 처리 중 오류가 발생했습니다',
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
} 