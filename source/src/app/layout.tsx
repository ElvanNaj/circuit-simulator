import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CircuitSim — Interactive Circuit Simulator",
  description:
    "Falstad-style circuit simulator powered by a Rust/WASM engine. Build, probe, and measure analog and digital circuits entirely in your browser.",
  applicationName: "CircuitSim",
  keywords: ["circuit simulator", "electronics", "Rust", "WebAssembly", "analog", "digital", "oscilloscope"],
  authors: [{ name: "CircuitSim" }],
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
  openGraph: {
    title: "CircuitSim",
    description: "Interactive circuit simulator powered by a Rust/WASM engine.",
    siteName: "CircuitSim",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "CircuitSim",
    description: "Interactive circuit simulator powered by a Rust/WASM engine.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          themes={['dark', 'light', 'pink']}
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
