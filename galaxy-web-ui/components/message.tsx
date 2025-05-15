'use client';

import type { UIMessage } from 'ai';
import cx from 'classnames';
import { AnimatePresence, motion } from 'framer-motion';
import { memo, useState, useEffect, useRef } from 'react';
import type { Vote } from '@/lib/db/schema';
import { DocumentToolCall, DocumentToolResult } from './document';
import { SparklesIcon } from './icons';
import { Markdown } from './markdown';
import { MessageActions } from './message-actions';
import { PreviewAttachment } from './preview-attachment';
import { Weather } from './weather';
import equal from 'fast-deep-equal';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { DocumentPreview } from './document-preview';
import { MessageReasoning } from './message-reasoning';
import type { UseChatHelpers } from '@ai-sdk/react';
import { ChatImageGallery } from './chat-image';
import type { ImageData } from '@/lib/ai';
import { extractImagesFromText } from '@/lib/ai';

// 메시지 속성에 이미지 배열 추가
interface MessageWithImages extends UIMessage {
  images?: ImageData[];
  imageBlocks?: string[];
}

// 디버깅 상수
const DEBUG_MESSAGE_IMAGES = true;

// 텍스트에서 이미지를 자동으로 추출하는 컴포넌트
interface AutoExtractImagesProps {
  messageContent: string;
  imageBlocks?: string[];
}

const AutoExtractImages = ({ messageContent, imageBlocks }: AutoExtractImagesProps) => {
  const [extractedImages, setExtractedImages] = useState<ImageData[]>([]);
  const [isExtracted, setIsExtracted] = useState(false);
  const messageContentRef = useRef(messageContent);
  
  useEffect(() => {
    // 새로운 메시지 내용이 들어오면 재추출 필요
    if (messageContent !== messageContentRef.current) {
      setIsExtracted(false);
      messageContentRef.current = messageContent;
    }
    
    if (isExtracted) return;
    
    try {
      console.log('자동 이미지 추출 시도...');
      let images: ImageData[] = [];
      
      // 1. 이미지 블록이 있는 경우 우선 처리 (더 정확한 결과)
      if (imageBlocks && imageBlocks.length > 0) {
        console.log('이미지 블록에서 이미지 추출 시도:', imageBlocks.length);
        
        // 모든 이미지 블록을 하나의 텍스트로 결합하여 처리
        const combinedBlockText = imageBlocks.join('\n\n');
        const blockImages = extractImagesFromText(combinedBlockText);
        
        if (blockImages.length > 0) {
          // 중복 제거하며 추가
          blockImages.forEach(img => {
            if (!images.some(existing => existing.url === img.url)) {
              // 이미지 URL 검증 - 존재하는 타입인지 확인
              let validUrl = img.url;
              if (validUrl.includes('galaxy_s25_screen_')) {
                // screen 타입이 있으면 figure로 대체
                validUrl = validUrl.replace('galaxy_s25_screen_', 'galaxy_s25_figure_');
                console.log('이미지 타입 수정 (screen -> figure):', validUrl);
              } else if (validUrl.includes('galaxy_s25_diagram_')) {
                // diagram 타입이 있으면 figure로 대체
                validUrl = validUrl.replace('galaxy_s25_diagram_', 'galaxy_s25_figure_');
                console.log('이미지 타입 수정 (diagram -> figure):', validUrl);
              }
              
              // 캐시 버스팅을 위한 타임스탬프 추가
              const urlWithTimestamp = validUrl.includes('?') 
                ? `${validUrl}&t=${Date.now()}` 
                : `${validUrl}?t=${Date.now()}`;
                
              images.push({
                ...img,
                url: urlWithTimestamp
              });
            }
          });
        }
        
        console.log('이미지 블록에서 추출된 이미지:', images.length);
      }
      
      // 2. 이미지 블록에서 추출 실패 또는 이미지 블록이 없는 경우 전체 컨텐츠에서 추출 시도
      if (images.length === 0 && messageContent) {
        console.log('전체 메시지에서 이미지 추출 시도');
        const contentImages = extractImagesFromText(messageContent);
        
        // 이미지 타입 검증 및 캐시 버스팅
        contentImages.forEach(img => {
          let validUrl = img.url;
          
          // 이미지 타입 검사 및 대체
          if (validUrl.includes('galaxy_s25_screen_')) {
            validUrl = validUrl.replace('galaxy_s25_screen_', 'galaxy_s25_figure_');
            console.log('이미지 타입 수정 (screen -> figure):', validUrl);
          } else if (validUrl.includes('galaxy_s25_diagram_')) {
            validUrl = validUrl.replace('galaxy_s25_diagram_', 'galaxy_s25_figure_');
            console.log('이미지 타입 수정 (diagram -> figure):', validUrl);
          }
          
          // 잘못된 이미지 타입 수정 (다른 타입들도 검사)
          ['dual', 'mode', 'single', 'take'].forEach(invalidType => {
            if (validUrl.includes(`galaxy_s25_${invalidType}_`)) {
              validUrl = validUrl.replace(`galaxy_s25_${invalidType}_`, 'galaxy_s25_figure_');
              console.log(`이미지 타입 수정 (${invalidType} -> figure):`, validUrl);
            }
          });
          
          // URL 끝의 물음표 제거
          if (validUrl.endsWith('?')) {
            validUrl = validUrl.slice(0, -1);
            console.log('URL 끝 물음표 제거:', validUrl);
          }
          
          // 캐시 버스팅을 위한 타임스탬프 추가
          const urlWithTimestamp = validUrl.includes('?') 
            ? `${validUrl}&t=${Date.now()}` 
            : `${validUrl}?t=${Date.now()}`;
            
          // 중복 확인 후 추가
          if (!images.some(existing => existing.url.split('?')[0] === urlWithTimestamp.split('?')[0])) {
            images.push({
              ...img,
              url: urlWithTimestamp
            });
          }
        });
      }
      
      setExtractedImages(images);
      setIsExtracted(true);
      console.log(`자동 추출된 이미지: ${images.length}개`);
      
      if (images.length > 0) {
        console.log('추출된 이미지 목록:');
        images.forEach((img, idx) => {
          console.log(`이미지 #${idx+1}: ${img.url.substring(0, 100)}...`);
        });
      }
    } catch (error) {
      console.error('이미지 자동 추출 중 오류:', error);
      setIsExtracted(true);
    }
  }, [messageContent, imageBlocks, isExtracted]);
  
  if (!extractedImages || extractedImages.length === 0) return null;
  
  return (
    <div className="mt-2">
      {DEBUG_MESSAGE_IMAGES && (
        <div className="bg-amber-50 p-2 rounded-md mb-2 text-xs">
          자동 추출된 이미지 {extractedImages.length}개
        </div>
      )}
      <ChatImageGallery images={extractedImages} />
    </div>
  );
};

