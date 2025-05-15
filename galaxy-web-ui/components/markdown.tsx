import Link from 'next/link';
import React, { memo, useMemo, useEffect, useState, ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './code-block';
import Image from 'next/image';

// 디버그 모드 설정 (활성화)
const DEBUG_IMAGE_PROCESSING = true;
console.log('Markdown 컴포넌트 디버깅 활성화 상태:', DEBUG_IMAGE_PROCESSING);

// 응답 텍스트에서 이미지 URL을 직접 추출하는 정규식
const DIRECT_IMAGE_PATTERN = /https?:\/\/\S+?\.(jpg|jpeg|png|gif|webp)(?:\?\S*)?/gi;

// 이미지 URL 정규식 패턴들 - 다양한 형식 지원
const IMAGE_PATTERNS = [
  // @ 기호로 시작하는 URL 패턴 (최우선 처리 - 실제 사용되는 포맷)
  {
    regex: /\[이미지\s*(\d+)\][ \t]*\n@(https?:\/\/[^\s]+)/gi,
    transform: (match: RegExpMatchArray) => {
      if (!match || match.length < 3) return null;
      const [fullMatch, imageNum, imageUrl] = match;
      if (!imageUrl) return null;
      
      // URL에서 이중 슬래시 정규화
      const normalizedUrl = imageUrl.trim().replace(/([^:])\/\/+/g, '$1/');
      
      if (DEBUG_IMAGE_PROCESSING) {
        console.log('@ 패턴 매치 (우선순위):', {imageNum, imageUrl: `${normalizedUrl.substring(0, 50)}...`});
      }
      
      return { 
        fullMatch, 
        imageUrl: normalizedUrl, 
        alt: `이미지 ${imageNum}` 
      };
    }
  },
  
  // 정확히 "[이미지 N] URL" 패턴
  {
    regex: /\[이미지\s*(\d+)\][ \t]*\n(?!@)(https?:\/\/[^\s]+)/gi,
    transform: (match: RegExpMatchArray) => {
      if (!match || match.length < 3) return null;
      const [fullMatch, imageNum, imageUrl] = match;
      if (!imageUrl) return null;
      
      // URL에서 이중 슬래시 정규화
      const normalizedUrl = imageUrl.trim().replace(/([^:])\/\/+/g, '$1/');
      
      if (DEBUG_IMAGE_PROCESSING) {
        console.log('패턴1 매치:', {imageNum, imageUrl: `${normalizedUrl.substring(0, 50)}...`});
      }
      
      return { 
        fullMatch, 
        imageUrl: normalizedUrl, 
        alt: `이미지 ${imageNum}` 
      };
    }
  },
  
  // 한 줄 패턴 - 이미지 번호와 URL이 같은 줄에 있는 경우
  {
    regex: /\[이미지\s*(\d+)\][ \t]+(https?:\/\/[^\s\n]+)/gi,
    transform: (match: RegExpMatchArray) => {
      if (!match || match.length < 3) return null;
      const [fullMatch, imageNum, imageUrl] = match;
      if (!imageUrl) return null;
      
      // URL에서 이중 슬래시 정규화
      const normalizedUrl = imageUrl.trim().replace(/([^:])\/\/+/g, '$1/');
      
      if (DEBUG_IMAGE_PROCESSING) {
        console.log('한 줄 패턴 매치:', {imageNum, imageUrl: `${normalizedUrl.substring(0, 50)}...`});
      }
      
      return { 
        fullMatch, 
        imageUrl: normalizedUrl, 
        alt: `이미지 ${imageNum}` 
      };
    }
  },
  
  // 복잡한 패턴 - 이미지 번호 다음에 메타데이터가 있는 경우
  {
    regex: /\[이미지\s*(\d+)\](?:(?:\s*(?:👑)?(?:\s*텍스트와\s*가장\s*관련성\s*높은\s*이미지)?)?)[^\S\r\n]*\n[^\S\r\n]*(https?:\/\/[^\s\n]+)/gi,
    transform: (match: RegExpMatchArray) => {
      if (!match || match.length < 3) return null;
      const [fullMatch, imageNum, imageUrl] = match;
      if (!imageUrl) return null;
      
      if (DEBUG_IMAGE_PROCESSING) {
        console.log('패턴2 매치:', {imageNum, imageUrl: `${imageUrl.substring(0, 50)}...`});
      }
      
      let alt = `이미지 ${imageNum}`;
      if (fullMatch.includes('👑') || fullMatch.includes('관련성')) {
        alt += " 👑 텍스트와 가장 관련성 높은 이미지";
      }
      return { fullMatch, imageUrl: imageUrl.trim(), alt };
    }
  },
  
  // 이미지 제목과 URL 사이에 여러 줄이 있을 수 있는 패턴
  {
    regex: /\[이미지\s*(\d+)\][^\n]*\n(?:(?!https?:\/\/)[^\n]*\n)*?(https?:\/\/[^\s\n]+)/gim,
    transform: (match: RegExpMatchArray) => {
      if (!match || match.length < 3) return null;
      const [fullMatch, imageNum, imageUrl] = match;
      if (!imageUrl) return null;
      
      if (DEBUG_IMAGE_PROCESSING) {
        console.log('확장 패턴 매치:', {imageNum, imageUrl: `${imageUrl.substring(0, 50)}...`});
      }
      
      return { 
        fullMatch, 
        imageUrl: imageUrl.trim(), 
        alt: `이미지 ${imageNum}` 
      };
    }
  },
  
  // Supabase 특정 URL 패턴 (쿼리 파라미터 포함)
  {
    regex: /\[이미지\s*(\d+)\][^\n]*\n(https?:\/\/[^\s\n]+?supabase[^\s\n]+?\/storage\/v1\/object\/public\/images\/[^\s\n]+?)(?:\?[^\s\n]*)?$/gim,
    transform: (match: RegExpMatchArray) => {
      if (!match || match.length < 3) return null;
      const [fullMatch, imageNum, imageUrl] = match;
      if (!imageUrl) return null;
      
      if (DEBUG_IMAGE_PROCESSING) {
        console.log('Supabase 패턴 매치:', {imageNum, imageUrl});
      }
      
      return { 
        fullMatch, 
        imageUrl: imageUrl.trim(),  
        alt: `이미지 ${imageNum} (Supabase 스토리지)` 
      };
    }
  },
  
  // 일반 URL 패턴 (확장자로 이미지 파일 유추)
  {
    regex: /(https?:\/\/[^\s\n]+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s\n]*)?)/gi,
    transform: (match: RegExpMatchArray) => {
      if (!match || match.length < 2) return null;
      const [fullMatch, imageUrl] = match;
      if (!imageUrl) return null;
      
      // URL에서 파일명 추출
      const fileName = imageUrl.split('/').pop()?.split('?')[0] || '이미지';
      return { fullMatch, imageUrl: imageUrl.trim(), alt: fileName };
    }
  },
  
  // 상대 경로 URL 패턴 (추가)
  {
    regex: /\[이미지\s*(\d+)\][^\n]*\n(\/[^\s\n]+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s\n]*)?)/gi,
    transform: (match: RegExpMatchArray) => {
      if (!match || match.length < 3) return null;
      const [fullMatch, imageNum, imageUrl] = match;
      if (!imageUrl) return null;
      
      if (DEBUG_IMAGE_PROCESSING) {
        console.log('상대 경로 이미지 매치:', {imageNum, imageUrl});
      }
      
      return { 
        fullMatch, 
        imageUrl: imageUrl.trim(), 
        alt: `이미지 ${imageNum} (상대 경로)` 
      };
    }
  },
  
  // Supabase URL 패턴 (최우선 처리)
  {
    regex: /\[이미지\s*(\d+)\][ \t]*\n(https?:\/\/[^\s\n]*?ywvoksfszaelkceectaa\.supabase\.co[^\s\n]*?(?:\?[^\s\n]*)?)/gi,
    transform: (match: RegExpMatchArray) => {
      if (!match || match.length < 3) return null;
      const [fullMatch, imageNum, imageUrl] = match;
      if (!imageUrl) return null;
      
      // URL에서 이중 슬래시 정규화
      const normalizedUrl = imageUrl.trim().replace(/([^:])\/\/+/g, '$1/');
      
      if (DEBUG_IMAGE_PROCESSING) {
        console.log('Supabase 우선 패턴 매치:', {imageNum, imageUrl: normalizedUrl});
      }
      
      return { 
        fullMatch, 
        imageUrl: normalizedUrl, 
        alt: `이미지 ${imageNum} (Supabase)` 
      };
    }
  }
];

