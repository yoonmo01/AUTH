import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import path from 'node:path'

// Electron main process. Wraps the Vite + React renderer in a desktop window.
// Dev mode loads the Vite dev server; a packaged build loads the built
// renderer from disk over file://.
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
  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, '../../frontend/dist/index.html'))
  } else {
    win.loadURL(DEV_SERVER_URL)
  }
}

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    { label: 'File', submenu: [{ role: 'quit' }] },
  ]
  if (!app.isPackaged) {
    template.push({ label: 'View', submenu: [{ role: 'toggleDevTools' }] })
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
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
