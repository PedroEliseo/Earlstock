import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Button from '@mui/material/Button';
import type { ReactNode } from 'react';
import { describeError } from '../api/errors';

interface StatusMessageProps {
  kind: 'empty' | 'error' | 'info' | 'warning';
  title: string;
  description?: string;
  action?: ReactNode;
}

const SEVERITY = { empty: 'info', info: 'info', warning: 'warning', error: 'error' } as const;

/**
 * A short, self-contained message for empty, informational and error states. Errors are announced
 * as alerts; the others are polite status messages.
 */
export function StatusMessage({ kind, title, description, action }: StatusMessageProps) {
  return (
    <Alert
      severity={SEVERITY[kind]}
      role={kind === 'error' ? 'alert' : 'status'}
      action={action}
      sx={{ alignItems: 'flex-start' }}
    >
      <AlertTitle sx={{ mb: description ? 0.5 : 0 }}>{title}</AlertTitle>
      {description}
    </Alert>
  );
}

/** Any failure, rendered with fixed user-facing text (never the server's message). */
export function ErrorMessage({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { title, description, retryable } = describeError(error);
  return (
    <StatusMessage
      kind="error"
      title={title}
      description={description}
      action={
        retryable && onRetry ? (
          <Button color="inherit" size="small" variant="outlined" onClick={onRetry}>
            Try again
          </Button>
        ) : undefined
      }
    />
  );
}
