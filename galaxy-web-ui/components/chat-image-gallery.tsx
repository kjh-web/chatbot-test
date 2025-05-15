'use client';

import { useEffect } from 'react';
import type { ImageData } from '@/lib/ai';
import { ChatImage } from './chat-image';

// 디버깅 상수
const DEBUG_IMAGE_GALLERY = true;

export function ChatImageGallery({ images }: { images: ImageData[] }) {
  // 갤러리 컴포넌트 마운트/업데이트 시 이미지 확인
  useEffect(() => {
    if (DEBUG_IMAGE_GALLERY) {
      console.log('🖼️🖼️🖼️ ChatImageGallery 컴포넌트 마운트됨', {
        imageCount: images?.length || 0,
      });
      
      if (images && images.length > 0) {
        console.log('📋 이미지 목록 (gallery):');
        images.forEach((img, idx) => {
          console.log(`  🖼️ 이미지 ${idx + 1}:`, {
            url: img.url.split('?')[0], // 캐시 버스팅 매개변수 제거
            page: img.page || '알 수 없음',
            score: img.relevance_score || 0
          });
        });
      } else {
        console.log('⚠️ 이미지가 없거나 빈 배열 (gallery)');
      }
    }
  }, [images]);

  // 이미지가 없는 경우 early return
  if (!images || images.length === 0) {
    if (DEBUG_IMAGE_GALLERY) {
      console.log('⚠️ 이미지가 없어 ChatImageGallery가 렌더링되지 않음');
    }
    return null;
  }
  
  // 이미지 URL이 없는 항목 필터링
  const validImages = images.filter(img => !!img.url);
  
  if (validImages.length !== images.length) {
    console.log(`⚠️ 유효하지 않은 이미지 ${images.length - validImages.length}개 필터링됨`);
  }
  
  if (validImages.length === 0) {
    console.log('⚠️ 유효한 이미지가 없어 ChatImageGallery가 렌더링되지 않음');
    return null;
  }
  
  console.log(`🖼️ 렌더링: 이미지 갤러리 (${validImages.length}개)`);
  
  return (
    <div className="flex flex-col gap-4 mt-4 w-full">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {validImages.map((image, index) => (
          <ChatImage key={`${image.url.split('?')[0]}-${index}`} image={image} />
        ))}
      </div>
    </div>
  );
} 