const components: Partial<Components> = {
  // @ts-expect-error
  code: CodeBlock,
  pre: ({ children }) => <>{children}</>,
  // p 태그 렌더러 커스터마이징: 이미지를 포함하는 경우 div로 렌더링
  p: ({ node, children, ...props }) => {
    // p 태그 내용을 확인하여 이미지 태그가 포함되어 있는지 검사
    const childrenArray = React.Children.toArray(children);
    
    // img 태그 또는 이미지를 포함하는 링크가 있는지 확인
    const hasImageChild = childrenArray.some(child => {
      // 직접적인 이미지 태그 확인
      if (React.isValidElement(child) && (
        child.type === 'img' || 
        (typeof child.type === 'function' && (child.type as any).name === 'img')
      )) {
        return true;
      }
      
      // a 태그 안에 이미지가 있는지 확인
      if (React.isValidElement(child) && (
        child.type === 'a' || 
        (typeof child.type === 'function' && (child.type as any).name === 'a')
      )) {
        const linkChildren = React.Children.toArray((child as React.ReactElement).props.children);
        return linkChildren.some(linkChild => 
          React.isValidElement(linkChild) && (
            linkChild.type === 'img' || 
            (typeof linkChild.type === 'function' && (linkChild.type as any).name === 'img')
          )
        );
      }
      
      return false;
    });
    
    // 이미지가 포함된 경우 div로 렌더링
    if (hasImageChild) {
      return (
        <div className="my-4" {...props}>
          {children}
        </div>
      );
    }
    
    // 일반 텍스트의 경우 p 태그로 렌더링
    return <p className="mb-4 leading-7" {...props}>{children}</p>;
  },
  ol: ({ node, children, ...props }) => {
    // ordered 속성이 불리언이면 해당 속성을 삭제
    const safeProps: any = { ...props };
    if (typeof safeProps.ordered === 'boolean') {
      safeProps.ordered = undefined;
    }
    return (
      <ol className="list-decimal list-outside ml-4" {...safeProps}>
        {children}
      </ol>
    );
  },
  li: ({ node, children, ...props }) => {
    // ordered 속성이 불리언이면 해당 속성을 삭제하고 필요한 경우 문자열로 추가
    const safeProps: any = { ...props };
    if (typeof safeProps.ordered === 'boolean') {
      safeProps.ordered = undefined;
    }
    return (
      <li className="py-1" {...safeProps}>
        {children}
      </li>
    );
  },
  ul: ({ node, children, ...props }) => {
    // ordered 속성이 불리언이면 해당 속성을 삭제
    const safeProps: any = { ...props };
    if (typeof safeProps.ordered === 'boolean') {
      safeProps.ordered = undefined;
    }
    return (
      <ul className="list-disc list-outside ml-4" {...safeProps}>
        {children}
      </ul>
    );
  },
  strong: ({ node, children, ...props }) => {
    return (
      <span className="font-semibold" {...props}>
        {children}
      </span>
    );
  },
  a: ({ node, children, ...props }) => {
    // href가 이미지 URL인지 확인
    const href = props.href || '';
    const isImageUrl = /\.(jpg|jpeg|png|gif|webp)(?:\?[^\s\n]*)?$/i.test(href) || 
                      /supabase[^\s\n]+?\/storage\/v1\/object\/public\/images\//i.test(href);
    
    if (DEBUG_IMAGE_PROCESSING && isImageUrl) {
      console.log('링크가 이미지로 감지됨:', href);
    }
    
    // 이미지 URL이 아닌 경우에만 링크로 처리
    if (!isImageUrl) {
      return (
        // @ts-expect-error
        <Link
          className="text-blue-500 hover:underline"
          target="_blank"
          rel="noreferrer"
          {...props}
        >
          {children}
        </Link>
      );
    }
    
    // 이미지 URL인 경우 렌더링 방지 (img 태그에서 처리)
    return <>{children}</>;
  },
  h1: ({ node, children, ...props }) => {
    return (
      <h1 className="text-3xl font-semibold mt-6 mb-2" {...props}>
        {children}
      </h1>
    );
  },
  h2: ({ node, children, ...props }) => {
    return (
      <h2 className="text-2xl font-semibold mt-6 mb-2" {...props}>
        {children}
      </h2>
    );
  },
  h3: ({ node, children, ...props }) => {
    return (
      <h3 className="text-xl font-semibold mt-6 mb-2" {...props}>
        {children}
      </h3>
    );
  },
  h4: ({ node, children, ...props }) => {
    return (
      <h4 className="text-lg font-semibold mt-6 mb-2" {...props}>
        {children}
      </h4>
    );
  },
  h5: ({ node, children, ...props }) => {
    return (
      <h5 className="text-base font-semibold mt-6 mb-2" {...props}>
        {children}
      </h5>
    );
  },
  h6: ({ node, children, ...props }) => {
    return (
      <h6 className="text-sm font-semibold mt-6 mb-2" {...props}>
        {children}
      </h6>
    );
  },
  // 이미지 컴포넌트 추가
  img: ({ src, alt, ...props }) => {
    if (src) {
      // 이미지 확장자가 있는지 확인 (쿼리 파라미터를 포함한 URL도 처리)
      const isImageFile = /\.(jpg|jpeg|png|gif|webp)(?:\?[^\s\n]*)?$/i.test(src) || 
                          src.includes('blob:') || 
                          src.includes('data:image/') ||
                          /supabase[^\s\n]+?\/storage\/v1\/object\/public\/images\//i.test(src) ||
                          src.includes('ywvoksfszaelkceectaa.supabase.co');
      
      // 디버깅 정보 출력
      if (DEBUG_IMAGE_PROCESSING) {
        console.log('이미지 렌더링 시도:', src);
        console.log('이미지 파일로 인식됨:', isImageFile);
        console.log('이미지 대체 텍스트:', alt);
      }
      
      // 주의: 여기서는 이미지만 반환하고, 부모 컴포넌트가 이를 적절히 감싸도록 함
      return (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img 
            src={src} 
            alt={alt || "이미지"} 
            className="rounded-lg max-w-full h-auto max-h-[400px] object-contain hover:opacity-90 transition-opacity shadow-md"
            loading="lazy"
            onLoad={(e) => {
              if (DEBUG_IMAGE_PROCESSING) {
                console.log('이미지 로드 성공:', src);
              }
            }}
            onError={(e) => {
              // 이미지 로드 실패 시 fallback 이미지 표시 또는 스타일 변경
              const target = e.target as HTMLImageElement;
              console.error('이미지 로드 실패:', src);
              
              // 이중 슬래시 수정 시도
              if (src.includes('//')) {
                const fixedSrc = src.replace(/([^:])\/\/+/g, '$1/');
                console.log('이중 슬래시 수정 시도:', fixedSrc);
                target.src = fixedSrc;
                return;
              }
              
              target.style.display = isImageFile ? 'block' : 'none';
              target.style.opacity = '0.5';
              target.alt = '이미지를 로드할 수 없습니다';
            }}
            {...props}
          />
          {alt && <div className="text-sm text-muted-foreground mt-1 text-center">{alt}</div>}
        </>
      );
    }
    return null;
  },
  // 이미지 렌더링을 정확히 처리하기 위한 특별한 래퍼 컴포넌트 추가
  imageWrapper: ({ node, children, ...props }: { node: any; children: ReactNode; [key: string]: any }) => {
    // 이미지가 있는지 확인
    const hasImage = React.Children.toArray(children).some(
      child => React.isValidElement(child) && (child.type === 'img' || (typeof child.type === 'function' && (child.type as any).name === 'img'))
    );

    if (hasImage) {
      return (
        <div className="my-4 flex flex-col items-center border border-gray-200 rounded-lg p-2 bg-gray-50 dark:bg-gray-900 dark:border-gray-800">
          <a href={node?.properties?.src as string} target="_blank" rel="noreferrer" className="max-w-full">
            {children}
          </a>
        </div>
      );
    }
    
    return <>{children}</>;
  },
};

