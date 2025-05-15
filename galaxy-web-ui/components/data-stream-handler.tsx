'use client';

import { useChat } from '@ai-sdk/react';
import { useEffect, useRef, useState, useCallback } from 'react';
import { artifactDefinitions, type ArtifactKind } from './artifact';
import type { Suggestion } from '@/lib/db/schema';
import { initialArtifactData, useArtifact } from '@/hooks/use-artifact';
import type { ImageData } from '@/lib/ai';
import { extractImagesFromText } from '@/lib/ai';
import type { Message } from 'ai';

// 메시지 타입 확장: 이미지 배열 속성 추가
interface MessageWithImages extends Message {
  images?: ImageData[];
}

export type DataStreamDelta = {
  type:
    | 'text-delta'
    | 'code-delta'
    | 'sheet-delta'
    | 'image-delta'
    | 'title'
    | 'id'
    | 'suggestion'
    | 'clear'
    | 'finish'
    | 'kind'
    | 'images'
    | 'imageBlocks';
  content: string | Suggestion | ImageData[] | string[];
};

export function DataStreamHandler({ id }: { id: string }) {
  const { data: dataStream, setMessages, messages } = useChat({ id });
  const { artifact, setArtifact, setMetadata } = useArtifact();
  const lastProcessedIndex = useRef(-1);
  const imagesProcessed = useRef(false);
  const [bufferedContent, setBufferedContent] = useState('');
  
  // 이미지 메타데이터 직접 처리 기능
  const processImagesMetadata = useCallback((imageData: ImageData[]) => {
    if (!imageData || imageData.length === 0) return;
    
    console.log('이미지 메타데이터 수신:', imageData.length);
    
    // 이미지 URL 정리 및 타입 수정
    const processedImageData = imageData.map(img => {
      if (!img.url) return img;
      
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
      
      return {
        ...img,
        url: validUrl
      };
    });
    
    setMessages((prevMessages) => {
      const updatedMessages = [...prevMessages];
      const lastIndex = updatedMessages.length - 1;
      
      if (lastIndex >= 0) {
        // 이미 이미지가 있는 경우 추가, 없으면 새로 설정
        // 타입 캐스팅을 통해 TypeScript 오류 해결
        const lastMsg = updatedMessages[lastIndex] as MessageWithImages;
        const existingImages = lastMsg.images || [];
        const newImages = [...existingImages];
        
        // 중복 제거하며 새 이미지 추가
        processedImageData.forEach(newImg => {
          if (!newImages.some(img => img.url === newImg.url)) {
            newImages.push(newImg);
          }
        });
        
        // 타입 단언을 통해 images 속성 할당
        updatedMessages[lastIndex] = {
          ...updatedMessages[lastIndex],
          images: newImages
        } as MessageWithImages;
        
        console.log('메시지에 이미지 메타데이터 추가됨:', newImages.length);
      }
      
      return updatedMessages;
    });
    
    imagesProcessed.current = true;
  }, [setMessages]);

  // 마지막 메시지에서 이미지 추출
  const processLastMessage = useCallback(() => {
    if (!messages || messages.length === 0 || imagesProcessed.current) return;
    
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role !== 'assistant' || !lastMessage.content) return;
    
    try {
      console.log('마지막 메시지에서 이미지 패턴 확인 시도...');
      console.log('메시지 내용 일부:', lastMessage.content.substring(0, 100));
      
      const hasImagePattern = lastMessage.content.includes('[이미지');
      const hasSupabaseUrl = lastMessage.content.includes('ywvoksfszaelkceectaa.supabase.co');
      // 갤럭시 이미지 파일명 패턴 확인
      const hasGalaxyFilePattern = /galaxy_s25_[a-z]+_p(\d+)_(?:top|mid|bot)_[a-f0-9]+\.jpg/i.test(lastMessage.content);
      
      if (hasImagePattern || hasSupabaseUrl || hasGalaxyFilePattern) {
        console.log('이미지 패턴 발견, 이미지 추출 시도');
        const extractedImages = extractImagesFromText(lastMessage.content);
        
        if (extractedImages && extractedImages.length > 0) {
          console.log('이미지 추출 성공:', extractedImages.length);
          
          setMessages((prevMessages) => {
            const updatedMessages = [...prevMessages];
            const lastIndex = updatedMessages.length - 1;
            
            if (lastIndex >= 0) {
              // 이미 이미지가 있는 경우 병합, 없으면 새로 설정
              // 타입 캐스팅을 통해 TypeScript 오류 해결
              const lastMsg = updatedMessages[lastIndex] as MessageWithImages;
              const existingImages = lastMsg.images || [];
              
              // 중복 URL 확인 및 병합
              const mergedImages = [...existingImages];
              extractedImages.forEach(newImg => {
                if (!mergedImages.some(img => img.url === newImg.url)) {
                  mergedImages.push(newImg);
                }
              });
              
              // 타입 단언을 통해 images 속성 할당
              updatedMessages[lastIndex] = {
                ...updatedMessages[lastIndex],
                images: mergedImages
              } as MessageWithImages;
              
              console.log('최종 이미지 개수:', mergedImages.length);
            }
            
            return updatedMessages;
          });
          
          imagesProcessed.current = true;
        }
      }
    } catch (error) {
      console.error('이미지 추출 중 오류:', error);
    }
  }, [messages, setMessages]);

  // 스트림 데이터 처리
  useEffect(() => {
    if (!dataStream?.length) return;

    const newDeltas = dataStream.slice(lastProcessedIndex.current + 1);
    lastProcessedIndex.current = dataStream.length - 1;

    (newDeltas as DataStreamDelta[]).forEach((delta: DataStreamDelta) => {
      const artifactDefinition = artifactDefinitions.find(
        (artifactDefinition) => artifactDefinition.kind === artifact.kind,
      );

      if (artifactDefinition?.onStreamPart) {
        artifactDefinition.onStreamPart({
          streamPart: delta,
          setArtifact,
          setMetadata,
        });
      }

      // 텍스트 델타 버퍼링
      if (delta.type === 'text-delta' && typeof delta.content === 'string') {
        setBufferedContent(prev => prev + delta.content);
      }
      
      // 이미지 블록 처리 - 이미지 패턴이 포함된 블록 전체를 한번에 처리
      if (delta.type === 'imageBlocks' && Array.isArray(delta.content)) {
        console.log('이미지 블록 데이터 발견:', delta.content.length);
        
        // 이미지 블록에서 이미지 추출
        const blockTexts = delta.content as string[];  // 명시적 타입 캐스팅
        const extractedFromBlocks: ImageData[] = [];
        
        blockTexts.forEach(blockText => {
          try {
            const blockImages = extractImagesFromText(blockText);
            if (blockImages.length > 0) {
              extractedFromBlocks.push(...blockImages);
            }
          } catch (error) {
            console.error('이미지 블록 처리 오류:', error);
          }
        });
        
        if (extractedFromBlocks.length > 0) {
          console.log('이미지 블록에서 추출 성공:', extractedFromBlocks.length);
          processImagesMetadata(extractedFromBlocks);
        }
      }
      
      // 이미지 메타데이터 처리
      if (delta.type === 'images' && Array.isArray(delta.content)) {
        console.log('이미지 메타데이터 델타 발견');
        processImagesMetadata(delta.content as ImageData[]);
      }

      // 스트리밍이 종료될 때 이미지 처리
      if (delta.type === 'finish') {
        console.log('스트리밍 종료, 최종 이미지 처리 시작');
        processLastMessage();
      }

      setArtifact((draftArtifact) => {
        if (!draftArtifact) {
          return { ...initialArtifactData, status: 'streaming' };
        }

        switch (delta.type) {
          case 'id':
            return {
              ...draftArtifact,
              documentId: delta.content as string,
              status: 'streaming',
            };

          case 'title':
            return {
              ...draftArtifact,
              title: delta.content as string,
              status: 'streaming',
            };

          case 'kind':
            return {
              ...draftArtifact,
              kind: delta.content as ArtifactKind,
              status: 'streaming',
            };

          case 'clear':
            return {
              ...draftArtifact,
              content: '',
              status: 'streaming',
            };

          case 'finish':
            return {
              ...draftArtifact,
              status: 'idle',
            };

          default:
            return draftArtifact;
        }
      });
    });
  }, [dataStream, setArtifact, setMetadata, artifact, setMessages, processImagesMetadata, processLastMessage]);

  // 메시지 변경 감지 및 이미지 처리
  useEffect(() => {
    if (messages.length > 0 && !imagesProcessed.current) {
      // 최종 메시지 처리 - 스트리밍이 완료된 후 한번 더 확인
      setTimeout(() => {
        processLastMessage();
      }, 500); // 500ms 지연으로 스트리밍이 완전히 끝나길 기다림
    }
  }, [messages, processLastMessage]);

  return null;
}
