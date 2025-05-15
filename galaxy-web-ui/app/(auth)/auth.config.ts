import type { NextAuthConfig } from 'next-auth';

export const authConfig = {
  pages: {
    signIn: '/login',
    signOut: '/login',
    error: '/login',
    newUser: '/',
  },
  providers: [
    // added later in auth.ts since it requires bcrypt which is only compatible with Node.js
    // while this file is also used in non-Node.js environments
  ],
  callbacks: {
    // 인증 상태 확인 및 페이지 보호
    async authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const { pathname, searchParams } = request.nextUrl;
      
      // 디버깅을 위한 로그 추가
      console.log(`[AUTH-DEBUG] 요청 경로: ${pathname}, 로그인 상태: ${isLoggedIn}, 사용자: ${auth?.user?.email || '없음'}`);
      
      // 로그인 페이지에 force 파라미터가 있는 경우, 세션 상태와 무관하게 로그인 페이지 표시
      if (pathname === '/login' && searchParams.has('force')) {
        console.log(`[AUTH-DEBUG] 강제 로그인 페이지 접근 감지 - 세션 상태 무시하고 로그인 페이지 표시`);
        return true;
      }
      
      // 로그인 페이지에 타임스탬프 파라미터가 있는 경우, 항상 로그인 페이지 표시 (강제 로그인 페이지 접근)
      if (pathname === '/login' && searchParams.has('t')) {
        console.log(`[AUTH-DEBUG] 타임스탬프 파라미터가 있는 로그인 페이지 접근 - 세션 무시하고 로그인 페이지 표시`);
        return true;
      }
      
      // 로그인 페이지나 API 경로는 별도 처리
      if (pathname.startsWith('/api/auth') || 
          pathname.startsWith('/_next') ||
          pathname.includes('favicon.ico')) {
        return true;
      }

      // 로그인한 사용자가 로그인/회원가입 페이지에 접근하면 홈으로 리다이렉션
      if ((pathname === '/login' || pathname === '/register') && isLoggedIn) {
        console.log(`[AUTH-DEBUG] 로그인된 사용자가 로그인/회원가입 페이지에 접근: ${pathname}, ${auth?.user?.email}`);
        return Response.redirect(new URL('/', request.url));
      }

      // 로그인/회원가입 페이지는 모든 사용자 접근 가능
      if (pathname === '/login' || pathname === '/register') {
        console.log(`[AUTH-DEBUG] 로그인/회원가입 페이지 접근 허용: ${pathname}`);
        return true;
      }
      
      // 채팅/홈페이지와 루트 페이지는 모든 사용자 접근 가능 - 로그인 없이도 채팅 허용
      if (pathname === '/' || pathname.startsWith('/chat')) {
        console.log(`[AUTH-DEBUG] 채팅/홈페이지 접근: ${pathname}, 로그인 상태: ${isLoggedIn}`);
        return true;
      }

      // 그 외 보호된 페이지에서는 로그인한 사용자만 접근 가능
      return isLoggedIn;
    }
  },
  trustHost: true,
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "galaxy-s25-dev-secret-key",
  session: {
    // JWT 세션 사용 (기본값)
    strategy: "jwt",
    // 세션 최대 유효 시간 (초 단위) - 30일
    maxAge: 30 * 24 * 60 * 60,
    // 세션 업데이트 빈도 (초 단위) - 1일 (적절한 균형)
    updateAge: 24 * 60 * 60,
  },
  // JWT 설정
  jwt: {
    maxAge: 30 * 24 * 60 * 60 // 30일
  },
  // 쿠키 설정
  cookies: {
    sessionToken: {
      name: `next-auth.session-token`,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 30 * 24 * 60 * 60 // 30일
      }
    },
    callbackUrl: {
      name: `next-auth.callback-url`,
      options: {
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production'
      }
    },
    csrfToken: {
      name: `next-auth.csrf-token`,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production'
      }
    }
  },
  // 디버깅
  debug: process.env.NODE_ENV === 'development',
  // 이벤트 핸들러
  events: {
    async signOut(message) {
      console.log("[AUTH] 사용자 로그아웃");
    },
    async signIn(message) {
      console.log("[AUTH] 사용자 로그인:", message?.user?.email || '알 수 없는 사용자');
    },
    async linkAccount({ user }) {
      console.log("[AUTH] 계정 연결:", user.email);
    },
    async session({ session }) {
      console.log("[AUTH] 세션 업데이트:", session.user?.email);
    }
  }
} satisfies NextAuthConfig;
