'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState, useRef, startTransition } from 'react';
import { toast } from '@/components/toast';

import { AuthForm } from '@/components/auth-form';
import { SubmitButton } from '@/components/submit-button';

import { login, type LoginActionState } from '../actions';
import { useSession, signIn } from 'next-auth/react';

export default function Page() {
  const router = useRouter();
  const { update: updateSession, status: sessionStatus, data: session } = useSession();

  const [email, setEmail] = useState('');
  const [isSuccessful, setIsSuccessful] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const lastTimestampRef = useRef<number | null>(null);
  const redirectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasRedirected = useRef(false);
  const redirectAttempts = useRef(0);

  const [state, formAction] = useActionState<LoginActionState, FormData>(
    login,
    {
      status: 'idle',
    },
  );

  // 디버깅 로그
  useEffect(() => {
    console.log(`[LOGIN PAGE] 세션 상태: ${sessionStatus}, 이메일: ${session?.user?.email || '없음'}`);
  }, [sessionStatus, session]);

  // 타이머 정리 함수
  const clearRedirectTimeout = () => {
    if (redirectTimeoutRef.current) {
      clearTimeout(redirectTimeoutRef.current);
      redirectTimeoutRef.current = null;
    }
  };

  // 리다이렉션 함수
  const redirectToHome = () => {
    setIsRedirecting(true);
    console.log('홈페이지로 리다이렉션 실행 중...');
    
    // 세션 스토리지 초기화 (추가)
    try {
      sessionStorage.clear();
    } catch (e) {
      console.error('세션 스토리지 초기화 오류:', e);
    }
    
    // 브라우저 캐시 초기화를 위한 임의 쿼리 파라미터 추가
    const timestamp = new Date().getTime();
    const url = `/?t=${timestamp}`;
    
    // 하드 리다이렉션 - URL을 완전히 변경
    window.location.href = url;
  };

  useEffect(() => {
    // URL에 force 파라미터가 있으면 세션 상태와 무관하게 로그인 페이지 유지
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('force') || urlParams.has('t')) {
      console.log('[LOGIN PAGE] 강제 로그인 모드 - 자동 리다이렉션 비활성화');
      // 쿠키 강제 삭제 시도 (클라이언트 측)
      document.cookie = 'next-auth.session-token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'; 
      document.cookie = 'next-auth.csrf-token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
      document.cookie = 'next-auth.callback-url=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
      document.cookie = 'authjs.session-token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'; 
      document.cookie = 'authjs.csrf-token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
      document.cookie = 'authjs.callback-url=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
      return;
    }

    // 강제 모드가 아닌 경우에만 세션에 따른 자동 리다이렉션 수행
    if (hasRedirected.current || sessionStatus !== 'authenticated' || !session?.user) {
      return;
    }

    console.log('세션 인증됨, 홈페이지로 이동합니다.', session.user.email);
    
    // 무한 리다이렉션 방지 (최대 3번만 시도)
    if (redirectAttempts.current >= 3) {
      console.warn('리다이렉션 최대 시도 횟수 초과, 리다이렉션 중단');
      return;
    }
    
    hasRedirected.current = true;
    setIsRedirecting(true);
    redirectAttempts.current += 1;

    // 리다이렉션 실행
    clearRedirectTimeout();
    redirectToHome();
  }, [sessionStatus, session]);

  useEffect(() => {
    // 디버깅을 위한 로그
    console.log('로그인 상태:', state.status, '타임스탬프:', state.timestamp, '세션 상태:', sessionStatus);
    
    // 타임스탬프가 변경되지 않았다면 중복 처리 방지
    if (state.timestamp && lastTimestampRef.current === state.timestamp) {
      return;
    }
    
    // 타임스탬프 업데이트
    if (state.timestamp) {
      lastTimestampRef.current = state.timestamp;
    }
    
    if (state.status === 'failed') {
      setIsSubmitting(false);
      toast({
        type: 'error',
        description: state.error || '계정 정보가 일치하지 않습니다.',
      });
      clearRedirectTimeout();
    } else if (state.status === 'account_not_found') {
      setIsSubmitting(false);
      toast({
        type: 'error',
        description: state.error || '등록된 계정을 찾을 수 없습니다.',
      });
      clearRedirectTimeout();
    } else if (state.status === 'invalid_data') {
      setIsSubmitting(false);
      toast({
        type: 'error',
        description: '이메일 또는 비밀번호 형식이 올바르지 않습니다.',
      });
      clearRedirectTimeout();
    } else if (state.status === 'success') {
      console.log('로그인 성공, 세션 업데이트 중');
      setIsSuccessful(true);
      
      // 세션 업데이트 후 수동으로 다시 확인
      updateSession().then(() => {
        // 세션이 업데이트 되었으므로 직접 리다이렉션 시도
        redirectTimeoutRef.current = setTimeout(() => {
          if (redirectAttempts.current < 3) {
            console.log('로그인 성공 리다이렉션 실행');
            redirectToHome();
    }
        }, 1500);
      });
    } else if (state.status === 'in_progress') {
      setIsSubmitting(true);
    } else if (state.status === 'idle' && isSubmitting) {
      setIsSubmitting(false);
    }
  }, [state, updateSession, isSubmitting, sessionStatus]);
  
  // 컴포넌트 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      clearRedirectTimeout();
    };
  }, []);

  const handleSubmit = (formData: FormData) => {
    // 이미 제출 중이거나 성공한 경우 중복 제출 방지
    if (isSubmitting || isSuccessful || hasRedirected.current || isRedirecting) {
      return;
    }
    
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;
    
    setEmail(email);
    setIsSubmitting(true);
    
    // 디버깅 로그 추가
    console.log('[LOGIN] 로그인 시도 시작:', email);
    
    // 쿠키 만료 시간을 과거로 설정하여 강제 삭제 시도
    document.cookie = 'next-auth.session-token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    document.cookie = 'next-auth.csrf-token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    document.cookie = 'next-auth.callback-url=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    
    // 로컬 스토리지와 세션 스토리지 정리
    try {
      localStorage.removeItem('nextauth.message');
      sessionStorage.clear();
    } catch (e) {
      console.error('스토리지 정리 오류:', e);
    }
    
    // 짧은 지연 후 로그인 시도 (쿠키가 정리될 시간 확보)
    setTimeout(() => {
      // 직접 로그인 시도
      signIn('credentials', {
        email,
        password,
        redirect: false,
        callbackUrl: '/?login=' + new Date().getTime() // 캐시 방지를 위한 타임스탬프 추가
      }).then((result) => {
        console.log('[LOGIN] 로그인 결과:', result);
        
        if (result?.error) {
          console.error('[LOGIN] 로그인 실패:', result.error);
          setIsSubmitting(false);
          toast({
            type: 'error',
            description: '계정 정보가 일치하지 않습니다.',
          });
        } else {
          console.log('[LOGIN] 로그인 성공!');
          setIsSuccessful(true);
          
          // 세션 업데이트 후 리다이렉션
          updateSession().then(() => {
            console.log('[LOGIN] 세션 업데이트 완료, 리다이렉션 준비');
            if (redirectAttempts.current < 3) {
              redirectAttempts.current += 1;
              redirectTimeoutRef.current = setTimeout(() => {
                redirectToHome();
              }, 1000);
            }
          });
        }
      }).catch((error) => {
        console.error('[LOGIN] 로그인 오류:', error);
        setIsSubmitting(false);
        toast({
          type: 'error',
          description: '로그인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
        });
      });
    }, 200);
  };

  // 리다이렉션 중이면 로딩 표시
  if (isSuccessful || isRedirecting) {
    return (
      <div className="flex h-dvh w-screen items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-lg font-semibold mb-2">로그인 성공!</p>
          <p className="text-gray-500">홈페이지로 이동 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh w-screen items-start pt-12 md:pt-0 md:items-center justify-center bg-background">
      <div className="w-full max-w-md overflow-hidden rounded-2xl flex flex-col gap-12">
        <div className="flex flex-col items-center justify-center gap-2 px-4 text-center sm:px-16">
          <h3 className="text-xl font-semibold dark:text-zinc-50">로그인</h3>
          <p className="text-sm text-gray-500 dark:text-zinc-400">
            이메일과 비밀번호로 로그인하세요
          </p>
        </div>
        
        <div className="flex flex-col gap-4">
          {/* 통합된 로그인 폼 */}
          <AuthForm action={handleSubmit} defaultEmail={email} isLogin={true}>
            <SubmitButton 
              isSuccessful={isSuccessful} 
              disabled={isSubmitting}
            >
              {isSubmitting ? '로그인 중...' : '로그인'}
            </SubmitButton>
          </AuthForm>
          
          <p className="text-center text-sm text-gray-600 mt-4 dark:text-zinc-400">
            {"계정이 없으신가요? "}
            <Link
              href="/register"
              className="font-semibold text-gray-800 hover:underline dark:text-zinc-200"
            >
              회원가입
            </Link>
            {"하세요."}
          </p>
        </div>
      </div>
    </div>
  );
}
