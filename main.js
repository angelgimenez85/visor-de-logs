const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// Evita el ruido "GetVSyncParametersIfAvailable() failed" en Linux/VMs sin
// aceleración gráfica completa. Es solo un log de diagnóstico de Chromium,
// no afecta la app, pero desactivar GPU lo elimina de la consola.
app.disableHardwareAcceleration();

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    backgroundColor: '#0f172a',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile('index.html');

  // Sin barra de menús por defecto: se reemplaza por un menú contextual
  // (clic derecho) que ofrece "Copiar" cuando hay texto seleccionado.
  win.webContents.on('context-menu', (event, params) => {
    if (!params.selectionText || params.selectionText.trim() === '') return;

    Menu.buildFromTemplate([
      { label: 'Copiar', role: 'copy' }
    ]).popup({ window: win });
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('dialog:openLogFile', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Selecciona un archivo de log',
    properties: ['openFile'],
    filters: [
      { name: 'Archivos de log', extensions: ['log', 'txt'] },
      { name: 'Todos los archivos', extensions: ['*'] }
    ]
  });

  if (canceled || filePaths.length === 0) return null;

  const filePath = filePaths[0];
  const content = fs.readFileSync(filePath, 'utf-8');

  return { filePath, content };
});

ipcMain.handle('file:readLogFile', async (event, filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return { filePath, content };
  } catch (err) {
    return { error: err.message };
  }
});
