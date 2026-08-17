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
  fileWatchers.forEach((_, filePath) => stopWatching(filePath));
  if (process.platform !== 'darwin') app.quit();
});

// ---------- Recarga automática de archivos de log en vigilancia ----------
// filePath -> { watcher, pollInterval, size, partialLine, debounceTimer }
const fileWatchers = new Map();
const POLL_INTERVAL_MS = 1000;
const DEBOUNCE_MS = 150;

function stopWatching(filePath) {
  const state = fileWatchers.get(filePath);
  if (!state) return;
  if (state.watcher) state.watcher.close();
  if (state.pollInterval) clearInterval(state.pollInterval);
  if (state.debounceTimer) clearTimeout(state.debounceTimer);
  fileWatchers.delete(filePath);
}

function startWatching(filePath, sender) {
  stopWatching(filePath);

  let initialSize;
  try {
    initialSize = fs.statSync(filePath).size;
  } catch {
    return;
  }

  const state = {
    watcher: null,
    pollInterval: null,
    size: initialSize,
    partialLine: '',
    debounceTimer: null
  };

  const processChanges = () => {
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return; // archivo eliminado/movido: dejamos de intentar leerlo
    }

    if (stat.size < state.size) {
      // El archivo se truncó o rotó (p. ej. logrotate): recarga completa
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        state.size = Buffer.byteLength(content, 'utf-8');
        state.partialLine = '';
        if (!sender.isDestroyed()) {
          sender.send('file:log-changed', { filePath, type: 'reloaded', content });
        }
      } catch {
        /* ignorar */
      }
      return;
    }

    if (stat.size === state.size) return; // sin datos nuevos

    const length = stat.size - state.size;
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, length, state.size);
    fs.closeSync(fd);
    state.size = stat.size;

    const text = state.partialLine + buffer.toString('utf-8');
    const parts = text.split(/\r\n|\r|\n/);
    state.partialLine = parts.pop() || '';

    if (parts.length > 0 && !sender.isDestroyed()) {
      sender.send('file:log-changed', { filePath, type: 'appended', lines: parts });
    }
  };

  const scheduleCheck = () => {
    if (state.debounceTimer) clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(processChanges, DEBOUNCE_MS);
  };

  // Vigilamos la carpeta contenedora (no el archivo directo): si el archivo
  // se reemplaza por rename (algunos editores guardan así) o rota, el inodo
  // cambia y un fs.watch atado al archivo deja de disparar para siempre.
  // Filtramos por nombre cuando el sistema operativo lo informa.
  try {
    const dir = path.dirname(filePath);
    const targetName = path.basename(filePath);
    state.watcher = fs.watch(dir, { persistent: false }, (eventType, filename) => {
      if (filename && filename !== targetName) return;
      scheduleCheck();
    });
  } catch {
    /* seguimos solo con el sondeo de respaldo */
  }

  // Sondeo de respaldo: algunos entornos (máquinas virtuales, carpetas
  // compartidas, unidades de red) no entregan eventos de inotify de forma
  // confiable. Esto garantiza que los cambios se detecten igual, con hasta
  // ~1s de latencia en el peor caso.
  state.pollInterval = setInterval(processChanges, POLL_INTERVAL_MS);
  if (state.pollInterval.unref) state.pollInterval.unref();

  fileWatchers.set(filePath, state);
}

ipcMain.handle('file:watchLogFile', (event, filePath) => {
  startWatching(filePath, event.sender);
});

ipcMain.handle('file:unwatchLogFile', (event, filePath) => {
  stopWatching(filePath);
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
