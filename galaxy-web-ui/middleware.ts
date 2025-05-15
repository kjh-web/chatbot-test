import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { isDevelopmentEnvironment } from './lib/constants';

// 인증이 필요한 경로 배열
const PROTECTED_PATHS = ['/', '/chat'];

// 인증을 확인하지 않을 경로 패턴
const PUBLIC_PATHS = [
  '/login',
  '/register',
  '/api/auth',
  '/api/proxy-image',
  '/api/chat',
  '/api/history',
  '/api/vote',
  '/api',
  '/_next',
  '/favicon.ico',
  '/sitemap.xml',
  '/robots.txt',
  '/icon.svg',
  '/ping'
];

// 요청 경로가 보호된 경로인지 확인
function isProtectedPath(path: string): boolean {
  return PROTECTED_PATHS.some(prefix => 
    path === prefix || path.startsWith(`${prefix}/`)
  );
}

// 요청 경로가 공개 경로인지 확인
function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.some(prefix => 
    path === prefix || path.startsWith(prefix)
  );
}

// 이미 리다이렉션한 경로인지 확인하는 헤더 이름
const REDIRECTED_FROM = 'x-redirected-from';

// 미들웨어 디버깅 플래그 - NextAuth가 직접 처리하게 함
const USE_NEXTAUTH_ONLY = true;

export async function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // 특수 처리: 타임스탬프가 포함된 로그인 페이지 요청은 쿠키 초기화 시도
  if (pathname === '/login' && searchParams.has('t')) {
    console.log('[MIDDLEWARE] 로그인 페이지 접근 - 쿠키 초기화 요청 감지');
    
    // 응답에서 인증 관련 쿠키 제거
    const response = NextResponse.next();
    
    // 각 인증 관련 쿠키 제거 (만료 시간을 과거로 설정)
    response.cookies.set('next-auth.session-token', '', { 
      expires: new Date(0), 
      path: '/' 
    });
    response.cookies.set('next-auth.csrf-token', '', { 
      expires: new Date(0), 
      path: '/' 
    });
    response.cookies.set('next-auth.callback-url', '', { 
      expires: new Date(0), 
      path: '/' 
    });
    response.cookies.set('authjs.session-token', '', { 
      expires: new Date(0), 
      path: '/' 
    });
    response.cookies.set('authjs.csrf-token', '', { 
      expires: new Date(0), 
      path: '/' 
    });
    response.cookies.set('authjs.callback-url', '', { 
      expires: new Date(0), 
      path: '/' 
    });
    
    console.log('[MIDDLEWARE] 인증 쿠키 초기화 완료');
    return response;
  }
  
  // NextAuth에게 모든 인증 처리를 위임
  if (USE_NEXTAUTH_ONLY) {
    // 로그인 관련 경로에 대해서는 더 자세히 로깅
    if (pathname.startsWith('/api/auth/signin') || 
        pathname.startsWith('/api/auth/signout') || 
        pathname === '/login') {
      // 쿠키를 로깅해서 세션 상태 디버깅 (토큰 값은 보안을 위해 마스킹)
      const cookies = request.cookies.getAll();
      const cookieDebug = cookies.map(c => {
        // 토큰 값은 일부만 표시 (보안)
        const value = c.name.includes('token') ? 
          `${c.value.substring(0, 10)}...` : 
          (c.name.includes('next-auth') || c.name.includes('authjs') ? '[masked]' : c.value);
        return `${c.name}=${value}`;
      }).join('; ');
      
      console.log(`[MIDDLEWARE-DEBUG] 인증 관련 요청: ${pathname}`);
      console.log(`[MIDDLEWARE-DEBUG] 쿠키: ${cookieDebug}`);
    }
    
    if (isDevelopmentEnvironment) {
      console.log(`[MIDDLEWARE] 요청 경로 통과: ${pathname} (NextAuth 처리)`);
    }
    return NextResponse.next();
  }
  
  // 이하 코드는 실행되지 않음 (USE_NEXTAUTH_ONLY가 true인 경우)
  
  // 이미 리다이렉션된 요청인지 확인 (무한 리다이렉션 방지)
  const redirectedFrom = request.headers.get(REDIRECTED_FROM);
  if (redirectedFrom === pathname) {
    if (isDevelopmentEnvironment) {
      console.log(`[MIDDLEWARE] 리다이렉션 루프 감지 및 방지: ${pathname} -> ${redirectedFrom}`);
  }
    return NextResponse.next();
  }

  // API 경로는 그대로 통과 (NextAuth가 처리하도록)
  if (pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  // 디버깅을 위한 로그
  if (isDevelopmentEnvironment) {
    console.log(`[MIDDLEWARE] 요청 경로: ${pathname}`);
  }

  // 로그인/회원가입 페이지 등 공개 경로는 인증 검사 없이 통과
  if (isPublicPath(pathname)) {
    if (isDevelopmentEnvironment) {
      console.log(`[MIDDLEWARE] 공개 경로 허용: ${pathname}`);
    }
    return NextResponse.next();
  }

  // Playwright 테스트를 위한 특수 엔드포인트
  if (pathname.startsWith('/ping')) {
    return new Response('pong', { status: 200 });
  }

  // 보호된 경로(/나 /chat 등)에는 인증 검사 수행
  if (isProtectedPath(pathname)) {
    try {
      // 토큰 검사
  const token = await getToken({
    req: request,
        secureCookie: process.env.NODE_ENV === 'production',
      });

      // 토큰이 없다면 로그인 페이지로 리다이렉션
      if (!token || !token.email) {
        if (isDevelopmentEnvironment) {
          console.log(`[MIDDLEWARE] 인증 없음, 로그인 페이지로 리다이렉션: ${pathname}`);
        }
        
        // 쿠키 삭제 및 로그인 페이지로 리다이렉션
        const response = NextResponse.redirect(new URL('/login', request.url));
        
        // 리다이렉션 출처 헤더 추가 (무한 루프 방지)
        response.headers.set(REDIRECTED_FROM, pathname);
        
        return response;
      }

      // 토큰이 있으면 요청 진행
      if (isDevelopmentEnvironment) {
        console.log(`[MIDDLEWARE] 인증 확인됨 (${token.email}), 요청 진행: ${pathname}`);
      }
      return NextResponse.next();
    } catch (error) {
      console.error('[MIDDLEWARE] 인증 확인 중 오류:', error);
      // 오류 발생 시 안전하게 로그인 페이지로 리다이렉션
      const response = NextResponse.redirect(new URL('/login', request.url));
      response.headers.set(REDIRECTED_FROM, pathname);
      return response;
    }
  }

  // 그 외 경로는 기본적으로 통과
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/',
    '/chat/:path*',
    '/api/:path*',
    '/login',
    '/register',
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
  ],
};
