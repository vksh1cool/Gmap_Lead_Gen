import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Nexus Leads | Revenue Engine",
  description: "AI-Powered GMaps Lead Generator and CRM",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
      suppressHydrationWarning
    >
      <body className="h-full flex bg-[#0B0F19] text-white overflow-hidden" suppressHydrationWarning>
        {/* Animated Background Blobs – slower & subtler */}
        <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-indigo-500/10 blur-[160px] animate-blob-drift-slow"></div>
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-purple-500/10 blur-[160px] animate-blob-drift-slow-reverse"></div>
        </div>

        {/* Noise / Grain Texture Overlay */}
        <div className="fixed inset-0 pointer-events-none z-[1] opacity-[0.035] noise-overlay" />

        <Sidebar />
        
        <main className="flex-1 flex flex-col h-full overflow-y-auto relative z-10 pl-64">
          {children}
        </main>
      </body>
    </html>
  );
}
