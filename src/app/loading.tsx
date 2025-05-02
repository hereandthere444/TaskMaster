'use client';

import { AppLogo } from '@/components/app-logo';
import { Skeleton } from '@/components/ui/skeleton';
import * as React from 'react';

const motivationalQuotes = [
  "The journey of a thousand miles begins with a single step.",
  "Believe you can and you're halfway there.",
  "Act as if what you do makes a difference. It does.",
  "Success is not final, failure is not fatal: It is the courage to continue that counts.",
  "Your limitation—it's only your imagination.",
  "The best way to predict the future is to create it.",
  "Strive not to be a success, but rather to be of value.",
  "The mind is everything. What you think you become.",
  "Either you run the day, or the day runs you.",
  "Start where you are. Use what you have. Do what you can."
];

export default function Loading() {
  const [quote, setQuote] = React.useState('');

  React.useEffect(() => {
    // Select a random quote on client-side mount to avoid hydration mismatch
    setQuote(motivationalQuotes[Math.floor(Math.random() * motivationalQuotes.length)]);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground p-4">
      <div className="animate-bounce mb-6">
        <AppLogo className="w-20 h-20 text-primary" />
      </div>
      <h1 className="text-3xl font-bold text-primary mb-4">TaskMaster</h1>
      {quote ? (
        <p className="text-lg text-muted-foreground italic text-center max-w-md">
          &ldquo;{quote}&rdquo;
        </p>
      ) : (
         <Skeleton className="h-6 w-3/4 max-w-md" /> // Show skeleton while quote loads
      )}
      <div className="mt-8 text-sm text-muted-foreground animate-pulse">
        Loading your tasks...
      </div>
    </div>
  );
}
