import { app, BrowserWindow, Menu } from 'electron'
import path from 'node:path'

// Electron dev shell (Electron S2). Wraps the Vite + React renderer in a
// desktop window. Dev mode loads the Vite dev server; the packaged-build
// branch (loadFile) is added in a later slice.
const DEV_SERVER_URL = 'http://localhost:3000'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.loadURL(DEV_SERVER_URL)
}

function buildMenu(): void {
  const menu = Menu.buildFromTemplate([
    { label: 'File', submenu: [{ role: 'quit' }] },
    { label: 'View', submenu: [{ role: 'toggleDevTools' }] },
  ])
  Menu.setApplicationMenu(menu)
}

app.whenReady().then(() => {
  buildMenu()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
