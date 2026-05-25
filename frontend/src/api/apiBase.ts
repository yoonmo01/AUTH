// Pure resolver for the API base path (Electron S1).
// Dev mode talks to the backend through the Vite dev-server proxy (`/api`);
// a packaged Electron build has no proxy and must hit the backend's absolute
// URL directly. The environment signal is passed in rather than read from
// import.meta here, so this stays side-effect free and unit testable.

const DEV_API_BASE = '/api'
const PACKAGED_API_BASE = 'http://localhost:8000'

export function resolveApiBase(isDev: boolean): string {
  return isDev ? DEV_API_BASE : PACKAGED_API_BASE
}