const remarkPlugins = [remarkGfm];

// 이미지 URL을 판별하는 함수 개선
const isImageUrl = (url: string): boolean => {
  if (!url) return false;
  
  // 디버깅을 위해 로그 추가
  if (DEBUG_IMAGE_PROCESSING) {
    console.log('이미지 URL 체크 중:', url);
  }
  
  // URL 정규화
  const normalizedUrl = url.replace(/([^:])\/\/+/g, '$1/');
  
  // 1. 기본 이미지 확장자 체크 (쿼리 파라미터 제외)
  const urlWithoutQuery = normalizedUrl.split('?')[0];
  if (/\.(jpg|jpeg|png|gif|webp|svg)$/i.test(urlWithoutQuery)) {
    if (DEBUG_IMAGE_PROCESSING) console.log('확장자로 이미지 확인됨');
    return true;
  }
  
  // 2. Blob URL 또는 Data URL 확인
  if (normalizedUrl.startsWith('blob:') || normalizedUrl.startsWith('data:image/')) {
    if (DEBUG_IMAGE_PROCESSING) console.log('blob/data URL로 이미지 확인됨');
    return true;
  }
  
  // 3. Supabase 스토리지 URL 패턴 체크
  const supabasePatterns = [
    /supabase.*?\/storage\/v1\/object\/public\/images\//i,
    /ywvoksfszaelkceectaa\.supabase\.co/i,
    /\/storage\/v1\/object\/public\//i
  ];
  
  if (supabasePatterns.some(pattern => pattern.test(normalizedUrl))) {
    if (DEBUG_IMAGE_PROCESSING) console.log('Supabase URL로 이미지 확인됨');
    return true;
  }
  
  // 4. 갤럭시 매뉴얼 관련 이미지 패턴
  const galaxyPatterns = [
    /galaxy_s25_[a-z]+_p(\d+)_(?:top|mid|bot)_[a-f0-9]+\.jpg/i,
    /\/images\/galaxy\//i,
    /\/manual\/images\//i
  ];
  
  if (galaxyPatterns.some(pattern => pattern.test(normalizedUrl))) {
    if (DEBUG_IMAGE_PROCESSING) console.log('갤럭시 관련 이미지로 확인됨');
    return true;
  }
  
  // 5. Content-Type 체크 (선택적)
  if (normalizedUrl.includes('image/')) {
    if (DEBUG_IMAGE_PROCESSING) console.log('Content-Type으로 이미지 확인됨');
    return true;
  }
  
  if (DEBUG_IMAGE_PROCESSING) console.log('이미지 URL로 인식되지 않음');
  return false;
};

