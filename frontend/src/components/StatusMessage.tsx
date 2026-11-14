import type { ReactNode } from 'react';
import { describeError } from '../api/errors';
import styles from './StatusMessage.module.css';

interface StatusMessageProps {
  kind: 'empty' | 'error' | 'info';
  title: string;
  description?: string;
  action?: ReactNode;
}

/**
 * A short, self-contained message for empty, informational and error states. Errors use
 * role="alert" so assistive technology announces them; the others are polite status messages.
 */
export function StatusMessage({ kind, title, description, action }: StatusMessageProps) {
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={kind === 'error' ? `${styles.status} ${styles.error}` : styles.status}
    >
      <p className={styles.title}>{title}</p>
      {description && <p className={styles.description}>{description}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
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
          <button type="button" className={styles.button} onClick={onRetry}>
            Try again
          </button>
        ) : undefined
      }
    />
  );
}
