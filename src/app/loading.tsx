'use client';

import { AppLogo } from '@/components/app-logo';
import { Skeleton } from '@/components/ui/skeleton';
import * as React from 'react';

// Simplified loading indicator for route transitions after the initial splash.
export default function Loading() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground p-4">
      <div className="animate-spin mb-6">
        <AppLogo className="w-16 h-16 text-primary" />
      </div>
      <Skeleton className="h-6 w-1/2 max-w-xs" />
      <div className="mt-8 text-sm text-muted-foreground animate-pulse">
        Loading...
      </div>
    </div>
  );
}
