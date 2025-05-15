'use client';

import Image from 'next/image';
import { useState, useEffect, useCallback } from 'react';
import type { ImageData } from '@/lib/ai';
import { cn } from '@/lib/utils';

interface ChatImageProps {
  image: ImageData;
  onImageLoaded?: () => void;
}

// 디버깅 상수
const DEBUG_IMAGE_LOADING = true;

// 이미지 URL을 프록시 URL로 변환하는 함수
function getProxiedImageUrl(url: string): string {
  // 이미지 URL이 없으면 빈 문자열 반환
  if (!url) return '';
  
  // 디버깅 로그
  if (DEBUG_IMAGE_LOADING) {
    console.log('원본 이미지 URL 처리:', url);
  }
  
  // URL이 이미 프록시를 사용하고 있다면 그대로 반환
  if (url.includes('/api/proxy-image')) return url;
  
  try {
    // URL 끝의 괄호 제거 (가장 큰 문제 해결)
    if (url.endsWith(')')) {
      url = url.slice(0, -1);
      if (DEBUG_IMAGE_LOADING) {
        console.log('URL 끝 괄호 제거 후:', url);
      }
    }
    
    // 파일 확장자 뒤 괄호 제거 - 더 정확한 패턴 (.jpg) → .jpg 
    url = url.replace(/(\.(jpg|jpeg|png|gif|webp))\)/gi, '$1');
    if (DEBUG_IMAGE_LOADING) {
      console.log('파일 확장자 뒤 괄호 제거 후:', url);
    }
    
    // URL 끝의 물음표 제거
    if (url.endsWith('?')) {
      url = url.slice(0, -1);
      if (DEBUG_IMAGE_LOADING) {
        console.log('URL 끝 물음표 제거 후:', url);
      }
    }
    
    // 중복 URL 패턴 처리 (같은 URL이 반복되는 경우)
    if (url.includes('https://') && url.lastIndexOf('https://') > 0) {
      // 첫 번째 URL만 사용
      url = url.substring(0, url.lastIndexOf('https://'));
      if (DEBUG_IMAGE_LOADING) {
        console.log('중복 URL 제거 후:', url);
      }
    }
    
    // 잘못된 이미지 타입 수정
    ['screen', 'diagram', 'dual', 'mode', 'single', 'take'].forEach(invalidType => {
      if (url.includes(`galaxy_s25_${invalidType}_`)) {
        url = url.replace(`galaxy_s25_${invalidType}_`, 'galaxy_s25_figure_');
        if (DEBUG_IMAGE_LOADING) {
          console.log(`이미지 타입 수정 (${invalidType} -> figure):`, url);
        }
      }
    });
    
    // URL 인코딩 - 쿼리 파라미터를 보존하기 위해 URL 자체를 인코딩
    const encodedUrl = encodeURIComponent(url);
    // 캐시 버스팅을 위한 타임스탬프 추가
    const proxiedUrl = `/api/proxy-image?url=${encodedUrl}&t=${Date.now()}`;
    
    if (DEBUG_IMAGE_LOADING) {
      console.log('프록시 URL로 변환됨:', proxiedUrl);
    }
    
    return proxiedUrl;
  } catch (error) {
    console.error('URL 처리 중 오류 발생:', error);
    // 오류 발생 시 원본 URL에 프록시 적용
    return `/api/proxy-image?url=${encodeURIComponent(url)}`;
  }
}

// 이미지 로딩 재시도 설정
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1초

