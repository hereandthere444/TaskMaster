'use client';

import * as React from 'react';
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarTrigger,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarInset,
} from '@/components/ui/sidebar';
import { Zap, Settings, ListTodo, CalendarDays } from 'lucide-react'; // Added CalendarDays icon
import { AppLogo } from './app-logo'; // Assuming AppLogo component exists
import { ThemeToggle } from './theme-toggle'; // Assuming ThemeToggle component exists
import { Separator } from './ui/separator';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <SidebarProvider defaultOpen>
      <Sidebar>
        <SidebarHeader className="items-center">
          <AppLogo className="size-8" />
          <span className="text-lg font-semibold">TaskMaster</span>
          <SidebarTrigger className="ml-auto md:hidden" />
        </SidebarHeader>

        <SidebarContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={pathname === '/'}
                tooltip={{ children: "Tasks", side: 'right' }}
              >
                <Link href="/">
                  <ListTodo />
                  Tasks
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={pathname === '/calendar'}
                tooltip={{ children: "Calendar", side: 'right' }}
              >
                <Link href="/calendar">
                  <CalendarDays />
                  Calendar
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {/* Example of other potential items:
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={pathname === '/settings'}
                tooltip={{ children: "Settings", side: 'right' }}
              >
                <Link href="/settings">
                  <Settings />
                  Settings
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            */}
          </SidebarMenu>
        </SidebarContent>

        <SidebarFooter className="flex-col gap-2">
          <Separator />
           <div className="flex items-center justify-between p-2">
             <span className="text-sm text-muted-foreground">Theme</span>
             <ThemeToggle />
           </div>
        </SidebarFooter>
      </Sidebar>
      {/* Added flex flex-col h-screen to allow children to fill space */}
      <SidebarInset className="flex flex-col h-screen">
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
