import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google'; // Corrected import
import './globals.css';
import { Toaster } from "@/components/ui/toaster"; // Import Toaster
import { SplashScreenHandler } from '@/components/splash-screen-handler'; // Import SplashScreenHandler

const geistSans = Geist({ // Corrected invocation
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({ // Corrected invocation
  variable: '--font-geist-mono',
  subsets: ['latin'],
});


export const metadata: Metadata = {
  title: 'TaskMaster',
  description: 'The ultimate To-Do list app that forces you to get things done!',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}> {/* Added font-sans */}
        <SplashScreenHandler> {/* Wrap children */}
            {children}
        </SplashScreenHandler>
        <Toaster /> {/* Add Toaster component here */}
      </body>
    </html>
  );
}
