const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');

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

// Tempo de folga pro usuário reagir ao popup do UAC (clicar "Sim" não é instantâneo).
const CAMERA_RESET_UAC_TIMEOUT_MS = 20000;
// O serviço já reporta como reiniciado, mas o driver da câmera ainda leva um instante pra
// aceitar uma nova sessão — sem essa pausa, o primeiro getUserMedia do renderer pega essa
// janela e falha com "câmera em uso" mesmo com o FrameServer já de pé.
const CAMERA_RESET_SETTLE_MS = 1500;

/**
 * Reinicia FrameServer/FrameServerMonitor (serviço de câmera do Windows que trava e passa a
 * bloquear qualquer app) toda vez que o programa abre — mesmo fix manual de scripts/fix-camera.bat,
 * só que automático. Precisa de elevação (UAC); a janela do app fica sem privilégio de admin,
 * só esse comando isolado eleva. Nunca trava o boot: se o usuário demorar/recusar o UAC, ou o
 * PowerShell falhar, o app abre normalmente do mesmo jeito depois do timeout.
 */
function resetCameraServices() {
  if (process.platform !== 'win32') return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      setTimeout(resolve, CAMERA_RESET_SETTLE_MS);
    };

    const innerCommand =
      'Restart-Service -Name FrameServer -Force -ErrorAction SilentlyContinue; ' +
      'Restart-Service -Name FrameServerMonitor -Force -ErrorAction SilentlyContinue';
    // -EncodedCommand evita todo o inferno de aspas aninhadas ao repassar o comando pro processo elevado.
    const encodedInner = Buffer.from(innerCommand, 'utf16le').toString('base64');
    const outerCommand = [
      'Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList',
      `'-NoProfile','-WindowStyle','Hidden','-EncodedCommand','${encodedInner}'`,
    ].join(' ');

    try {
      const child = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', outerCommand], {
        windowsHide: true,
      });
      child.on('exit', finish);
      child.on('error', finish);
    } catch {
      finish();
    }

    setTimeout(finish, CAMERA_RESET_UAC_TIMEOUT_MS);
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

app.whenReady().then(async () => {
  // Sem essa liberação, o Electron nega getUserMedia por padrão (não existe o popup de
  // permissão do navegador aqui — quem decide é o app). O acesso real à câmera ainda
  // depende da configuração de privacidade do próprio Windows.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });

  await resetCameraServices();

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  staticServer?.close();
  if (process.platform !== 'darwin') app.quit();
});
