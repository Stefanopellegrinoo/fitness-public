/**
 * Auth pages layout
 * Provides centered form layout for login/register pages
 */

import { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-full max-w-sm px-4">
        {children}
      </div>
    </div>
  );
}
