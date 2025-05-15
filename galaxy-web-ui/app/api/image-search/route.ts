import { API_BASE_URL } from '@/lib/constants';
import { NextResponse } from 'next/server';
import type { ImageData } from '@/lib/ai';

// 렌더 백엔드 서버 URL
const RENDER_BACKEND_URL = 'https://galaxy-rag-chatbot.onrender.com';

// 이미지 검색 API 라우트
export async function POST(request: Request) {
  try {
    // 요청 본문 파싱
    const json = await request.json();
    const query = json.query;

    if (!query) {
      return NextResponse.json({ error: '검색어가 필요합니다.' }, { status: 400 });
    }

    console.log('이미지 검색 요청:', query);

    // 백엔드 API 호출 (렌더 서버)
    const backendUrl = `${RENDER_BACKEND_URL}/image-search`;
    console.log('백엔드 호출 URL:', backendUrl);

    try {
      const response = await fetch(backendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) {
        console.error('백엔드 서버 오류:', response.status, response.statusText);
        return NextResponse.json(
          { error: '백엔드 서버에서 오류가 발생했습니다.' },
          { status: response.status }
        );
      }

      // 백엔드 응답을 그대로 반환
      const data = await response.json();
      console.log('이미지 검색 결과:', {
        success: !!data,
        imageCount: data.images?.length || 0
      });

      // URL 끝에 괄호가 있으면 제거 (유일한 처리)
      if (data.images && Array.isArray(data.images)) {
        console.log('백엔드 이미지 URL 처리 전:', data.images.map((img: ImageData) => img.url));
        
        data.images = data.images.map((img: ImageData) => {
          if (!img.url) return img;
          
          // URL 정리 작업
          let cleanUrl = img.url;
          
          // 1. URL 끝의 괄호 제거
          if (cleanUrl.endsWith(')')) {
            cleanUrl = cleanUrl.slice(0, -1);
          }
          
          // 2. 파일 확장자 뒤 괄호 제거 - 더 정확한 패턴 (.jpg) → .jpg
          cleanUrl = cleanUrl.replace(/(\.(jpg|jpeg|png|gif|webp))\)/gi, '$1');
          
          // 3. URL 끝의 물음표 제거
          if (cleanUrl.endsWith('?')) {
            cleanUrl = cleanUrl.slice(0, -1);
          }
          
          // 4. 중복된 확장자 수정 (.jpg.jpg -> .jpg)
          cleanUrl = cleanUrl.replace(/\.jpg\.jpg/i, '.jpg');
          
          // 5. 줄바꿈 문자 제거
          cleanUrl = cleanUrl.replace(/[\r\n]+/g, '');
          
          // 6. 이미지 URL이 두 줄로 표시되는 경우 처리
          if (cleanUrl.includes('galaxy_s25') && !cleanUrl.includes('supabase.co')) {
            // URL 형식이 아닌 파일명만 있는 경우
            cleanUrl = `https://ywvoksfszaelkceectaa.supabase.co/storage/v1/object/public/images/${cleanUrl}`;
          }
          
          // 7. 잘못된 이미지 타입 수정
          ['screen', 'diagram', 'dual', 'mode', 'single', 'take'].forEach(invalidType => {
            if (cleanUrl.includes(`galaxy_s25_${invalidType}_`)) {
              cleanUrl = cleanUrl.replace(`galaxy_s25_${invalidType}_`, 'galaxy_s25_figure_');
              console.log(`이미지 타입 수정 (${invalidType} -> figure):`, cleanUrl);
            }
          });
          
          // 수정된 URL 로그
          if (cleanUrl !== img.url) {
            console.log('URL 정리됨:', img.url, '->', cleanUrl);
          }
          
          return {
            ...img,
            url: cleanUrl
          };
        });
        
        console.log('백엔드 이미지 URL 처리 후:', data.images.map((img: ImageData) => img.url));
        console.log('총 이미지 수:', data.images.length);
      }

      return NextResponse.json(data);
    } catch (error) {
      console.error('백엔드 API 호출 중 오류:', error);
      
      // 오류 발생 시 빈 배열 반환
      return NextResponse.json({
        images: [],
        error: `백엔드 연결 오류: ${error instanceof Error ? error.message : '알 수 없는 오류'}`
      });
    }
  } catch (error) {
    console.error('이미지 검색 처리 중 오류:', error);
    return NextResponse.json(
      { error: '요청 처리 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// 이미지 검색 상태 확인용 GET 엔드포인트
export async function GET() {
  return NextResponse.json({
    status: 'active',
    message: '이미지 검색 API가 활성화되어 있습니다. POST 요청으로 검색어를 전송하세요.'
  });
} 