const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

// Definir ELECTRON_START_URL (ex.: http://localhost:5175) carrega o servidor do `npm run dev`
// em vez do build em dist/ — útil só para desenvolvimento, não é usado no .exe empacotado.
const devServerUrl = process.env.ELECTRON_START_URL;
const distDir = path.join(__dirname, '..', 'dist');

/** Sobe um servidor HTTP local só de arquivos estáticos servindo dist/, para o app carregar
 * como http://127.0.0.1 em vez de file:// (evita restrições de CORS/fetch do protocolo file). */
function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const requestPath = decodeURIComponent(req.url.split('?')[0]);
      let filePath = path.join(distDir, requestPath === '/' ? 'index.html' : requestPath);

      if (!filePath.startsWith(distDir)) {
        res.writeHead(403);
        res.end();
        return;
      }

      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end();
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream' });
        res.end(data);
      });
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

let staticServer = null;

async function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
    return;
  }

  if (!staticServer) staticServer = await startStaticServer();
  const { port } = staticServer.address();
  mainWindow.loadURL(`http://127.0.0.1:${port}`);
}

app.whenReady().then(() => {
  // Sem essa liberação, o Electron nega getUserMedia por padrão (não existe o popup de
  // permissão do navegador aqui — quem decide é o app). O acesso real à câmera ainda
  // depende da configuração de privacidade do próprio Windows.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  staticServer?.close();
  if (process.platform !== 'darwin') app.quit();
});
