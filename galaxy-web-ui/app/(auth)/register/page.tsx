'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState, useRef, startTransition } from 'react';

import { AuthForm } from '@/components/auth-form';
import { SubmitButton } from '@/components/submit-button';
import { Button } from '@/components/ui/button';

import { register, type RegisterActionState } from '../actions';
import { toast } from '@/components/toast';
import { useSession } from 'next-auth/react';

export default function Page() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [isSuccessful, setIsSuccessful] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const submitTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const redirectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const successToastShownRef = useRef(false);
  const lastTimestampRef = useRef<number | null>(null);

  const [state, formAction] = useActionState<RegisterActionState, FormData>(
    register,
    {
      status: 'idle',
    },
  );

  // 세션 훅 사용 (간단한 옵션만 적용)
  const { update: updateSession } = useSession({
    required: false,
  });

  // 디버깅 로그
  useEffect(() => {
    console.log('현재 상태:', state.status, '타임스탬프:', state.timestamp);
    console.log('UI 상태:', { isSubmitting, isSuccessful, isRedirecting });
  }, [state, isSubmitting, isSuccessful, isRedirecting]);

  // 상태 변경 효과 처리
  useEffect(() => {
    // 타임스탬프가 변경되지 않았다면 동일한 응답으로 간주하여 처리하지 않음
    if (state.timestamp && lastTimestampRef.current === state.timestamp) {
      console.log('동일한 타임스탬프, 처리 건너뜀:', state.timestamp);
      return;
    }

    // 타임스탬프 업데이트
    if (state.timestamp) {
      lastTimestampRef.current = state.timestamp;
    }

    // 상태에 따른 UI 처리
    if (state.status === 'user_exists') {
      toast({ type: 'error', description: '이미 존재하는 계정입니다!' });
      setIsSubmitting(false);
      setIsSuccessful(false);
      setIsRedirecting(false);
      
      // 모든 타이머 정리
      clearAllTimeouts();
    } else if (state.status === 'database_error') {
      toast({ 
        type: 'error', 
        description: state.error || '데이터베이스 연결 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' 
      });
      setIsSubmitting(false);
      setIsSuccessful(false);
      setIsRedirecting(false);
      
      // 모든 타이머 정리
      clearAllTimeouts();
    } else if (state.status === 'failed') {
      toast({ type: 'error', description: '계정 생성에 실패했습니다!' });
      setIsSubmitting(false);
      setIsSuccessful(false);
      setIsRedirecting(false);
      
      // 모든 타이머 정리
      clearAllTimeouts();
    } else if (state.status === 'invalid_data') {
      toast({
        type: 'error',
        description: '입력하신 정보를 검증하는데 실패했습니다!',
      });
      setIsSubmitting(false);
      setIsSuccessful(false);
      setIsRedirecting(false);
      
      // 모든 타이머 정리
      clearAllTimeouts();
    } else if (state.status === 'success' && !isRedirecting) {
      // 성공 상태이고 아직 리다이렉션 처리가 되지 않은 경우에만 실행
      console.log('성공 상태 처리 시작');
      setIsSuccessful(true);
      setIsRedirecting(true);
      
      // 성공 토스트를 한 번만 표시
      if (!successToastShownRef.current) {
        successToastShownRef.current = true;
        toast({ type: 'success', description: '계정이 성공적으로 생성되었습니다!' });
      }
      
      // 세션 업데이트 한 번만 실행
      updateSession();
      
      // 성공 시 홈페이지로 즉시 리다이렉트 (추가 요청 방지)
      if (!redirectTimeoutRef.current) {
        redirectTimeoutRef.current = setTimeout(() => {
          console.log('홈페이지로 리다이렉트');
          
          // 리다이렉트 직전에 상태 초기화
          setIsSubmitting(false);
          
          router.push('/');
        }, 1000);
      }
      
      // 일정 시간 후 모든 상태 초기화
      if (!submitTimeoutRef.current) {
        submitTimeoutRef.current = setTimeout(() => {
          console.log('제출 상태 초기화');
          setIsSubmitting(false);
        }, 500);
      }
    } else if (state.status === 'in_progress') {
      // 이미 진행 중인 상태 유지
      console.log('진행 중 상태 유지');
      setIsSubmitting(true);
    } else if (state.status === 'idle' && isSubmitting) {
      // 초기 상태로 돌아온 경우 로딩 상태 해제
      console.log('초기 상태로 리셋');
      setIsSubmitting(false);
      setIsSuccessful(false);
      setIsRedirecting(false);
    }
    
  }, [state, router, updateSession, isRedirecting]);

  // 타이머 정리 함수
  const clearAllTimeouts = () => {
    if (submitTimeoutRef.current) {
      clearTimeout(submitTimeoutRef.current);
      submitTimeoutRef.current = null;
    }
    if (redirectTimeoutRef.current) {
      clearTimeout(redirectTimeoutRef.current);
      redirectTimeoutRef.current = null;
    }
  };
  
  // 컴포넌트 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      clearAllTimeouts();
    };
  }, []);

  // 폼 제출 처리 함수
  const handleSubmit = (formData: FormData) => {
    // 이메일 상태 저장
    setEmail(formData.get('email') as string);
    
    // 중복 제출 방지
    if (isSubmitting || state.status === 'in_progress' || isSuccessful || isRedirecting) {
      console.log('제출 무시: 이미 처리 중이거나 성공 상태');
      return;
    }
    
    // 상태 초기화
    console.log('폼 제출 시작');
    successToastShownRef.current = false;
    setIsRedirecting(false);
    setIsSuccessful(false);
    
    // 제출 시작
    setIsSubmitting(true);
    
    // startTransition 내에서 서버 액션 호출
    startTransition(() => {
      formAction(formData);
    });
  };

  // UI 렌더링
  const buttonText = isSubmitting 
    ? '처리 중...' 
    : isRedirecting 
      ? '성공!' 
      : isSuccessful 
        ? '완료됨' 
        : '회원가입';

  return (
    <div className="flex h-dvh w-screen items-start pt-12 md:pt-0 md:items-center justify-center bg-background">
      <div className="w-full max-w-md overflow-hidden rounded-2xl gap-12 flex flex-col">
        <div className="flex flex-col items-center justify-center gap-2 px-4 text-center sm:px-16">
          <h3 className="text-xl font-semibold dark:text-zinc-50">회원가입</h3>
          <p className="text-sm text-gray-500 dark:text-zinc-400">
            이메일과 비밀번호로 회원가입하세요.
          </p>
        </div>
        <AuthForm action={handleSubmit} defaultEmail={email} isLogin={false}>
          <SubmitButton 
            isSuccessful={isSuccessful} 
            disabled={isSubmitting || isRedirecting}
          >
            {buttonText}
          </SubmitButton>
          <p className="text-center text-sm text-gray-600 mt-4 dark:text-zinc-400">
            {'계정이 있으신가요? '}
            <Button
              variant="link"
              className="font-semibold text-gray-800 hover:underline dark:text-zinc-200 p-0 h-auto"
              onClick={() => {
                window.location.href = '/login?force=true&t=' + Date.now();
              }}
            >
              로그인
            </Button>
            {'하세요.'}
          </p>
        </AuthForm>
      </div>
    </div>
  );
}
