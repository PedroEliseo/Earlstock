import { createTheme, type SxProps, type Theme } from '@mui/material/styles';

/**
 * The single EarlStock design system: one MUI theme for every route. Light and dark schemes are
 * emitted as CSS variables, so switching mode never re-renders the tree; the user's choice (or the
 * system preference) is remembered by MUI's color-scheme manager.
 *
 * Visual language: restrained, data-first. Neutral surfaces, one accent, tabular figures for all
 * numbers and dates, visible keyboard focus, no decorative motion when reduced motion is requested.
 */
export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'data' },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#0b5cad' },
        background: { default: '#f6f7f9', paper: '#ffffff' },
        text: { primary: '#1b1f24', secondary: '#545b66' },
        divider: '#d4d7dd',
      },
    },
    dark: {
      palette: {
        primary: { main: '#6cb4ff' },
        background: { default: '#0f1216', paper: '#171b21' },
        text: { primary: '#e8eaed', secondary: '#a9b0ba' },
        divider: '#343a43',
      },
    },
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
