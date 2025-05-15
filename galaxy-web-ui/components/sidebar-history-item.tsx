import type { Chat } from '@/lib/db/schema';
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from './ui/sidebar';
import Link from 'next/link';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import {
  TrashIcon,
  MessageIcon,
  MoreHorizontalIcon
} from './icons';
import { memo } from 'react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';

// API로부터 오는 실제 데이터 타입을 확장하여 사용
type ExtendedChat = Chat & {
  created_at?: string | Date;
};

const PureChatItem = ({
  chat,
  isActive,
  onDelete,
  setOpenMobile,
}: {
  chat: ExtendedChat;
  isActive: boolean;
  onDelete: (chatId: string) => void;
  setOpenMobile: (open: boolean) => void;
}) => {
  // 날짜 형식화 - created_at 또는 createdAt 사용
  const dateToFormat = chat.created_at || chat.createdAt;
  const formattedDate = format(new Date(dateToFormat), 'MM/dd HH:mm', { locale: ko });

  return (
    <SidebarMenuItem className={cn(
      "overflow-hidden transition-all duration-200 my-1 rounded-lg",
      isActive 
        ? "bg-gradient-to-r from-galaxy-blue/5 to-galaxy-purple/3 shadow-sm" 
        : "hover:bg-galaxy-light/30"
    )}>
      <SidebarMenuButton 
        asChild 
        isActive={isActive}
        className={cn(
          "transition-all duration-200 hover:bg-galaxy-light/30 rounded-md gap-2 py-2 px-2.5",
          isActive ? "font-medium text-galaxy-blue/90" : ""
        )}
      >
        <Link href={`/chat/${chat.id}`} onClick={() => setOpenMobile(false)} className="flex flex-col w-full">
          <div className="flex items-center gap-2 w-full">
            <div className="text-galaxy-blue/60 flex items-center justify-center flex-shrink-0">
              <MessageIcon size={16} />
            </div>
            <span className="truncate font-normal text-sm">{chat.title}</span>
          </div>
          <div className="text-xs text-gray-500 mt-0.5 pl-6">
            {formattedDate}
          </div>
        </Link>
      </SidebarMenuButton>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction
            className={cn(
              "data-[state=open]:bg-galaxy-light/70 data-[state=open]:text-galaxy-blue mr-1 hover:bg-galaxy-light/50 transition-colors duration-200",
              isActive ? "text-galaxy-blue/80" : "text-gray-500"
            )}
            showOnHover={!isActive}
          >
            <MoreHorizontalIcon size={18} />
            <span className="sr-only">More</span>
          </SidebarMenuAction>
        </DropdownMenuTrigger>

        <DropdownMenuContent side="bottom" align="end" className="bg-white border border-galaxy-light shadow-galaxy-message rounded-lg animate-fade-in">
          <DropdownMenuItem
            className="cursor-pointer text-galaxy-red hover:bg-galaxy-red/10 hover:text-galaxy-red focus:bg-galaxy-red/15 focus:text-galaxy-red transition-colors duration-200"
            onSelect={() => onDelete(chat.id)}
          >
            <TrashIcon size={16} />
            <span className="text-sm">삭제</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
};

export const ChatItem = memo(PureChatItem, (prevProps, nextProps) => {
  if (prevProps.isActive !== nextProps.isActive) return false;
  return true;
});
