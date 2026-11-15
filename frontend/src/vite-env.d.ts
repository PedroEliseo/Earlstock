/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" enables browser telemetry (EDOT Browser). Not a secret: never put credentials in VITE_ variables. */
  readonly VITE_EARLSTOCK_TELEMETRY?: string;
}
