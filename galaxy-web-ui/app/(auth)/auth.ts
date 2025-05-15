import { compare } from 'bcrypt-ts';
import NextAuth, { type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { createGuestUser, getUser } from '@/lib/db/queries';
import { authConfig } from './auth.config';
import { DUMMY_PASSWORD } from '@/lib/constants';
import type { DefaultJWT } from 'next-auth/jwt';

export type UserType = 'guest' | 'regular';

declare module 'next-auth' {
  interface Session extends DefaultSession {
    user: {
      id: string;
      type: UserType;
    } & DefaultSession['user'];
  }

  interface User {
    id?: string;
    email?: string | null;
    type: UserType;
  }
}

declare module 'next-auth/jwt' {
  interface JWT extends DefaultJWT {
    id: string;
    type: UserType;
  }
}

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {},
      async authorize({ email, password }: any) {
        try {
          console.log('[AUTH] 로그인 시도:', email);
        const users = await getUser(email);

        if (users.length === 0) {
            console.log('[AUTH] 사용자가 존재하지 않음:', email);
          await compare(password, DUMMY_PASSWORD);
          return null;
        }

        const [user] = users;

        if (!user.password) {
            console.log('[AUTH] 비밀번호가 설정되지 않음:', email);
          await compare(password, DUMMY_PASSWORD);
          return null;
        }

        const passwordsMatch = await compare(password, user.password);

          if (!passwordsMatch) {
            console.log('[AUTH] 비밀번호 불일치:', email);
            return null;
          }

          console.log('[AUTH] 로그인 성공:', email);
        return { ...user, type: 'regular' };
        } catch (error) {
          console.error('[AUTH] 로그인 과정 오류:', error);
          return null;
        }
      },
    }),
    Credentials({
      id: 'guest',
      credentials: {},
      async authorize() {
        try {
          console.log('[AUTH] 게스트 로그인 시도');
        const [guestUser] = await createGuestUser();
          console.log('[AUTH] 게스트 로그인 성공');
        return { ...guestUser, type: 'guest' };
        } catch (error) {
          console.error('[AUTH] 게스트 로그인 오류:', error);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.type = user.type;
        console.log('[AUTH] JWT 생성:', token.id);
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.type = token.type;
        console.log('[AUTH] 세션 업데이트:', session.user.id);
      }

      return session;
    },
    async authorized({ auth, request }) {
      const isAuthorized = !!auth?.user;
      console.log('[AUTH] 인증 여부:', isAuthorized ? '성공' : '실패', '경로:', request.nextUrl.pathname);
      return isAuthorized;
    }
  },
});
