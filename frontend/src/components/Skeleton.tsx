import styles from './Skeleton.module.css';

/**
 * Placeholder lines shown while content loads. The shapes are hidden from assistive technology;
 * a single polite status message announces the loading state instead.
 */
export function Skeleton({ lines = 5, label = 'Loading…' }: { lines?: number; label?: string }) {
  return (
    <div className={styles.skeleton}>
      <span role="status" className="visually-hidden">
        {label}
      </span>
      {Array.from({ length: lines }, (_, index) => (
        <div key={index} className={styles.line} aria-hidden="true" />
      ))}
    </div>
  );
}
