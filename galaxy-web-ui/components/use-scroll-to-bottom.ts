import { useEffect, useRef, useState, type RefObject } from 'react';

export function useScrollToBottom<T extends HTMLElement>(): [
  RefObject<T>,
  RefObject<T>,
] {
  const containerRef = useRef<T>(null);
  const endRef = useRef<T>(null);
  const [isScrollLocked, setIsScrollLocked] = useState(false);
  const userHasScrolled = useRef(false);
  const scrollTimeout = useRef<NodeJS.Timeout | null>(null);
  const pendingImagesLoadEvent = useRef(false);
  const lastMutationTime = useRef(0);
  const consecutiveMutationsCount = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    const end = endRef.current;

    if (container && end) {
      // 사용자 스크롤 감지
      const handleScroll = () => {
        if (!container) return;
        
        const { scrollTop, scrollHeight, clientHeight } = container;
        const isAtBottom = Math.abs(scrollHeight - scrollTop - clientHeight) < 20;
        
        // 사용자가 맨 아래에 있으면 스크롤 잠금 해제
        if (isAtBottom) {
          userHasScrolled.current = false;
          setIsScrollLocked(false);
        } else {
          // 사용자가 스크롤을 위로 올렸다면 잠금
          userHasScrolled.current = true;
          setIsScrollLocked(true);
        }
      };

      // 이미지 로드 완료 이벤트 핸들러
      const handleImagesLoaded = (event: Event) => {
        console.log('모든 이미지 로드 완료 이벤트 수신');
        pendingImagesLoadEvent.current = false;
        
        // 사용자가 스크롤 중이면 스크롤하지 않음
        if (userHasScrolled.current || isScrollLocked) {
          console.log('스크롤 억제 (사용자 스크롤)');
          return;
        }
        
        // 스크롤 적용 (약간 지연)
        if (scrollTimeout.current) {
          clearTimeout(scrollTimeout.current);
        }
        
        scrollTimeout.current = setTimeout(() => {
          console.log('이미지 로드 후 스크롤 조정');
          end.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }, 100);
      };

      container.addEventListener('scroll', handleScroll);
      window.addEventListener('galaxy:images-loaded', handleImagesLoaded);

      // DOM 변경 시 스크롤 처리
      const observer = new MutationObserver((mutations) => {
        // 짧은 시간에 너무 많은 DOM 변경 발생 방지 (디바운스)
        const now = Date.now();
        if (now - lastMutationTime.current < 50) {
          // 연속 변경 횟수 증가
          consecutiveMutationsCount.current++;
          
          // 연속 변경이 너무 많으면 일정 시간 무시
          if (consecutiveMutationsCount.current > 10) {
            return;
          }
        } else {
          // 연속 변경 횟수 초기화
          consecutiveMutationsCount.current = 0;
        }
        
        lastMutationTime.current = now;
        
        // 이미지 변경 감지 - 이미지가 로드 중이면 스크롤 연기
        const hasImageChanges = mutations.some(mutation => {
          return Array.from(mutation.addedNodes).some(node => 
            node instanceof HTMLElement && 
            (node.tagName === 'IMG' || node.querySelector('img'))
          );
        });

        // 사용자가 스크롤을 위로 올린 상태라면 스크롤하지 않음
        if (userHasScrolled.current || isScrollLocked) return;

        // 이미지 변경이 감지되면 이벤트 대기
        if (hasImageChanges) {
          pendingImagesLoadEvent.current = true;
          
          // 이전 타이머 취소
          if (scrollTimeout.current) {
            clearTimeout(scrollTimeout.current);
          }
          
          // 2초 이내에 이미지 로드 이벤트가 오지 않으면 스크롤 진행
          scrollTimeout.current = setTimeout(() => {
            if (pendingImagesLoadEvent.current) {
              console.log('이미지 로드 이벤트 타임아웃, 강제 스크롤');
              pendingImagesLoadEvent.current = false;
              
              // 마지막 안전 검사: 스크롤 잠금 상태 또는 사용자 스크롤 중인지 확인
              if (!userHasScrolled.current && !isScrollLocked) {
                end.scrollIntoView({ behavior: 'smooth', block: 'end' });
              }
            }
          }, 2000);
        } else if (!pendingImagesLoadEvent.current) {
          // 이미지 변경이 없고 이미지 로드 대기 중이 아니면 즉시 스크롤
          if (!userHasScrolled.current && !isScrollLocked) {
            end.scrollIntoView({ behavior: 'instant', block: 'end' });
          } else {
            console.log('스크롤 억제 (사용자 스크롤)');
          }
        }
      });

      observer.observe(container, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });

      return () => {
        observer.disconnect();
        container.removeEventListener('scroll', handleScroll);
        window.removeEventListener('galaxy:images-loaded', handleImagesLoaded);
        if (scrollTimeout.current) {
          clearTimeout(scrollTimeout.current);
        }
      };
    }
  }, [isScrollLocked]);

  return [containerRef, endRef];
}
