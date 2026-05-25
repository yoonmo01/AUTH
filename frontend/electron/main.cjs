const { app, BrowserWindow } = require('electron')
const path = require('path')

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'HYENA Analyzer',
    webPreferences: { contextIsolation: true, webSecurity: false }
  })

  // 패키징 후: resources/dist/index.html
  // 개발 중:   ../dist/index.html (electron/ 기준)
  const distIndex = app.isPackaged
    ? path.join(process.resourcesPath, 'dist', 'index.html')
    : path.join(__dirname, '..', 'dist', 'index.html')

  win.loadFile(distIndex)
  win.setMenuBarVisibility(false)
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
