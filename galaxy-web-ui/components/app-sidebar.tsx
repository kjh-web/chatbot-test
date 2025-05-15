'use client';

import type { User } from 'next-auth';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';

import { PlusIcon } from '@/components/icons';
import { SidebarHistory } from '@/components/sidebar-history';
import { SidebarUserNav } from '@/components/sidebar-user-nav';
import { Button } from '@/components/ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  useSidebar,
} from '@/components/ui/sidebar';
import Link from 'next/link';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

export function AppSidebar({ user }: { user: User | undefined }) {
  const router = useRouter();
  const { setOpenMobile } = useSidebar();

  return (
    <Sidebar className="group-data-[side=left]:border-r-0 bg-gray-50">
      <SidebarHeader className="bg-gradient-to-r from-galaxy-navy via-galaxy-blue to-galaxy-purple text-white shadow-galaxy h-14">
        <SidebarMenu className="h-full">
          <div className="flex flex-row justify-between items-center h-full">
            <Link
              href="/"
              onClick={() => {
                setOpenMobile(false);
              }}
              className="flex flex-row gap-3 items-center"
            >
              <span className="text-lg font-semibold px-2 hover:bg-white/10 rounded-md cursor-pointer transition-colors duration-200">
                Galaxy S25
              </span>
            </Link>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  type="button"
                  className="p-2 h-fit text-white hover:bg-white/20 transition-all duration-200"
                  onClick={() => {
                    setOpenMobile(false);
                    router.push('/');
                    router.refresh();
                  }}
                >
                  <PlusIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent align="end">New Chat</TooltipContent>
            </Tooltip>
          </div>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="px-2 py-3">
        <div className="space-y-1 animate-fade-in">
          <SidebarHistory user={user} />
        </div>
      </SidebarContent>
      <SidebarFooter className="border-t border-gray-200 bg-white/50">
        {user ? (
          <SidebarUserNav user={user} />
        ) : (
          <div className="p-3">
            <Button 
              className="w-full bg-galaxy-blue hover:bg-galaxy-navy text-white"
              onClick={() => {
                // 즉시 실행 함수로 로그인 처리
                (async () => {
                  try {
                    // 먼저 로그아웃 시도 (기존 세션 제거)
                    await signOut({ redirect: false });
                    console.log('[SIDEBAR] 기존 세션 정리 완료');
                  } catch (e) {
                    console.error('[SIDEBAR] 세션 정리 오류:', e);
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
                    console.error('[SIDEBAR] 스토리지 정리 오류:', e);
                  }
                  
                  console.log('[SIDEBAR] 로그인 버튼 클릭 - 쿠키 삭제 후 로그인 페이지로 이동');
                  
                  // 직접 URL로 이동 - 타임스탬프와 강제 파라미터 추가
                  window.location.href = '/login?force=true&t=' + Date.now();
                })();
              }}
            >
              로그인
            </Button>
            <div className="text-center mt-2 text-xs text-gray-500">
              <span>계정이 없으신가요? </span>
              <Button
                variant="link"
                className="text-galaxy-blue hover:underline p-0 h-auto font-normal"
                onClick={() => {
                  window.location.href = '/register?t=' + Date.now();
                }}
              >
                회원가입
              </Button>
            </div>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
