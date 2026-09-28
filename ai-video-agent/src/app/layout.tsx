import type { Metadata } from 'next';
import Script from 'next/script';
import { Toaster } from 'sonner';
import { Providers } from '@/components/providers';
import { AIConsoleBridge } from '@/components/ai-console-bridge';
import './globals.css';

export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_APP_NAME || 'AI 视频制作智能体',
  description: 'AI 自动生成视频脚本、分镜、画面、旁白，一站式创作平台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="font-sans antialiased" suppressHydrationWarning>
        <Script id="restore-appearance" strategy="beforeInteractive">
          {`try { const appearance = localStorage.getItem('ai-video:appearance:v1') === 'light' ? 'light' : 'dark'; document.documentElement.dataset.theme = appearance; document.documentElement.style.colorScheme = appearance; } catch { document.documentElement.dataset.theme = 'dark'; }`}
        </Script>
        <Providers>
          <AIConsoleBridge />
          {children}
          <Toaster position="top-center" richColors />
        </Providers>
      </body>
    </html>
  );
}
