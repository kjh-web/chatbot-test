import { cookies } from 'next/headers';

import { Chat } from '@/components/chat';
import { DEFAULT_CHAT_MODEL } from '@/lib/ai/models';
import { generateUUID } from '@/lib/utils';
import { DataStreamHandler } from '@/components/data-stream-handler';
import { auth } from '../(auth)/auth';
import { redirect } from 'next/navigation';

// 로그인 페이지 URL
const LOGIN_URL = '/login';

export default async function Page() {
  try {
    // 세션 확인 (로그인 여부 확인)
  const session = await auth();
    const isLoggedIn = !!session?.user;

  const id = generateUUID();

  const cookieStore = await cookies();
  const modelIdFromCookie = cookieStore.get('chat-model');

    // 로그인 상태에 따라 채팅 기록 저장 여부 결정
    // 로그인한 사용자만 채팅 기록 저장
    const shouldRegisterChatMapping = isLoggedIn;

    console.log('[CHAT] 챗봇 시작:', isLoggedIn ? session.user.email : '비로그인 사용자');

  if (!modelIdFromCookie) {
    return (
      <>
        <Chat
          key={id}
          id={id}
          initialMessages={[]}
          selectedChatModel={DEFAULT_CHAT_MODEL}
          selectedVisibilityType="private"
          isReadonly={false}
          session={session}
            registerChatMapping={shouldRegisterChatMapping}
        />
        <DataStreamHandler id={id} />
      </>
    );
  }

  return (
    <>
      <Chat
        key={id}
        id={id}
        initialMessages={[]}
        selectedChatModel={modelIdFromCookie.value}
        selectedVisibilityType="private"
        isReadonly={false}
        session={session}
          registerChatMapping={shouldRegisterChatMapping}
        />
        <DataStreamHandler id={id} />
      </>
    );
  } catch (error) {
    console.error('[CHAT] 오류 발생:', error);
    // 오류 발생 시에도 비로그인 사용자 채팅 허용
    const id = generateUUID();
    return (
      <>
        <Chat
          key={id}
          id={id}
          initialMessages={[]}
          selectedChatModel={DEFAULT_CHAT_MODEL}
          selectedVisibilityType="private"
          isReadonly={false}
          session={null}
          registerChatMapping={false}
      />
      <DataStreamHandler id={id} />
    </>
  );
  }
}
