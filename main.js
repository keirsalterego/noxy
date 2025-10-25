const { app, BrowserWindow } = require('electron');
const path = require('path');
const { Noxy } = require('./noxy.js');

let mainWindow;

function letsGoCreateWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  letsGoCreateWindow();

  const proxy = new Noxy();
  proxy.start();

  app.on('activate', () => {
    const allWindows = BrowserWindow.getAllWindows();
    if (allWindows.length === 0) {
      letsGoCreateWindow();
    }
  });
});

app.on('window-all-closed', () => {
  const isNotAMac = process.platform !== 'darwin';
  if (isNotAMac) {
    app.quit();
  }
});