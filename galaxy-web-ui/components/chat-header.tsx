'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useWindowSize } from 'usehooks-ts';

import { ModelSelector } from '@/components/model-selector';
import { SidebarToggle } from '@/components/sidebar-toggle';
import { Button } from '@/components/ui/button';
import { PlusIcon, VercelIcon, LoginIcon, LogoutIcon } from './icons';
import { useSidebar } from './ui/sidebar';
import { memo } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { type VisibilityType, VisibilitySelector } from './visibility-selector';
import type { Session } from 'next-auth';
import { signOut } from 'next-auth/react';

function PureChatHeader({
  chatId,
  selectedModelId,
  selectedVisibilityType,
  isReadonly,
  session,
}: {
  chatId: string;
  selectedModelId: string;
  selectedVisibilityType: VisibilityType;
  isReadonly: boolean;
  session: Session | null;
}) {
  const router = useRouter();
  const { open } = useSidebar();

  const { width: windowWidth } = useWindowSize();

  // 로그인/로그아웃 처리 함수
  const handleLogin = () => {
    // 즉시 실행 함수로 로그인 처리
    (async () => {
      try {
        // 먼저 로그아웃 시도 (기존 세션 제거)
        await signOut({ redirect: false });
        console.log('[HEADER] 기존 세션 정리 완료');
      } catch (e) {
        console.error('[HEADER] 세션 정리 오류:', e);
      }

      // 쿠키 강제 삭제 시도
      document.cookie = 'next-auth.session-token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'; 
      document.cookie = 'next-auth.csrf-token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
      document.cookie = 'next-auth.callback-url=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
      document.cookie = 'authjs.session-token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'; 
      document.cookie = 'authjs.csrf-token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
      document.cookie = 'authjs.callback-url=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
      
      // 로컬/세션 스토리지도 정리
      try {
        localStorage.removeItem('nextauth.message');
        sessionStorage.clear();
      } catch (e) {
        console.error('[HEADER] 스토리지 정리 오류:', e);
      }
      
      console.log('[HEADER] 로그인 버튼 클릭 - 쿠키 삭제 후 로그인 페이지로 이동');
      
      // 직접 URL로 이동 - 타임스탬프와 강제 파라미터 추가
      window.location.href = '/login?force=true&t=' + Date.now();
    })();
  };

  const handleLogout = async () => {
    await signOut({ redirect: true, callbackUrl: '/' });
  };

  return (
    <header className="flex sticky top-0 bg-gradient-to-r from-galaxy-navy via-galaxy-blue to-galaxy-purple animate-gradient-x items-center px-3 md:px-4 gap-2 shadow-galaxy z-50 h-14">
      <div className="flex items-center gap-2 w-full">
        <SidebarToggle />

        {(!open || windowWidth < 768) && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                className="order-2 md:order-1 md:px-2 px-2 md:h-fit ml-auto md:ml-0 text-white bg-white/10 hover:bg-white/20 border-white/20 backdrop-blur-sm transition-all duration-300 ease-in-out shadow-sm animate-pulse-slow"
                onClick={() => {
                  router.push('/');
                  router.refresh();
                }}
              >
                <PlusIcon />
                <span className="md:sr-only">New Chat</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>New Chat</TooltipContent>
          </Tooltip>
        )}

        {!isReadonly && session && (
          <ModelSelector
            session={session}
            selectedModelId={selectedModelId}
            className="order-1 md:order-2 animate-fade-in"
          />
        )}

        {!isReadonly && session && (
          <VisibilitySelector
            chatId={chatId}
            selectedVisibilityType={selectedVisibilityType}
            className="order-1 md:order-3 animate-fade-in"
          />
        )}

        {/* 로그인/로그아웃 버튼 */}
        {!session ? (
          <Tooltip>
            <TooltipTrigger asChild>
        <Button
                variant="outline"
                className="order-4 md:order-4 md:ml-auto text-white bg-white/10 hover:bg-white/20 border-white/20 backdrop-blur-sm transition-all duration-300 ease-in-out shadow-sm"
                onClick={handleLogin}
              >
                <LoginIcon className="mr-1" />
                <span className="hidden md:inline">로그인</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>로그인하여 채팅 기록 저장하기</TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                className="order-4 md:order-4 md:ml-auto text-white bg-white/10 hover:bg-white/20 border-white/20 backdrop-blur-sm transition-all duration-300 ease-in-out shadow-sm"
                onClick={handleLogout}
          >
                <LogoutIcon className="mr-1" />
                <span className="hidden md:inline">로그아웃</span>
        </Button>
            </TooltipTrigger>
            <TooltipContent>로그아웃</TooltipContent>
          </Tooltip>
        )}
      </div>
    </header>
  );
}

export const ChatHeader = memo(PureChatHeader, (prevProps, nextProps) => {
  return prevProps.selectedModelId === nextProps.selectedModelId;
});
