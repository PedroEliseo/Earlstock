import { useDatasetUpdate } from '../query/SnapshotProvider';
import styles from './DatasetUpdatedNotice.module.css';

/** Tells the user, without interrupting, that a newer dataset was activated and data refreshed. */
export function DatasetUpdatedNotice() {
  const { updated, dismiss } = useDatasetUpdate();
  return (
    <div role="status">
      {updated && (
        <div className={styles.notice}>
          <p>A new dataset was activated. The data shown has been refreshed.</p>
          <button type="button" className={styles.dismiss} onClick={dismiss}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
