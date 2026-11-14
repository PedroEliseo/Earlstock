import Alert from '@mui/material/Alert';
import Container from '@mui/material/Container';
import { useDatasetUpdate } from '../query/SnapshotProvider';

/**
 * Tells the user, without interrupting, that a newer dataset was activated and data refreshed. The
 * live region is always present so the message is announced when it appears.
 */
export function DatasetUpdatedNotice() {
  const { updated, dismiss } = useDatasetUpdate();
  return (
    <div role="status">
      {updated && (
        <Container maxWidth="lg" sx={{ mt: 2 }}>
          <Alert severity="info" onClose={dismiss} closeText="Dismiss">
            A new dataset was activated. The data shown has been refreshed.
          </Alert>
        </Container>
      )}
    </div>
  );
}
