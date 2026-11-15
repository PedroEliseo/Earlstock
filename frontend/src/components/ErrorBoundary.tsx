import Button from '@mui/material/Button';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportCaughtError } from '../telemetry/reportError';
import { StatusMessage } from './StatusMessage';

interface ErrorBoundaryState {
  failed: boolean;
}

/**
 * Last line of defense for rendering bugs: shows a fixed message instead of a blank page. Data
 * errors are handled by each page's error states; this only catches unexpected exceptions.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unexpected rendering error', error, info.componentStack);
    // React does not rethrow caught errors to the global handlers, so this is their only report.
    reportCaughtError(error);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <StatusMessage
        kind="error"
        title="Something went wrong"
        description="This page could not be displayed. Reload the page or go back to the explorer."
        action={
          <Button color="inherit" size="small" variant="outlined" href="/">
            Explorer
          </Button>
        }
      />
    );
  }
}
