'use client';

import { isToday, isYesterday, subMonths, subWeeks } from 'date-fns';
import { useParams, useRouter } from 'next/navigation';
import type { User } from 'next-auth';
import { useState } from 'react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  useSidebar,
} from '@/components/ui/sidebar';
import type { Chat } from '@/lib/db/schema';
import { fetcher } from '@/lib/utils';
import { ChatItem } from './sidebar-history-item';
import useSWRInfinite from 'swr/infinite';
import { LoaderIcon } from './icons';

// API로부터 오는 실제 데이터 타입을 확장하여 사용
type ExtendedChat = Chat & {
  created_at?: string | Date;
  createdAt?: string | Date;
};

type GroupedChats = {
  today: ExtendedChat[];
  yesterday: ExtendedChat[];
  lastWeek: ExtendedChat[];
  lastMonth: ExtendedChat[];
  older: ExtendedChat[];
};

export interface ChatHistory {
  chats: Array<ExtendedChat>;
  hasMore: boolean;
}

const PAGE_SIZE = 20;

const groupChatsByDate = (chats: ExtendedChat[]): GroupedChats => {
  const now = new Date();
  const oneWeekAgo = subWeeks(now, 1);
  const oneMonthAgo = subMonths(now, 1);

  return chats.reduce(
    (groups, chat) => {
      const dateToUse = chat.created_at || chat.createdAt;
      const chatDate = new Date(dateToUse);

      if (isToday(chatDate)) {
        groups.today.push(chat);
      } else if (isYesterday(chatDate)) {
        groups.yesterday.push(chat);
      } else if (chatDate > oneWeekAgo) {
        groups.lastWeek.push(chat);
      } else if (chatDate > oneMonthAgo) {
        groups.lastMonth.push(chat);
      } else {
        groups.older.push(chat);
      }

      return groups;
    },
    {
      today: [],
      yesterday: [],
      lastWeek: [],
      lastMonth: [],
      older: [],
    } as GroupedChats,
  );
};

export function getChatHistoryPaginationKey(
  pageIndex: number,
  previousPageData: ChatHistory,
) {
  if (previousPageData && previousPageData.hasMore === false) {
    return null;
  }

  if (pageIndex === 0) return `/api/history?limit=${PAGE_SIZE}`;

  const firstChatFromPage = previousPageData.chats.at(-1);

  if (!firstChatFromPage) return null;

  return `/api/history?ending_before=${firstChatFromPage.id}&limit=${PAGE_SIZE}`;
}

export function SidebarHistory({ user }: { user: User | undefined }) {
  const { setOpenMobile } = useSidebar();
  const { id } = useParams();

  console.log("사이드바 사용자 상태:", user ? {
    id: user.id,
    email: user.email,
    로그인여부: !!user
  } : "로그인 안됨");

  const {
    data: paginatedChatHistories,
    setSize,
    isValidating,
    isLoading,
    mutate,
  } = useSWRInfinite<ChatHistory>(
    // 로그인 사용자의 경우에만 API 요청을 수행하고, 비로그인 사용자는 null 반환
    user ? getChatHistoryPaginationKey : () => null,
    fetcher,
    {
    fallbackData: [],
      // 캐시 설정 추가: 중복 요청 방지
      dedupingInterval: 5000, // 5초 동안 중복 요청 방지
      revalidateOnFocus: false, // 탭 포커스 시 자동 재검증 비활성화
    }
  );

  // 모든 채팅 표시하도록 변경
  console.log("채팅 기록 데이터:", paginatedChatHistories ? {
    페이지수: paginatedChatHistories.length,
    전체채팅수: paginatedChatHistories.reduce((total, page) => total + page.chats.length, 0),
    첫페이지_채팅수: paginatedChatHistories[0]?.chats.length || 0,
    오류여부: paginatedChatHistories.some(page => page === undefined)
  } : "데이터 없음");

  if (paginatedChatHistories && paginatedChatHistories.length > 0 && paginatedChatHistories[0].chats.length > 0) {
    console.log("첫 번째 채팅:", {
      id: paginatedChatHistories[0].chats[0].id,
      title: paginatedChatHistories[0].chats[0].title,
      created_at: paginatedChatHistories[0].chats[0].created_at
    });
  }

  const router = useRouter();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const hasReachedEnd = paginatedChatHistories
    ? paginatedChatHistories.some((page) => page.hasMore === false)
    : false;

  const hasEmptyChatHistory = paginatedChatHistories
    ? paginatedChatHistories.every((page) => page.chats.length === 0)
    : false;

  const handleDelete = async () => {
    const deletePromise = fetch(`/api/chat?id=${deleteId}`, {
      method: 'DELETE',
    });

    toast.promise(deletePromise, {
      loading: '채팅을 삭제 중입니다...',
      success: () => {
        mutate((chatHistories) => {
          if (chatHistories) {
            return chatHistories.map((chatHistory) => ({
              ...chatHistory,
              chats: chatHistory.chats.filter((chat) => chat.id !== deleteId),
            }));
          }
        });

        return '채팅이 삭제되었습니다';
      },
      error: '채팅 삭제 실패',
    });

    setShowDeleteDialog(false);

    if (deleteId === id) {
      router.push('/');
    }
  };

  if (!user) {
    return (
      <SidebarGroup>
        <SidebarGroupContent>
          <div className="p-4 text-center text-sm text-gray-500">
            로그인하여 채팅을 저장하세요.
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  if (isLoading) {
    return (
      <SidebarGroup>
        <SidebarGroupContent>
          <div className="flex flex-col p-2 gap-3">
            {[44, 32, 28, 64, 52].map((item) => (
              <div
                key={item}
                className="rounded-md h-12 flex gap-2 px-2 items-center"
              >
                <div
                  className="h-[18px] bg-sidebar-foreground/20 rounded animate-pulse"
                  style={{ width: `${item}%` }}
                />
              </div>
            ))}
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  if (hasEmptyChatHistory) {
    return (
      <SidebarGroup>
        <SidebarGroupContent>
          <div className="p-4 text-center text-sm text-gray-500">
            최근 채팅 기록이 표시됩니다.
        </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  // 모든 채팅 표시
  const allChats = paginatedChatHistories?.flatMap(page => page.chats) || [];

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <div className="flex flex-col gap-2 mt-1">
              {allChats.map((chat) => (
                <ChatItem
                  key={chat.id}
                  chat={chat}
                  isActive={chat.id === id}
                  onDelete={(chatId) => {
                    setDeleteId(chatId);
                    setShowDeleteDialog(true);
                  }}
                  setOpenMobile={setOpenMobile}
                />
              ))}
            </div>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>정말 삭제하시겠습니까?</AlertDialogTitle>
            <AlertDialogDescription>
              이 작업은 되돌릴 수 없습니다. 채팅이 영구적으로 삭제됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
