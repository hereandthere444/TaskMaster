'use client';

import * as React from 'react';
import { SplashScreen } from './splash-screen'; // Import the visual splash screen component

export function SplashScreenHandler({ children }: { children: React.ReactNode }) {
  const [isSplashComplete, setIsSplashComplete] = React.useState(false);

  React.useEffect(() => {
    // Set a timer for 3 seconds (3000 milliseconds)
    const timer = setTimeout(() => {
      setIsSplashComplete(true);
    }, 3000);

    // Cleanup the timer if the component unmounts before the timer finishes
    return () => clearTimeout(timer);
  }, []); // Empty dependency array ensures this runs only once on mount

  // Show the splash screen until the minimum time has elapsed
  if (!isSplashComplete) {
    return <SplashScreen />;
  }

  // After 3 seconds, render the actual application content
  return <>{children}</>;
}
