'use client';

import type { Attachment, UIMessage } from 'ai';
import { useChat } from '@ai-sdk/react';
import { useEffect, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { ChatHeader } from '@/components/chat-header';
import type { Vote } from '@/lib/db/schema';
import { fetcher, generateUUID } from '@/lib/utils';
import { Artifact } from './artifact';
import { MultimodalInput } from './multimodal-input';
import { Messages } from './messages';
import type { VisibilityType } from './visibility-selector';
import { useArtifactSelector } from '@/hooks/use-artifact';
import { unstable_serialize } from 'swr/infinite';
import { getChatHistoryPaginationKey } from './sidebar-history';
import { toast } from './toast';
import type { Session } from 'next-auth';
import { useSearchParams } from 'next/navigation';
import type { ImageData } from '@/lib/ai';

// UIMessage에 이미지 배열을 추가한 인터페이스
interface MessageWithImages extends UIMessage {
  images?: ImageData[];
}

export function Chat({
  id,
  initialMessages,
  selectedChatModel,
  selectedVisibilityType,
  isReadonly,
  session,
  registerChatMapping = false,
}: {
  id: string;
  initialMessages: Array<UIMessage>;
  selectedChatModel: string;
  selectedVisibilityType: VisibilityType;
  isReadonly: boolean;
  session: Session | null;
  registerChatMapping?: boolean;
}) {
  const { mutate } = useSWRConfig();

  const {
    messages,
    setMessages,
    handleSubmit,
    input,
    setInput,
    append,
    status,
    stop,
    reload,
  } = useChat({
    id,
    initialMessages,
    experimental_throttle: 100,
    sendExtraMessageFields: true,
    generateId: generateUUID,
    api: '/api/chat',
    experimental_prepareRequestBody: (body) => ({
      id,
      message: body.messages.at(-1),
      selectedChatModel,
    }),
    onResponse: (response) => {
      // 응답 디버깅을 위한 추가 로직
      console.log('API로부터 응답 받음:', response.status);
      
      // 응답 헤더에서 채팅 ID 확인 - 무시함
      const newChatId = response.headers.get('X-Chat-ID');
      
      // 백엔드가 전송한 새 채팅 ID 무시, 원래 URL의 ID만 사용
      console.log(`백엔드가 전송한 새 채팅 ID (무시됨): ${newChatId || '없음'}`);
      console.log(`현재 채팅 ID 유지: ${id}`);
      
      // 현재 채팅 ID를 세션 스토리지에 저장 (항상 원래 ID 사용)
      window.sessionStorage.setItem('current_chat_id', id);
      
      // 타입 체크를 위해 void 반환
    },
    onFinish: (message) => {
      console.log('메시지 완료됨:', {
        id: message.id,
        role: message.role,
        contentLength: message.content?.length || 0,
        
        // 타입 체크를 위해 any 타입으로 변환
        hasImages: !!(message as any).images && (message as any).images.length,
        imageCount: ((message as any).images)?.length || 0
      });
      
      // 메시지가 AI 응답인 경우에만 저장 요청 실행
      if (message.role === 'assistant' && message.content) {
        // 사용자 메시지 검색 (AI 응답 직전 메시지)
        const userMessage = messages.find(m => m.role === 'user' && m.id !== message.id);
        
        // 항상 URL의 원래 채팅 ID 사용 (세션 스토리지 무시)
        console.log(`AI 응답 저장: 채팅 ID ${id} 사용 (원래 URL 기준)`);
        
        // 요청 전 디버깅 정보
        console.log('AI 응답 저장 요청 준비:', {
          chatId: id,
          messageId: message.id,
          contentLength: message.content?.length || 0,
          hasImages: !!(message as any).images && (message as any).images.length > 0,
          imageCount: ((message as any).images)?.length || 0
        });
        
        // 프론트엔드에서 완성된 응답을 백엔드에 저장하는 PUT 요청
        fetch('/api/chat', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chatId: id, // 항상 URL의 원래 ID만 사용
            content: message.content,
            metadata: {
              images: (message as any).images || []
            }
          }),
        })
        .then(response => {
          if (!response.ok) {
            console.error('AI 응답 저장 오류:', response.statusText);
            return response.text().then(text => {
              throw new Error(`응답 저장 실패: ${text}`);
            });
          }
          return response.json();
        })
        .then(data => {
          console.log('AI 응답 저장 성공:', data);
        })
        .catch(error => {
          console.error('AI 응답 저장 중 오류 발생:', error);
        });
      }
      
      mutate(unstable_serialize(getChatHistoryPaginationKey));
    },
    onError: (error) => {
      console.error('채팅 오류 발생:', error);
      toast({
        type: 'error',
        description: error.message,
      });
    },
  });

  const searchParams = useSearchParams();
  const query = searchParams.get('query');

  const [hasAppendedQuery, setHasAppendedQuery] = useState(false);

  useEffect(() => {
    if (query && !hasAppendedQuery) {
      append({
        role: 'user',
        content: query,
      });

      setHasAppendedQuery(true);
      // URL 변경 방지 - 히스토리 조작 코드 제거
    }
  }, [query, append, hasAppendedQuery]);

  useEffect(() => {
    if (id && session?.user) {
      const registerMapping = async () => {
        try {
          console.log(`채팅 ID 매핑 등록 시도: ${id}, 사용자 ID: ${session.user.id}`);
          const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              chatId: id,
            }),
          });

          if (!response.ok) {
            console.warn('채팅 ID 매핑 등록 실패:', await response.text());
          } else {
            const result = await response.json();
            console.log('채팅 ID 매핑 등록 성공:', result);
          }
        } catch (error) {
          console.error('채팅 ID 매핑 등록 중 오류:', error);
        }
      };

      registerMapping();
    }
  }, [id, session]);

  const { data: votes } = useSWR<Array<Vote>>(
    messages.length >= 2 && session?.user ? `/api/vote?chatId=${id}` : null,
    fetcher,
    {
      dedupingInterval: 0,
      revalidateOnFocus: true,
      revalidateIfStale: true,
    }
  );

  const [attachments, setAttachments] = useState<Array<Attachment>>([]);
  const isArtifactVisible = useArtifactSelector((state) => state.isVisible);

  // 세션 스토리지 초기화 - URL의 ID만 사용하도록 변경
  useEffect(() => {
    // 세션 스토리지에 현재 채팅 ID 저장 (URL 기준)
    window.sessionStorage.setItem('current_chat_id', id);
    console.log(`채팅 초기화: 항상 URL ID ${id} 사용`);
    
    // 클린업 함수
    return () => {
      // 페이지 이동 시 세션 스토리지에서 채팅 ID 제거 (선택적)
      // window.sessionStorage.removeItem('current_chat_id');
    };
  }, [id]);

  return (
    <>
      <div className="flex flex-col min-w-0 h-dvh bg-background">
        <ChatHeader
          chatId={id}
          selectedModelId={selectedChatModel}
          selectedVisibilityType={selectedVisibilityType}
          isReadonly={isReadonly}
          session={session}
        />

        <Messages
          chatId={id}
          status={status}
          votes={votes}
          messages={messages}
          setMessages={setMessages}
          reload={reload}
          isReadonly={isReadonly}
          isArtifactVisible={isArtifactVisible}
        />

        <div className="flex mx-auto px-4 bg-background pb-4 md:pb-6 gap-2 w-full md:max-w-3xl">
          {!isReadonly && (
            <MultimodalInput
              chatId={id}
              input={input}
              setInput={setInput}
              handleSubmit={handleSubmit}
              status={status}
              stop={stop}
              attachments={attachments}
              setAttachments={setAttachments}
              messages={messages}
              setMessages={setMessages}
              append={append}
            />
          )}
        </div>
      </div>

      <Artifact
        chatId={id}
        input={input}
        setInput={setInput}
        handleSubmit={handleSubmit}
        status={status}
        stop={stop}
        attachments={attachments}
        setAttachments={setAttachments}
        append={append}
        messages={messages}
        setMessages={setMessages}
        reload={reload}
        votes={votes}
        isReadonly={isReadonly}
      />
    </>
  );
}
