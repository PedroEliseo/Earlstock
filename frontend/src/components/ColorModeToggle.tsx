import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlined from '@mui/icons-material/LightModeOutlined';
import SettingsBrightnessOutlined from '@mui/icons-material/SettingsBrightnessOutlined';
import IconButton from '@mui/material/IconButton';
import { useColorScheme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';

const NEXT = { system: 'light', light: 'dark', dark: 'system' } as const;
const LABEL = { system: 'system', light: 'light', dark: 'dark' } as const;

/** Cycles the color mode: system → light → dark. MUI persists the choice. */
export function ColorModeToggle() {
  const { mode, setMode } = useColorScheme();
  if (!mode) return null; // not resolved yet (first render)
  const next = NEXT[mode];
  const Icon = {
    system: SettingsBrightnessOutlined,
    light: LightModeOutlined,
    dark: DarkModeOutlined,
  }[mode];
  const label = `Color theme: ${LABEL[mode]}. Switch to ${LABEL[next]}`;
  return (
    <Tooltip title={label}>
      <IconButton
        aria-label={label}
        onClick={() => {
          setMode(next);
        }}
        size="small"
      >
        <Icon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}
