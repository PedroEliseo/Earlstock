import BugReport from '@mui/icons-material/BugReport';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';

/**
 * Development-only demo of frontend error reporting: the header button asks Layout to render
 * RenderErrorProbe inside the page's ErrorBoundary, and that render throws. The boundary shows its
 * usual fallback and reports the error through the existing reporter (telemetry/reportError.ts).
 * Both are rendered only when import.meta.env.DEV is true, so production builds do not contain them.
 */
export const DEMO_RENDER_ERROR_MESSAGE = 'EarlStock demo: intentional frontend rendering error';

const LABEL = 'Trigger frontend error';

export function DevErrorTriggerButton({ onTrigger }: { onTrigger: () => void }) {
  return (
    <Tooltip title={LABEL}>
      <IconButton aria-label={LABEL} onClick={onTrigger} size="small">
        <BugReport fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}

/** Throws while rendering: a genuine render error, caught by the nearest ErrorBoundary. */
export function RenderErrorProbe(): never {
  throw new Error(DEMO_RENDER_ERROR_MESSAGE);
}