const PurePreviewMessage = ({
  chatId,
  message,
  vote,
  isLoading,
  setMessages,
  reload,
  isReadonly,
  messageIndex,
  isActive = false,
}: {
  chatId: string;
  message: MessageWithImages;
  vote: Vote | undefined;
  isLoading: boolean;
  setMessages: UseChatHelpers['setMessages'];
  reload: UseChatHelpers['reload'];
  isReadonly: boolean;
  messageIndex?: number;
  isActive?: boolean;
}) => {
  const messageRef = useRef<HTMLDivElement>(null);
  
  // 디버깅을 위한 로그
  useEffect(() => {
    if (message?.role === 'assistant' && DEBUG_MESSAGE_IMAGES) {
      console.log('메시지 디버깅 - ID:', message.id);
      console.log('메시지 역할:', message.role);
      console.log('내용 길이:', message.content?.length || 0);
      console.log('활성 대화 여부:', isActive);
      
      // [object Object] 오류 감지
      if (message.content === '[object Object]') {
        console.error('❌ 오류 감지: 메시지 내용이 [object Object]입니다!');
        console.error('이 오류는 객체가 문자열로 제대로 변환되지 않아 발생합니다.');
        console.error('메시지 구조:', message);
      }
      
      // 이미지 정보 로깅
      if (message.images && message.images.length > 0) {
        console.log('메시지에 이미지 배열 있음:', message.images.length);
        message.images.forEach((img, idx) => {
          console.log(`이미지 #${idx+1} URL:`, img.url);
        });
      } else {
        console.log('메시지에 이미지 배열 없음');
      }
    }
  }, [message, isActive]);

  return (
    <AnimatePresence>
      <motion.div
        data-testid={`message-${message.role}`}
        className="w-full mx-auto max-w-3xl px-4 group/message"
        initial={{ y: 5, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        data-role={message.role}
        ref={messageRef}
      >
        <div
          className={cn(
            'flex gap-4 w-full group-data-[role=user]/message:ml-auto group-data-[role=user]/message:max-w-2xl',
            {
              'w-full': false,
              'group-data-[role=user]/message:w-fit': true,
            },
          )}
        >
          {message.role === 'assistant' && (
            <div className="size-8 flex items-center rounded-full justify-center ring-1 shrink-0 ring-border bg-gradient-to-br from-galaxy-purple to-galaxy-pink text-white shadow-galaxy-message">
              <div className="translate-y-px">
                <SparklesIcon size={14} />
              </div>
            </div>
          )}

          <div className="flex flex-col gap-4 w-full">
            {message.parts?.map((part, index) => {
              const { type } = part;
              const key = `message-${message.id}-part-${index}`;

              if (type === 'reasoning') {
                return (
                  <MessageReasoning
                    key={key}
                    isLoading={isLoading}
                    reasoning={part.reasoning}
                  />
                );
              }

              if (type === 'text') {
                return (
                  <div key={key} className="flex flex-row gap-2 items-start">
                    <div
                      data-testid="message-content"
                      className={cn('flex flex-col gap-4 w-full', {
                        'bg-gradient-to-br from-galaxy-blue-light to-galaxy-blue text-white px-4 py-3 rounded-2xl shadow-galaxy-message transition-transform hover:scale-[1.01] duration-200':
                          message.role === 'user',
                        'bg-gradient-to-br from-white via-galaxy-light to-galaxy-gray border border-galaxy-light px-4 py-3 rounded-2xl shadow-galaxy-message hover:shadow-galaxy-hover transition-all duration-200':
                          message.role === 'assistant',
                      })}
                    >
                      {message.role === 'user' ? (
                        <div className="whitespace-normal break-words">{part.text}</div>
                      ) : (
                        <Markdown>{part.text}</Markdown>
                      )}
                    </div>
                  </div>
                );
              }

              if (type === 'tool-invocation') {
                const { toolInvocation } = part;
                const { toolName, toolCallId, state } = toolInvocation;

                if (state === 'call') {
                  const { args } = toolInvocation;

                  return (
                    <div
                      key={toolCallId}
                      className={cx({
                        skeleton: ['getWeather'].includes(toolName),
                        'rounded-xl overflow-hidden shadow-galaxy-message border border-galaxy-light p-2 bg-galaxy-light/30 transition-all duration-200': true,
                      })}
                    >
                      {toolName === 'getWeather' ? (
                        <Weather />
                      ) : toolName === 'createDocument' ? (
                        <DocumentPreview isReadonly={isReadonly} args={args} />
                      ) : toolName === 'updateDocument' ? (
                        <DocumentToolCall
                          type="update"
                          args={args}
                          isReadonly={isReadonly}
                        />
                      ) : toolName === 'requestSuggestions' ? (
                        <DocumentToolCall
                          type="request-suggestions"
                          args={args}
                          isReadonly={isReadonly}
                        />
                      ) : null}
                    </div>
                  );
                }

                if (state === 'result') {
                  const { result } = toolInvocation;

                  return (
                    <div key={toolCallId} className="rounded-xl overflow-hidden shadow-galaxy-message border border-galaxy-light p-2 bg-galaxy-light/30 transition-all duration-200">
                      {toolName === 'getWeather' ? (
                        <Weather weatherAtLocation={result} />
                      ) : toolName === 'createDocument' ? (
                        <DocumentPreview
                          isReadonly={isReadonly}
                          result={result}
                        />
                      ) : toolName === 'updateDocument' ? (
                        <DocumentToolResult
                          type="update"
                          result={result}
                          isReadonly={isReadonly}
                        />
                      ) : toolName === 'requestSuggestions' ? (
                        <DocumentToolResult
                          type="request-suggestions"
                          result={result}
                          isReadonly={isReadonly}
                        />
                      ) : (
                        <pre className="bg-galaxy-gray/50 p-2 rounded-md font-mono text-sm overflow-auto">{JSON.stringify(result, null, 2)}</pre>
                      )}
                    </div>
                  );
                }
              }

              return null;
            })}
            
            {/* parts가 없는 경우 content를 사용하여 표시 */}
            {(!message.parts || message.parts.length === 0) && message.content && (
              <div className="flex flex-row gap-2 items-start">
                <div
                  data-testid="message-content-fallback"
                  className={cn('flex flex-col gap-4 w-full', {
                    'bg-gradient-to-br from-galaxy-blue-light to-galaxy-blue text-white px-4 py-3 rounded-2xl shadow-galaxy-message transition-transform hover:scale-[1.01] duration-200':
                      message.role === 'user',
                    'bg-gradient-to-br from-white via-galaxy-light to-galaxy-gray border border-galaxy-light px-4 py-3 rounded-2xl shadow-galaxy-message hover:shadow-galaxy-hover transition-all duration-200':
                      message.role === 'assistant',
                  })}
                >
                  {message.role === 'user' ? (
                    <div className="whitespace-normal break-words">{message.content}</div>
                  ) : (
                    <Markdown>{message.content}</Markdown>
                  )}
                </div>
              </div>
            )}
            
            {!isReadonly && (
              <MessageActions
                key={`action-${message.id}`}
                chatId={chatId}
                message={message}
                vote={vote}
                isLoading={isLoading}
                messageIndex={messageIndex}
              />
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default memo(PurePreviewMessage);

// 이름 있는 export로 수정하여 외부에서 사용할 수 있게 함
export const PreviewMessage = memo(PurePreviewMessage, (prev, next) => {
  return (
    prev.message.id === next.message.id &&
    equal(prev.message.content, next.message.content) &&
    equal(prev.message.parts, next.message.parts) &&
    equal(prev.vote, next.vote) &&
    prev.isLoading === next.isLoading &&
    equal(prev.message.images, next.message.images) &&
    equal(prev.message.imageBlocks, next.message.imageBlocks)
  );
});

export const ThinkingMessage = () => {
  return (
    <div className="w-full mx-auto max-w-3xl px-4">
      <div className="flex gap-4">
        <div className="size-8 flex items-center rounded-full justify-center ring-1 shrink-0 ring-border bg-gradient-to-br from-galaxy-purple to-galaxy-pink text-white animate-pulse">
          <div className="translate-y-px">
            <SparklesIcon size={14} />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex gap-1 items-center">
            <div className="size-2 bg-galaxy-blue animate-bounce rounded-full" />
            <div className="size-2 bg-galaxy-blue animate-bounce rounded-full [animation-delay:0.2s]" />
            <div className="size-2 bg-galaxy-blue animate-bounce rounded-full [animation-delay:0.4s]" />
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * 모든 이미지 패턴과 URL을 추출하는 함수
 * 백엔드에서 제공하는 여러 이미지 패턴([이미지 1], [이미지 2] 등)을 모두 찾습니다.
 */
function extractAllImagePatterns(text: string): ImageData[] {
  if (!text) return [];
  
  console.log('모든 이미지 패턴 추출 시작 - 텍스트 길이:', text.length);
  const images: ImageData[] = [];
  const addedUrls = new Set<string>();
  
  // 패턴 1: [이미지 숫자] 다음 줄에 URL이 오는 패턴 (괄호와 줄바꿈 제거 추가)
  const pattern1 = /\[이미지\s*(\d+)\](?:.*?)(?:\n|\r\n)?(?:\s*\(?\s*\n?\s*)(https?:\/\/[^\s\n\(\)]+|[^\s\n\(\)]+\.(?:jpg|jpeg|png|gif|webp))(?:\s*\n?\s*\)?\s*)/gi;
  
  // 패턴 2: [이미지 숫자] 문자열 내에 URL이 직접 포함된 패턴
  const pattern2 = /\[이미지\s*(\d+)\]\s*(?:\(?\s*)(https?:\/\/[^\s\n\(\)]+|[^\s\n\(\)]+\.(?:jpg|jpeg|png|gif|webp))(?:\s*\)?)/gi;
  
  // 패턴 3: 일반 URL 패턴 (이미지 확장자로 끝나는)
  const pattern3 = /(?:\(?\s*)(https?:\/\/[^\s\n\(\)]+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s\n\(\)]*?)?)(?:\s*\)?)/gi;
  
  // 패턴 4: 마크다운 이미지 패턴 ![alt](url)
  const pattern4 = /!\[[^\]]*\]\((?:\s*)(https?:\/\/[^\s\n\)]+|[^\s\n\)]+\.(?:jpg|jpeg|png|gif|webp))(?:\s*)\)/gi;
  
  // 패턴 1 적용
  let match;
  while ((match = pattern1.exec(text)) !== null) {
    try {
      const imageNum = match[1];
      let imageUrl = match[2].trim();
      
      // URL 정규화
      imageUrl = normalizeImageUrl(imageUrl);
      
      console.log(`패턴1 매치: 이미지 ${imageNum}, URL: ${imageUrl.substring(0, 50)}...`);
      
      if (!addedUrls.has(imageUrl)) {
        images.push({
          url: imageUrl,
          page: imageNum,
          relevance_score: 0.9
        });
        addedUrls.add(imageUrl);
      }
    } catch (error) {
      console.error('패턴1 처리 중 오류:', error);
    }
  }
  
  // 패턴 2 적용
  while ((match = pattern2.exec(text)) !== null) {
    try {
      const imageNum = match[1];
      let imageUrl = match[2].trim();
      
      // URL 정규화
      imageUrl = normalizeImageUrl(imageUrl);
      
      console.log(`패턴2 매치: 이미지 ${imageNum}, URL: ${imageUrl.substring(0, 50)}...`);
      
      if (!addedUrls.has(imageUrl)) {
        images.push({
          url: imageUrl,
          page: imageNum,
          relevance_score: 0.9
        });
        addedUrls.add(imageUrl);
      }
    } catch (error) {
      console.error('패턴2 처리 중 오류:', error);
    }
  }
  
  // 패턴 3 적용
  while ((match = pattern3.exec(text)) !== null) {
    try {
      let imageUrl = match[1].trim();
      
      // URL 정규화
      imageUrl = normalizeImageUrl(imageUrl);
      
      console.log(`패턴3 매치: URL: ${imageUrl.substring(0, 50)}...`);
      
      if (!addedUrls.has(imageUrl)) {
        images.push({
          url: imageUrl,
          page: '1', // 기본 페이지 번호
          relevance_score: 0.7
        });
        addedUrls.add(imageUrl);
      }
    } catch (error) {
      console.error('패턴3 처리 중 오류:', error);
    }
  }
  
  // 패턴 4 적용 (마크다운 이미지)
  while ((match = pattern4.exec(text)) !== null) {
    try {
      let imageUrl = match[1].trim();
      
      // URL 정규화
      imageUrl = normalizeImageUrl(imageUrl);
      
      console.log(`패턴4 매치: URL: ${imageUrl.substring(0, 50)}...`);
      
      if (!addedUrls.has(imageUrl)) {
        images.push({
          url: imageUrl,
          page: '1',
          relevance_score: 0.8
        });
        addedUrls.add(imageUrl);
      }
    } catch (error) {
      console.error('패턴4 처리 중 오류:', error);
    }
  }
  
  // 발견된 이미지 로깅
  console.log(`총 발견된 고유 이미지 URL: ${images.length}`);
  images.forEach((img, idx) => {
    console.log(`  발견된 이미지 ${idx+1}: ${img.url.substring(0, 50)}... (페이지: ${img.page})`);
  });
  
  return images;
}

/**
 * 이미지 URL을 정규화하는 함수
 */
function normalizeImageUrl(url: string): string {
  // 괄호와 공백 제거
  url = url.trim().replace(/^\(+|\)+$/g, '');
  
  // URL이 Supabase 파일명만 있는 경우, 전체 URL로 변환
  if (!url.startsWith('http') && 
      (url.includes('galaxy_s25_') || url.endsWith('.jpg') || url.endsWith('.png'))) {
    url = `https://ywvoksfszaelkceectaa.supabase.co/storage/v1/object/public/images/${url}`;
  }
  
  // 잘못된 이미지 타입 수정
  ['screen', 'diagram', 'dual', 'mode', 'single', 'take'].forEach(invalidType => {
    if (url.includes(`galaxy_s25_${invalidType}_`)) {
      url = url.replace(`galaxy_s25_${invalidType}_`, 'galaxy_s25_figure_');
    }
  });
  
  return url;
}