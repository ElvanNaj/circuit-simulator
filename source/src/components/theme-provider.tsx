'use client';

// Thin client wrapper so the root layout (a server component) can mount
// next-themes. Themes are explicit classes on <html>: dark | light | pink.

import type { ComponentProps } from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
