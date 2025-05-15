'use client';

import type { Attachment, UIMessage } from 'ai';
import cx from 'classnames';
import type React from 'react';
import {
  useRef,
  useEffect,
  useState,
  useCallback,
  type Dispatch,
  type SetStateAction,
  type ChangeEvent,
  memo,
} from 'react';
import { toast } from 'sonner';
import { useLocalStorage, useWindowSize } from 'usehooks-ts';

import { ArrowUpIcon, StopIcon } from './icons';
import { PreviewAttachment } from './preview-attachment';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { SuggestedActions } from './suggested-actions';
import equal from 'fast-deep-equal';
import type { UseChatHelpers } from '@ai-sdk/react';
import { cn } from '@/lib/utils';

function PureMultimodalInput({
  chatId,
  input,
  setInput,
  status,
  stop,
  attachments,
  setAttachments,
  messages,
  setMessages,
  append,
  handleSubmit,
  className,
}: {
  chatId: string;
  input: UseChatHelpers['input'];
  setInput: UseChatHelpers['setInput'];
  status: UseChatHelpers['status'];
  stop: () => void;
  attachments: Array<Attachment>;
  setAttachments: Dispatch<SetStateAction<Array<Attachment>>>;
  messages: Array<UIMessage>;
  setMessages: UseChatHelpers['setMessages'];
  append: UseChatHelpers['append'];
  handleSubmit: UseChatHelpers['handleSubmit'];
  className?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { width } = useWindowSize();

  useEffect(() => {
    if (textareaRef.current) {
      adjustHeight();
    }
  }, []);

  const adjustHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight + 2}px`;
    }
  };

  const resetHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = '98px';
    }
  };

  const [localStorageInput, setLocalStorageInput] = useLocalStorage(
    'input',
    '',
  );

  useEffect(() => {
    if (textareaRef.current) {
      const domValue = textareaRef.current.value;
      // Prefer DOM value over localStorage to handle hydration
      const finalValue = domValue || localStorageInput || '';
      setInput(finalValue);
      adjustHeight();
    }
    // Only run once after hydration
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setLocalStorageInput(input);
  }, [input, setLocalStorageInput]);

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);
    adjustHeight();
  };

  const [uploadQueue, setUploadQueue] = useState<Array<string>>([]);

  const submitForm = useCallback(() => {
    // 입력값에 불필요한 공백과 줄바꿈 제거 (양쪽 끝 및 중복 공백/줄바꿈)
    const trimmedInput = input.trim().replace(/\s+/g, ' ');

    // 정리된 입력값으로 메시지 전송
    handleSubmit(undefined, {
      experimental_attachments: attachments,
      data: {
        content: trimmedInput // 정리된 입력값 사용
      }
    });

    setAttachments([]);
    setLocalStorageInput('');
    resetHeight();

    if (width && width > 768) {
      textareaRef.current?.focus();
    }
  }, [
    attachments,
    handleSubmit,
    setAttachments,
    setLocalStorageInput,
    width,
    chatId,
    input // input 의존성 추가
  ]);

  // 전역 접근을 위한 함수 추가
  useEffect(() => {
    // @ts-ignore
    window.submitGalaxyForm = submitForm;
    
    // 샘플 질문 선택 이벤트 리스너 추가
    const handleQuestionSelected = (e: any) => {
      if (e.detail && e.detail.question) {
        const questionText = e.detail.question;
        // 입력 설정
        setInput(questionText);
        
        // 약간의 지연 후 폼 제출
        setTimeout(() => {
          submitForm();
        }, 100);
      }
    };
    
    window.addEventListener('galaxy:question-selected', handleQuestionSelected);
    
    return () => {
      // @ts-ignore
      delete window.submitGalaxyForm;
      window.removeEventListener('galaxy:question-selected', handleQuestionSelected);
    };
  }, [submitForm, setInput]);

  return (
    <div className="relative w-full flex flex-col gap-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitForm();
        }}
        className="relative"
      >
        <div className="flex items-center relative">
          <Textarea
            ref={textareaRef}
            data-testid="multimodal-input"
            tabIndex={0}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                submitForm();
              }
            }}
            placeholder="메시지 입력..."
            value={input}
            onChange={handleInput}
            className="min-h-[58px] rounded-2xl pr-12 border-galaxy-light/70 focus:border-galaxy-blue focus:ring-1 focus:ring-galaxy-blue/50 shadow-galaxy transition-all duration-200 resize-none bg-white placeholder:text-gray-400"
            disabled={
              status === 'streaming' ||
              status === 'submitted' ||
              uploadQueue.length > 0
            }
          />
        </div>

        <div className="absolute flex gap-1.5 items-center right-2 bottom-2.5">
          {status === 'streaming' ? (
            <PureStopButton stop={stop} setMessages={setMessages} />
          ) : (
            <PureSendButton
              submitForm={submitForm}
              input={input}
              uploadQueue={uploadQueue}
            />
          )}
        </div>
      </form>

      {input === '' &&
        status !== 'streaming' &&
        messages.length > 0 &&
        messages[messages.length - 1].role === 'assistant' && (
          <SuggestedActions chatId={chatId} append={append} />
        )}
    </div>
  );
}

export const MultimodalInput = memo(PureMultimodalInput, (prevProps, nextProps) => {
  if (prevProps.status !== nextProps.status) return false;
  if (prevProps.input !== nextProps.input) return false;
  if (!equal(prevProps.attachments, nextProps.attachments)) return false;
  if (!equal(prevProps.messages, nextProps.messages)) return false;
  return true;
});

function PureStopButton({
  stop,
  setMessages,
}: {
  stop: () => void;
  setMessages: UseChatHelpers['setMessages'];
}) {
  return (
    <Button
      type="button"
      size="icon"
      className="size-8 bg-galaxy-red/85 hover:bg-galaxy-red text-white rounded-full shadow-sm hover:shadow-md transition-all duration-200"
      onClick={() => {
        stop();
        setMessages((messages) => {
          const lastMessage = messages[messages.length - 1];
          if (lastMessage.role === 'assistant') {
            return messages.slice(0, -1);
          }
          return messages;
        });
      }}
      data-testid="stop-button"
    >
      <StopIcon />
      <span className="sr-only">Stop generating</span>
    </Button>
  );
}

const StopButton = memo(PureStopButton);

function PureSendButton({
  submitForm,
  input,
  uploadQueue,
}: {
  submitForm: () => void;
  input: string;
  uploadQueue: Array<string>;
}) {
  const isEmpty = input.trim().length === 0;
  const isUploading = uploadQueue.length > 0;

  return (
    <Button
      type="submit"
      size="icon"
      data-testid="send-button"
      className={cn(
        'size-8 transition-all duration-300 rounded-full shadow-sm hover:shadow-md',
        isEmpty || isUploading
          ? 'bg-galaxy-blue/40 text-white cursor-not-allowed'
          : 'bg-gradient-to-r from-galaxy-blue to-galaxy-navy text-white hover:from-galaxy-blue-light hover:to-galaxy-blue transform hover:scale-105'
      )}
      disabled={isEmpty || isUploading}
    >
      <ArrowUpIcon />
      <span className="sr-only">Send message</span>
    </Button>
  );
}

const SendButton = memo(PureSendButton, (prevProps, nextProps) => {
  if (prevProps.uploadQueue.length !== nextProps.uploadQueue.length)
    return false;
  if (prevProps.input !== nextProps.input) return false;
  return true;
});
