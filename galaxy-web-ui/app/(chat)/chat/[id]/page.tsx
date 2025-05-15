import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/app/(auth)/auth';
import { Chat } from '@/components/chat';
import { getChatById, getMessagesByChatId } from '@/lib/db/queries';
import { DataStreamHandler } from '@/components/data-stream-handler';
import { DEFAULT_CHAT_MODEL } from '@/lib/ai/models';
import type { DBMessage } from '@/lib/db/schema';
import type { Attachment, UIMessage } from 'ai';

export default async function Page(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { id } = params;
  const chat = await getChatById({ id });

  if (!chat) {
    notFound();
  }

  const session = await auth();

  if (!session) {
    redirect('/api/auth/guest');
  }

  if (chat.visibility === 'private') {
    if (!session.user) {
      return notFound();
    }

    if (session.user.id !== chat.userId) {
      return notFound();
    }
  }

  const messagesFromDb = await getMessagesByChatId({
    id,
  });

  function convertToUIMessages(messages: Array<DBMessage>): Array<UIMessage> {
    return messages.map((message) => {
      // parts 값이 null이거나 비어있는 경우 content 값으로 parts 생성
      const messageParts = message.parts 
        ? (message.parts as UIMessage['parts']) 
        : [{ type: 'text' as const, text: message.content }];
      
      return {
        id: message.id,
        parts: messageParts,
        role: message.role as UIMessage['role'],
        content: message.content,
        createdAt: message.createdAt,
        experimental_attachments:
          (message.attachments as Array<Attachment>) ?? [],
      };
    });
  }

  const cookieStore = await cookies();
  const chatModelFromCookie = cookieStore.get('chat-model');

  try {
  if (!chatModelFromCookie) {
    return (
      <>
        <Chat
          id={chat.id}
          initialMessages={convertToUIMessages(messagesFromDb)}
          selectedChatModel={DEFAULT_CHAT_MODEL}
          selectedVisibilityType={chat.visibility}
          isReadonly={session?.user?.id !== chat.userId}
          session={session}
            registerChatMapping={true}
        />
        <DataStreamHandler id={id} />
      </>
    );
  }

  return (
    <>
      <Chat
        id={chat.id}
        initialMessages={convertToUIMessages(messagesFromDb)}
        selectedChatModel={chatModelFromCookie.value}
        selectedVisibilityType={chat.visibility}
        isReadonly={session?.user?.id !== chat.userId}
        session={session}
          registerChatMapping={true}
      />
      <DataStreamHandler id={id} />
    </>
  );
  } catch (error) {
    console.error('채팅 페이지 로드 중 오류:', error);
    return (
      <div className="flex flex-col items-center justify-center h-screen">
        <h1 className="text-2xl mb-4">오류가 발생했습니다</h1>
        <p className="text-gray-500 mb-4">요청한 채팅을 불러올 수 없습니다.</p>
        <button 
          onClick={() => window.location.href = '/'} 
          className="px-4 py-2 bg-blue-500 text-white rounded-md"
        >
          홈으로 돌아가기
        </button>
      </div>
    );
  }
}