export function ChatImage({ image, onImageLoaded }: ChatImageProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // 원본 URL과 프록시 URL 준비
  const originalUrl = image.url;
  const proxiedUrl = getProxiedImageUrl(originalUrl);
  
  // 이미지 로딩 상태 관리
  const [currentUrl, setCurrentUrl] = useState(proxiedUrl);
  const [retryCount, setRetryCount] = useState(0);
  const [loadingStrategy, setLoadingStrategy] = useState<'proxy' | 'original' | 'cache-bust' | 'fallback'>('proxy');
  
  // 이미지 로딩 전략 순서
  const loadingStrategies = [
    { type: 'proxy', url: proxiedUrl },
    { type: 'original', url: originalUrl },
    { type: 'cache-bust', url: `${proxiedUrl}&t=${Date.now()}` },
    { type: 'fallback', url: `/api/image-fallback?url=${encodeURIComponent(originalUrl)}` }
  ];
  
  // 다음 로딩 전략으로 전환
  const switchToNextStrategy = useCallback(() => {
    const currentIndex = loadingStrategies.findIndex(s => s.type === loadingStrategy);
    const nextStrategy = loadingStrategies[currentIndex + 1];
    
    if (nextStrategy) {
      if (DEBUG_IMAGE_LOADING) {
        console.log(`전략 전환: ${loadingStrategy} -> ${nextStrategy.type}`);
      }
      setLoadingStrategy(nextStrategy.type as any);
      setCurrentUrl(nextStrategy.url);
      return true;
    }
    return false;
  }, [loadingStrategy, loadingStrategies]);
  
  // 이미지 로딩 재시도 함수
  const retryLoading = useCallback(async () => {
    if (retryCount >= MAX_RETRIES) {
      setError('이미지를 불러올 수 없습니다.');
      setIsLoading(false);
      return;
    }
    
    // 다음 전략으로 전환 시도
    const hasNextStrategy = switchToNextStrategy();
    if (!hasNextStrategy) {
      // 모든 전략을 시도했으나 실패
      setError('이미지를 불러올 수 없습니다.');
      setIsLoading(false);
      return;
    }
    
    setRetryCount(prev => prev + 1);
    setIsLoading(true);
    setError(null);
    
    // 지연 후 재시도
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
  }, [retryCount, switchToNextStrategy]);
  
  // 이미지 로드 성공 처리
  const handleImageLoad = () => {
    setIsLoading(false);
    setError(null);
    if (DEBUG_IMAGE_LOADING) {
      console.log(`이미지 로드 성공 (${loadingStrategy}):`, currentUrl);
    }
    onImageLoaded?.();
  };
  
  // 이미지 로드 실패 처리
  const handleImageError = async () => {
    if (DEBUG_IMAGE_LOADING) {
      console.log(`이미지 로드 실패 (${loadingStrategy}):`, currentUrl);
    }
    
    // 간단한 재시도 로직만 유지
    if (retryCount >= MAX_RETRIES) {
      setError('이미지를 불러올 수 없습니다.');
      setIsLoading(false);
      return;
    }
    
    await retryLoading();
  };
  
  // 수동 이미지 로드 테스트 함수
  const testImageUrl = async (url: string): Promise<boolean> => {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      console.log(`이미지 테스트 (${url.substring(0, 30)}...): ${response.status} ${response.ok}`);
      return response.ok;
    } catch (error) {
      console.error(`이미지 테스트 실패 (${url.substring(0, 30)}...):`, error);
      return false;
    }
  };
  
  // 컴포넌트 마운트 시 로깅 및 이미지 테스트
  useEffect(() => {
    if (DEBUG_IMAGE_LOADING) {
      console.log('ChatImage 컴포넌트 마운트됨', {
        imageProps: image,
        proxiedUrl,
        originalUrl
      });
      
      // 이미지 URL 테스트
      const testBothUrls = async () => {
        const proxyResult = await testImageUrl(proxiedUrl);
        const originalResult = await testImageUrl(originalUrl);
        
        console.log('이미지 URL 테스트 결과:', {
          proxy: proxyResult,
          original: originalResult
        });
        
        // 프록시 URL이 실패하고 원본 URL이 성공한 경우 원본 URL 사용
        if (!proxyResult && originalResult) {
          console.log('프록시 URL 실패, 원본 URL로 전환');
          setCurrentUrl(originalUrl);
          setLoadingStrategy('original');
        }
      };
      
      testBothUrls();
    }
  }, [image, proxiedUrl, originalUrl]);
  
  return (
    <div className="flex flex-col gap-2 mt-2">
      <div className="relative rounded-lg overflow-hidden border border-border bg-muted/20 w-full max-w-md">
        {error ? (
          <div className="flex items-center justify-center h-[200px] p-4 text-sm text-muted-foreground">
            <div className="flex flex-col items-center gap-2">
              <p>{error}</p>
              <button 
                className="px-3 py-1 text-sm text-blue-500 hover:text-blue-600 border border-blue-500 rounded-md hover:bg-blue-50"
                onClick={() => {
                  setRetryCount(0);
                  setLoadingStrategy('proxy');
                  setCurrentUrl(proxiedUrl);
                  setIsLoading(true);
                  setError(null);
                }}
              >
                다시 시도
              </button>
            </div>
          </div>
        ) : (
          <>
            <div 
              className={cn(
                "flex items-center justify-center h-[200px]",
                isLoading ? "block" : "hidden"
              )}
            >
              <div className="flex flex-col items-center gap-2">
                <span className="text-sm text-muted-foreground">이미지 로딩 중...</span>
                {retryCount > 0 && (
                  <span className="text-xs text-muted-foreground">
                    재시도 중 ({retryCount}/{MAX_RETRIES})
                  </span>
                )}
              </div>
            </div>
            <Image
              src={currentUrl}
              alt={`페이지: ${image.page || '알 수 없음'}`}
              width={400}
              height={200}
              className={cn(
                "object-contain w-full h-auto max-h-[400px]",
                isLoading ? "opacity-0" : "opacity-100"
              )}
              onLoad={handleImageLoad}
              onError={handleImageError}
            />
          </>
        )}
      </div>
    </div>
  );
}

