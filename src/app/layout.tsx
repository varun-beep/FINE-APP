import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#064e3b',
};

export const metadata: Metadata = {
  title: 'SpendCoach',
  description: 'Personal expense tracking & coaching PWA for iPhone',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'SpendCoach',
  },
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/apple-touch-icon.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} dark h-full bg-[#090d16] text-slate-100 antialiased`}
    >
      <body className="flex min-h-full flex-col bg-[#090d16] text-slate-100 selection:bg-emerald-500 selection:text-white">
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
          {children}
        </div>
      </body>
    </html>
  );
}