// 직접 이미지 URL을 판별하는 함수
const extractImageUrls = (text: string): { url: string, description: string }[] => {
  const results: { url: string, description: string }[] = [];
  
  // 모든 패턴에 대해 처리
  for (const pattern of IMAGE_PATTERNS) {
    // DOTALL 모드로 여러 줄에 걸친 패턴 매칭 (정규식 플래그 's'로 설정)
    const regexWithDotAll = new RegExp(pattern.regex.source, pattern.regex.flags + (pattern.regex.flags.includes('s') ? '' : 's'));
    const matches = Array.from(text.matchAll(regexWithDotAll));
    
    for (const match of matches) {
      const result = pattern.transform(match);
      if (!result) continue;
      
      results.push({
        url: result.imageUrl,
        description: result.alt
      });
      
      if (DEBUG_IMAGE_PROCESSING) {
        console.log('직접 추출한 이미지 URL:', result.imageUrl);
      }
    }
  }
  
  return results;
};

// 버퍼링 후 이미지 URL 패턴 완성을 위한 기능
function completeImagePattern(text: string): string {
  // 이미지 패턴이 있는지 확인
  if (!text.includes('[이미지')) {
    return text;
  }

  // Supabase URL을 직접 추출
  const urls = text.match(DIRECT_IMAGE_PATTERN);
  if (!urls || urls.length === 0) {
    // URL이 없으면 원본 텍스트 반환
    return text;
  }

  // 이미지 패턴 추출
  const patterns = text.match(/\[이미지\s*(\d+)\]/gi);
  if (!patterns || patterns.length === 0) {
    return text;
  }

  let processedText = text;
  
  // 패턴과 URL을 짝지어 처리
  for (let i = 0; i < Math.min(patterns.length, urls.length); i++) {
    const pattern = patterns[i];
    const url = urls[i];
    
    // 패턴 바로 다음에 URL이 없는 경우에만 처리
    const patternIndex = processedText.indexOf(pattern);
    if (patternIndex !== -1) {
      const afterPattern = processedText.substring(patternIndex + pattern.length, patternIndex + pattern.length + 50);
      
      // URL이 이미 패턴 바로 다음에 있는지 확인
      if (!afterPattern.includes('http')) {
        // 패턴과 URL 사이에 줄바꿈 추가
        processedText = processedText.replace(
          pattern, 
          `${pattern}\n${url}`
        );
      }
    }
  }

  if (DEBUG_IMAGE_PROCESSING) {
    console.log('이미지 패턴 완성 후:', `${processedText.substring(0, 200)}...`);
  }

  return processedText;
}

