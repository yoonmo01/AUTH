// stub for hwp.js which imports 'fs' at module level but only uses it in the
// Node.js parse() path — the browser Viewer takes a Uint8Array directly.
const fs = {
  readFileSync: () => null,
  existsSync: () => false,
  statSync: () => ({}),
}
export default fs
export const { readFileSync, existsSync, statSync } = fs
