import type { UIMessage } from 'ai';
import { PreviewMessage, ThinkingMessage } from './message';
import { useScrollToBottom } from './use-scroll-to-bottom';
import { Greeting } from './greeting';
import { memo, Children, type ReactNode, useEffect } from 'react';
import type { Vote } from '@/lib/db/schema';
import equal from 'fast-deep-equal';
import type { UseChatHelpers } from '@ai-sdk/react';

interface MessagesProps {
  chatId: string;
  status: UseChatHelpers['status'];
  votes: Array<Vote> | undefined;
  messages: Array<UIMessage>;
  setMessages: UseChatHelpers['setMessages'];
  reload: UseChatHelpers['reload'];
  isReadonly: boolean;
  isArtifactVisible: boolean;
  children?: ReactNode;
  className?: string;
}

function PureMessages({
  chatId,
  status,
  votes,
  messages,
  setMessages,
  reload,
  isReadonly,
  children,
}: MessagesProps) {
  const [messagesContainerRef, messagesEndRef] =
    useScrollToBottom<HTMLDivElement>();

  // 메시지들 확인을 위한 디버깅 코드 추가
  useEffect(() => {
    // children이 배열인 경우만 처리
    const childrenArray = Children.toArray(children);
    if (childrenArray.length > 0) {
      console.log('메시지 수:', childrenArray.length);
      
      // 마지막 메시지 내용 확인 (AI 응답)
      const lastMessage = childrenArray[childrenArray.length - 1];
      if (lastMessage && typeof lastMessage === 'object' && 'props' in lastMessage) {
        const messageContent = lastMessage.props?.message?.content;
        
        if (messageContent) {
          // [object Object] 문자열 감지 - 잘못된 문자열화
          if (messageContent === '[object Object]') {
            console.error('❌ 오류 감지: 메시지 내용이 [object Object]입니다. 객체가 문자열로 제대로 변환되지 않았습니다.');
          }
          
          // 이미지 패턴 확인
          const textLength = messageContent.length;
          console.log('텍스트 길이:', textLength);
          
          const hasImagePattern = messageContent.includes('[이미지');
          console.log('[이미지] 패턴 존재:', hasImagePattern);
          
          const hasSupabaseUrl = messageContent.includes('ywvoksfszaelkceectaa.supabase.co');
          console.log('Supabase URL 존재:', hasSupabaseUrl);
          
          // 전체 내용 디버깅 (첫 200자)
          if (textLength > 0) {
            console.log('전체 텍스트 길이:', textLength);
            console.log('텍스트 내용 일부:', `${messageContent.substring(0, 200)}...`);
          }
        }
      }
    }
  }, [children]);

  return (
    <div
      ref={messagesContainerRef}
      className="flex flex-col min-w-0 gap-6 flex-1 overflow-y-scroll pt-4"
    >
      {messages.length === 0 && <Greeting />}

      {messages.map((message, index) => {
        // 현재 대화의 활성 여부 확인
        // 1. 마지막 메시지는 항상 현재 활성 대화로 간주
        // 2. 스트리밍 중인 메시지도 활성 대화로 간주
        // boolean 타입 명시적 비교로 변경
        const isActive = 
          index === messages.length - 1 || // 마지막 메시지
          (status === 'streaming' && index === messages.length - 2 && message.role === 'user'); // 스트리밍 중인 응답의 사용자 메시지
        
        // 명시적으로 boolean 타입으로 변환
        const isActiveBoolean = isActive === true;
        
        // 디버깅을 위한 로그 추가
        if (message.role === 'assistant') {
          console.log(`메시지 ${index + 1}/${messages.length}, ID: ${message.id}, 활성 상태: ${isActiveBoolean ? '활성(true)' : '비활성(false)'}`);
          
          // 첨부 파일 있는 경우 로깅
          if (message.experimental_attachments && message.experimental_attachments.length > 0) {
            console.log(`  - 첨부 파일 ${message.experimental_attachments.length}개, 표시여부: ${isActiveBoolean ? '표시' : '숨김'}`);
          }
        }
        
        return (
        <PreviewMessage
          key={message.id}
          chatId={chatId}
          message={message}
          isLoading={status === 'streaming' && messages.length - 1 === index}
          vote={
            votes
              ? votes.find((vote) => vote.messageId === message.id)
              : undefined
          }
          setMessages={setMessages}
          reload={reload}
          isReadonly={isReadonly}
          messageIndex={index}
            isActive={isActiveBoolean} // 현재 활성 대화 여부 전달
        />
        );
      })}

      {status === 'submitted' &&
        messages.length > 0 &&
        messages[messages.length - 1].role === 'user' && <ThinkingMessage />}

      <div
        ref={messagesEndRef}
        className="shrink-0 min-w-[24px] min-h-[24px]"
      />
    </div>
  );
}

export const Messages = memo(PureMessages, (prevProps, nextProps) => {
  if (prevProps.isArtifactVisible && nextProps.isArtifactVisible) return true;

  if (prevProps.status !== nextProps.status) return false;
  if (prevProps.status && nextProps.status) return false;
  if (prevProps.messages.length !== nextProps.messages.length) return false;
  if (!equal(prevProps.messages, nextProps.messages)) return false;
  if (!equal(prevProps.votes, nextProps.votes)) return false;

  return true;
});
