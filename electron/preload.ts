import { contextBridge } from 'electron'

// Minimal contextBridge skeleton. No IPC surface is needed yet — the
// renderer talks to the backend over HTTP. The namespace is reserved so
// future IPC can be added without changing how the renderer reaches it.
contextBridge.exposeInMainWorld('hyena', {})
