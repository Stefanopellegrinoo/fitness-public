'use client';

import React, { ReactNode } from 'react';
import { Alert } from './alert';
import { Button } from './button';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

/**
 * Global error boundary for catching unhandled errors
 * Displays error UI with recovery option
 */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error): void {
    // Log to console for debugging
    console.error('ErrorBoundary caught:', error);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: undefined });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen p-4">
          <Alert variant="destructive" className="max-w-md">
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="text-lg font-semibold mb-2">
                  Something went wrong
                </h2>
                <p className="text-sm text-gray-600">
                  {this.state.error?.message ||
                    'An unexpected error occurred. Please try again.'}
                </p>
              </div>
              <Button onClick={this.handleReset} variant="outline" size="sm">
                Try Again
              </Button>
            </div>
          </Alert>
        </div>
      );
    }

    return this.props.children;
  }
}