const NonMemoizedMarkdown = ({ children }: { children: string }) => {
  // 원본 텍스트 저장
  const [bufferedText, setBufferedText] = useState('');
  
  // 컴포넌트 마운트 시 한번만 실행
  useEffect(() => {
    if (children) {
      // 전체 응답 텍스트 로깅 (디버깅용)
      if (DEBUG_IMAGE_PROCESSING) {
        console.log('받은 원본 텍스트:', children);
        console.log('텍스트 길이:', children.length);
        
        // 중요: 이미지 패턴 검사 먼저 실행
        const hasImagePattern = children.includes('[이미지');
        console.log('[이미지] 패턴 존재:', hasImagePattern);
        
        // Supabase URL 존재 확인
        const supabaseUrlCheck = children.includes('supabase.co');
        console.log('Supabase URL 존재:', supabaseUrlCheck);
        
        if (hasImagePattern) {
          // 모든 이미지 패턴 추출 시도
          const imagePatterns = children.match(/\[이미지\s*\d+\][^\n]*\n/g);
          if (imagePatterns && imagePatterns.length > 0) {
            console.log('이미지 패턴 발견:', imagePatterns);
            
            // 패턴 다음 줄의 URL 확인 시도
            for (const pattern of imagePatterns) {
              const patternIndex = children.indexOf(pattern);
              if (patternIndex !== -1) {
                // 패턴 다음 줄 추출
                const nextLineStart = patternIndex + pattern.length;
                const nextLineEnd = children.indexOf('\n', nextLineStart);
                const nextLine = nextLineEnd !== -1 
                  ? children.substring(nextLineStart, nextLineEnd).trim()
                  : children.substring(nextLineStart).trim();
                
                console.log('이미지 패턴 다음 줄:', nextLine);
                
                // URL인지 확인
                if (nextLine.startsWith('http')) {
                  console.log('URL 발견:', nextLine);
                }
              }
            }
          } else {
            console.log('이미지 패턴 발견되었으나 형식 매칭 없음');
          }
        }
        
        if (supabaseUrlCheck) {
          const urls = children.match(/https?:\/\/[^\s\n]*?supabase\.co[^\s\n]*/g);
          console.log('발견된 Supabase URL:', urls);
        }
      }
      
      // 버퍼링된 텍스트를 사용해 전체 텍스트 재구성
      setBufferedText(prevText => {
        // 이전 텍스트가 있고 새 텍스트가 짧은 경우, 이어붙임 (스트리밍 중 잘림 방지)
        if (prevText && children.length < prevText.length) {
          return prevText + children;
        }
        return children;
      });
    }
  }, [children]);
  
  useEffect(() => {
    if (DEBUG_IMAGE_PROCESSING) {
      console.log('전체 텍스트 길이:', bufferedText?.length || 0);
      
      // 직접 이미지 URL 추출 테스트
      const extractedUrls = extractImageUrls(bufferedText || '');
      if (extractedUrls.length > 0) {
        console.log('직접 추출된 이미지 URL들:', extractedUrls);
      } else {
        console.log('직접 추출된 이미지 URL 없음');
      }
    }
  }, [bufferedText]);
  
  // 이미지 URL을 마크다운 이미지 구문으로 변환
  const processedContent = useMemo(() => {
    if (!bufferedText) return '';
    
    // 원본 텍스트 저장
    let content = bufferedText;
    
    // 짧은 단일 문장은 줄바꿈을 제거하여 단일 줄로 표시
    if (content.length < 100 && !content.includes("\n") && !content.includes("[이미지") && !content.includes("https://")) {
      // 짧은 텍스트는 추가 처리 없이 반환
      return content;
    }
    
    if (DEBUG_IMAGE_PROCESSING) {
      console.log('처리 전 텍스트 (일부):', `${content.substring(0, 200)}...`);
      // 추가: 전체 내용 길이
      console.log('처리할 텍스트 전체 길이:', content.length);
      // 추가: 이미지 패턴 찾기
      const imagePatterns = content.match(/\[이미지\s*\d+\]/g);
      console.log('발견된 이미지 패턴 수:', imagePatterns?.length || 0);
      if (imagePatterns) {
        console.log('이미지 패턴:', imagePatterns);
      }
      
      // URL 패턴 찾기
      const urlPatterns = content.match(/https?:\/\/[^\s\n]+/g);
      console.log('발견된 URL 패턴 수:', urlPatterns?.length || 0);
      if (urlPatterns && urlPatterns.length > 0) {
        console.log('URL 패턴(첫 5개):', urlPatterns.slice(0, 5));
      }
    }
    
    // 이미지 패턴 완성 적용
    content = completeImagePattern(content);
    
    if (DEBUG_IMAGE_PROCESSING) {
      console.log('이미지 패턴 완성 후 (일부):', `${content.substring(0, 200)}...`);
    }
    
    // 패턴 매칭 결과 로깅
    let patternMatchCount = 0;
    
    // 모든 패턴에 대해 처리
    for (const pattern of IMAGE_PATTERNS) {
      // 이미지 URL 패턴이 있는지 먼저 확인하여 패턴이 없으면 정규식 처리 건너뛰기
      // Supabase URL이 있는 경우에도 무조건 처리
      const hasImagePattern = content.match(/\[이미지/) !== null;
      const hasHttpsUrl = content.match(/https:\/\/\S+/i) !== null;
      const hasSupabaseUrl = content.match(/ywvoksfszaelkceectaa\.supabase\.co/i) !== null;
      
      if (!hasImagePattern && !hasHttpsUrl && !hasSupabaseUrl) {
        if (DEBUG_IMAGE_PROCESSING) {
          console.log('이미지 관련 패턴 없음, 건너뜀');
        }
        continue;
      }
      
      // 직접 이미지 태그 패턴 시도 (단순화된 접근)
      if (hasImagePattern && hasSupabaseUrl) {
        try {
          // 단순 패턴: [이미지 숫자] 다음 줄에 URL
          const simplePattern = /\[이미지\s*(\d+)\]\s*\n(https?:\/\/[^\s\n]+)/gi;
          const simpleMatches = Array.from(content.matchAll(simplePattern));
          
          if (DEBUG_IMAGE_PROCESSING) {
            console.log('단순 이미지 패턴 매치 시도, 결과:', simpleMatches.length);
            if (simpleMatches.length > 0) {
              console.log('첫 매치:', simpleMatches[0]);
            }
          }
          
          for (const match of simpleMatches) {
            if (match.length < 3) continue;
            const [fullMatch, imageNum, imageUrl] = match;
            
            if (!imageUrl) continue;
            
            const mdImage = `\n\n![이미지 ${imageNum}](${imageUrl.trim()})\n\n`;
            content = content.replace(fullMatch, mdImage);
            patternMatchCount++;
            
            if (DEBUG_IMAGE_PROCESSING) {
              console.log(`이미지 ${imageNum} 변환 성공: ${imageUrl.substring(0, 30)}...`);
              console.log('변환된 마크다운:', mdImage);
            }
          }
        } catch (error) {
          console.error('단순 이미지 패턴 매칭 오류:', error);
        }
      }
      
      try {
        // DOTALL 모드로 여러 줄에 걸친 패턴 매칭 (정규식 플래그 's'로 설정)
        const regexWithDotAll = new RegExp(pattern.regex.source, pattern.regex.flags + (pattern.regex.flags.includes('s') ? '' : 's'));
        const matches = Array.from(content.matchAll(regexWithDotAll));
      
        if (DEBUG_IMAGE_PROCESSING) {
          console.log('패턴:', pattern.regex.toString(), '매치 수:', matches.length);
          
          if (matches.length > 0) {
            patternMatchCount += matches.length;
            console.log('매치된 패턴 샘플:', matches[0][0]);
          }
        }
        
        for (const match of matches) {
          const result = pattern.transform(match);
          if (!result) continue;
          
          const { fullMatch, imageUrl, alt } = result;
          
          if (DEBUG_IMAGE_PROCESSING) {
            console.log('매치 정보:', { 
              fullMatch: `${fullMatch.substring(0, 50)}...`, 
              imageUrl: `${imageUrl.substring(0, 50)}...`, 
              alt 
            });
          }
          
          // 이미지 URL인지 확인
          if (isImageUrl(imageUrl)) {
            // 마크다운 이미지 형식으로 변환
            const markdownImage = `\n\n![${alt}](${imageUrl})\n\n`;
            content = content.replace(fullMatch, markdownImage);
            
            if (DEBUG_IMAGE_PROCESSING) {
              console.log('변환 성공! 마크다운 이미지로 교체됨');
            }
          } else {
            if (DEBUG_IMAGE_PROCESSING) {
              console.log('URL이 이미지로 인식되지 않음:', imageUrl);
            }
          }
        }
      } catch (error) {
        console.error('패턴 매칭 오류:', error);
      }
    }
    
    if (DEBUG_IMAGE_PROCESSING) {
      console.log('총 매치된 이미지 패턴 수:', patternMatchCount);
      
      // 최종 마크다운 형식 확인
      const mdImages = content.match(/!\[.*?\]\(.*?\)/g);
      console.log('변환된 마크다운 이미지 수:', mdImages?.length || 0);
      if (mdImages && mdImages.length > 0) {
        console.log('마크다운 이미지 샘플:', mdImages[0]);
      }
    }
    
    return content;
  }, [bufferedText]);
  
  // 디버깅을 위한 부수 효과
  useEffect(() => {
    if (DEBUG_IMAGE_PROCESSING) {
      console.log('처리된 텍스트 일부:', `${processedContent.substring(0, 200)}...`);
    }
  }, [processedContent]);
  
  // 최종 출력 - 중복 렌더링 제거
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
      {processedContent}
    </ReactMarkdown>
  );
};

export const Markdown = memo(
  NonMemoizedMarkdown,
  (prevProps, nextProps) => prevProps.children === nextProps.children,
);