export function ChatImageGallery({ images }: { images: ImageData[] }) {
  const [loadedImages, setLoadedImages] = useState<Record<string, boolean>>({});
  const [allImagesLoaded, setAllImagesLoaded] = useState(false);
  
  // 이미지 로드 완료 시 트래킹
  const handleImageLoaded = useCallback((imageUrl: string) => {
    setLoadedImages(prev => ({
      ...prev,
      [imageUrl]: true
    }));
  }, []);
  
  // 모든 이미지가 로드되었는지 체크
  useEffect(() => {
    if (!images || images.length === 0) return;
    
    const allLoaded = images.every(img => loadedImages[img.url]);
    
    if (allLoaded && !allImagesLoaded) {
      if (DEBUG_IMAGE_LOADING) {
        console.log('모든 이미지 로드 완료!');
      }
      setAllImagesLoaded(true);
      
      // 이미지 로드 완료 이벤트 발생 (스크롤 관련 컴포넌트에서 캐치할 수 있음)
      const event = new CustomEvent('galaxy:images-loaded', { 
        detail: { messageImages: images }
      });
      window.dispatchEvent(event);
    }
  }, [images, loadedImages, allImagesLoaded]);

  // 디버깅을 위한 마운트 로그
  useEffect(() => {
    if (DEBUG_IMAGE_LOADING) {
      console.log('ChatImageGallery 컴포넌트 마운트됨', {
        imageCount: images?.length || 0,
        images: images || []
      });
    }
    
    // 언마운트 시 이미지 로드 상태 리셋
    return () => {
      setLoadedImages({});
      setAllImagesLoaded(false);
    };
  }, [images]);

  // 이미지가 없는 경우 early return
  if (!images || images.length === 0) return null;
  
  return (
    <div className="flex flex-col gap-4 mt-4 w-full">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {images.map((image, index) => (
          <ChatImage 
            key={`${image.url}-${index}`} 
            image={image} 
            onImageLoaded={() => handleImageLoaded(image.url)}
          />
        ))}
      </div>
    </div>
  );
}