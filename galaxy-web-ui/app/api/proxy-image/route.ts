import { type NextRequest, NextResponse } from 'next/server';

const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml'
];

const CACHE_CONTROL = {
  public: 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
  private: 'private, no-cache'
};

/**
 * 이미지 프록시 API 라우트
 * 
 * Supabase의 스토리지나 외부 이미지를 프록시하여 CORS 문제를 해결합니다.
 * 추가된 기능:
 * - 이미지 타입 검증
 * - 응답 캐싱
 * - 에러 처리 개선
 * - 타임아웃 설정
 */
export async function GET(request: NextRequest) {
  try {
    // URL에서 이미지 경로 파라미터 추출
    const { searchParams } = new URL(request.url);
    const imageUrl = searchParams.get('url');
    const bypassCache = searchParams.get('bypass-cache') === 'true';

    console.log('프록시 요청 받음:', imageUrl);

    if (!imageUrl) {
      console.error('이미지 URL이 제공되지 않음');
      return NextResponse.json(
        { error: '이미지 URL이 제공되지 않았습니다.' },
        { status: 400 }
      );
    }

    // URL 정규화 전처리
    let normalizedImageUrl = imageUrl;

    // URL 앞에 @ 기호가 있으면 제거
    if (normalizedImageUrl.startsWith('@')) {
      normalizedImageUrl = normalizedImageUrl.substring(1);
      console.log('@ 기호 제거 후 URL:', normalizedImageUrl);
    }

    // URL 끝에 ? 기호가 있으면 제거 
    if (normalizedImageUrl.endsWith('?')) {
      normalizedImageUrl = normalizedImageUrl.slice(0, -1);
      console.log('URL 끝 ? 기호 제거 후:', normalizedImageUrl);
    }
    
    // URL 끝에 ) 기호가 있으면 제거
    if (normalizedImageUrl.endsWith(')')) {
      normalizedImageUrl = normalizedImageUrl.slice(0, -1);
      console.log('URL 끝 ) 기호 제거 후:', normalizedImageUrl);
    }
    
    // 파일 확장자 뒤 괄호 제거 - 더 정확한 패턴 (.jpg) → .jpg
    normalizedImageUrl = normalizedImageUrl.replace(/(\.(jpg|jpeg|png|gif|webp))\)/gi, '$1');
    
    // 잘못된 이미지 타입 수정
    ['screen', 'diagram', 'dual', 'mode', 'single', 'take'].forEach(invalidType => {
      if (normalizedImageUrl.includes(`galaxy_s25_${invalidType}_`)) {
        normalizedImageUrl = normalizedImageUrl.replace(`galaxy_s25_${invalidType}_`, 'galaxy_s25_figure_');
        console.log(`이미지 타입 수정 (${invalidType} -> figure):`, normalizedImageUrl);
      }
    });

    // URL 검증
    try {
      new URL(normalizedImageUrl);
    } catch (e) {
      console.error('잘못된 URL 형식:', normalizedImageUrl);
      return NextResponse.json(
        { error: '잘못된 URL 형식입니다.' },
        { status: 400 }
      );
    }

    // URL이 허용된 도메인인지 확인
    const isSupabaseUrl = normalizedImageUrl.includes('supabase.co');
    const isLocalPath = normalizedImageUrl.startsWith('/');
    const hasImageExtension = normalizedImageUrl.split('?')[0].match(/\.(jpg|jpeg|png|gif|webp|svg)$/i) !== null;
    
    console.log('URL 타입:', { isSupabaseUrl, isLocalPath, hasImageExtension });

    if (!isSupabaseUrl && !isLocalPath && !hasImageExtension) {
      console.error('허용되지 않은 이미지 도메인 또는 형식:', normalizedImageUrl);
      return NextResponse.json(
        { error: '허용되지 않은 이미지 도메인 또는 형식입니다.' },
        { status: 403 }
      );
    }

    // 이미지 URL 정규화
    let finalImageUrl = normalizedImageUrl;
    if (isLocalPath) {
      const supabaseStorageUrl = process.env.NEXT_PUBLIC_SUPABASE_STORAGE_URL ||
                               'https://ywvoksfszaelkceectaa.supabase.co/storage/v1';
      finalImageUrl = `${supabaseStorageUrl}${normalizedImageUrl}`;
      console.log('로컬 경로를 절대 URL로 변환:', finalImageUrl);
    }

    // 이미지 가져오기 (타임아웃 5초)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(finalImageUrl, {
        signal: controller.signal,
        headers: {
          'Accept': 'image/*'
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error('이미지 가져오기 실패:', response.status, response.statusText);
        return NextResponse.json(
          { error: '이미지를 가져올 수 없습니다.' },
          { status: response.status }
        );
      }

      // Content-Type 확인
      const contentType = response.headers.get('content-type');
      if (!contentType || !ALLOWED_IMAGE_TYPES.some(type => contentType.startsWith(type))) {
        console.error('허용되지 않은 Content-Type:', contentType);
        return NextResponse.json(
          { error: '허용되지 않은 이미지 형식입니다.' },
          { status: 415 }
        );
      }

      // 이미지 데이터 스트림
      const imageData = await response.arrayBuffer();

      // 응답 헤더 설정
      const headers = new Headers();
      headers.set('Content-Type', contentType);
      headers.set('Cache-Control', bypassCache ? CACHE_CONTROL.private : CACHE_CONTROL.public);
      headers.set('Access-Control-Allow-Origin', '*');  // CORS 허용

      // 디버깅 정보를 헤더에 추가
      headers.set('X-Original-Url', normalizedImageUrl);
      headers.set('X-Proxy-Status', 'success');

      // 원본 이미지의 캐시 관련 헤더 복사
      ['etag', 'last-modified'].forEach(header => {
        const value = response.headers.get(header);
        if (value) headers.set(header, value);
      });

      return new NextResponse(imageData, {
        status: 200,
        headers
      });

    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof Error && error.name === 'AbortError') {
        console.error('이미지 가져오기 타임아웃');
        return NextResponse.json(
          { error: '이미지 가져오기 시간이 초과되었습니다.' },
          { status: 504 }
        );
      }

      console.error('이미지 가져오기 중 오류 발생:', error);
      return NextResponse.json(
        { error: '이미지를 가져오는 중 오류가 발생했습니다.' },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('프록시 처리 중 오류 발생:', error);
    return NextResponse.json(
      { error: '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
} 