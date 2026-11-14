import { createTheme, type SxProps, type Theme } from '@mui/material/styles';

/**
 * The single EarlStock design system: one MUI theme for every route. Light and dark schemes are
 * emitted as CSS variables, so switching mode never re-renders the tree; the user's choice (or the
 * system preference) is remembered by MUI's color-scheme manager.
 *
 * Visual language: restrained, data-first. Neutral surfaces, one accent, tabular figures for all
 * numbers and dates, visible keyboard focus, no decorative motion when reduced motion is requested.
 */
/**
 * Palette values per color scheme: the single source for the MUI theme below and for the canvas
 * chart (which cannot read CSS variables). `up`/`down` are the price-direction colors.
 */
export const SCHEME_COLORS = {
  light: {
    primary: '#0b5cad',
    background: '#f6f7f9',
    paper: '#ffffff',
    text: '#1b1f24',
    textSecondary: '#545b66',
    divider: '#d4d7dd',
    up: '#1e7d43',
    down: '#c0362c',
  },
  dark: {
    primary: '#6cb4ff',
    background: '#0f1216',
    paper: '#171b21',
    text: '#e8eaed',
    textSecondary: '#a9b0ba',
    divider: '#343a43',
    up: '#4cc38a',
    down: '#ff7a6e',
  },
} as const;
export type ColorScheme = keyof typeof SCHEME_COLORS;

const paletteFor = (scheme: ColorScheme) => {
  const c = SCHEME_COLORS[scheme];
  return {
    primary: { main: c.primary },
    success: { main: c.up },
    error: { main: c.down },
    background: { default: c.background, paper: c.paper },
    text: { primary: c.text, secondary: c.textSecondary },
    divider: c.divider,
  };
};

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'data' },
  colorSchemes: {
    light: { palette: paletteFor('light') },
    dark: { palette: paletteFor('dark') },
  },
  shape: { borderRadius: 6 },
  typography: {
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    h1: { fontSize: '1.75rem', fontWeight: 650, letterSpacing: '-0.01em' },
    h2: { fontSize: '1.25rem', fontWeight: 600 },
    h3: { fontSize: '1.05rem', fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        '@media (prefers-reduced-motion: reduce)': {
          '*, *::before, *::after': {
            animationDuration: '0.01ms !important',
            animationIterationCount: '1 !important',
            transitionDuration: '0.01ms !important',
            scrollBehavior: 'auto !important',
          },
        },
      },
    },
    MuiButtonBase: {
      defaultProps: { disableRipple: true },
      styleOverrides: {
        root: ({ theme }) => ({
          '&.Mui-focusVisible': {
            outline: `3px solid ${theme.vars.palette.primary.main}`,
            outlineOffset: 2,
          },
        }),
      },
    },
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiLink: {
      styleOverrides: {
        root: ({ theme }) => ({
          '&:focus-visible': {
            outline: `3px solid ${theme.vars.palette.primary.main}`,
            outlineOffset: 2,
            borderRadius: 2,
          },
        }),
      },
    },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiAlert: { defaultProps: { variant: 'outlined' } },
    MuiPaper: { defaultProps: { variant: 'outlined' } },
    MuiTableCell: {
      styleOverrides: {
        root: ({ theme }) => ({
          fontVariantNumeric: 'tabular-nums',
          // Narrow screens: tighter cells so typical tables fit without horizontal scrolling.
          [theme.breakpoints.down('sm')]: { paddingInline: theme.spacing(1) },
        }),
        head: { fontWeight: 600, whiteSpace: 'nowrap' },
      },
    },
  },
});

/** Hides content visually while keeping it available to assistive technology. */
export const visuallyHidden: SxProps<Theme> = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

/** Numbers and dates: aligned digits. */
export const numericSx: SxProps<Theme> = { fontVariantNumeric: 'tabular-nums' };
