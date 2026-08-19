const { app, BrowserWindow, ipcMain, desktopCapturer, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');

app.commandLine.appendSwitch('log-level', '3');
app.commandLine.appendSwitch('disable-logging');
app.commandLine.appendSwitch('disable-features', 'WebRtcAllowWgcScreenCapturer,WebRtcAllowWgcWindowCapturer,WebRtcAllowWgcZeroHz');
app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');
app.commandLine.appendSwitch('enable-webrtc-hide-local-ips-with-mdns', 'false');

let mainWindow = null;
let currentSelectedSourceId = null;
let audioCaptureProcess = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b0e14',
    title: 'Dunhascord - Voice & Screen Share',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  });

  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      let selected = currentSelectedSourceId ? sources.find((s) => s.id === currentSelectedSourceId) : sources[0];
      if (selected) callback({ video: selected, audio: 'loopback' });
      else callback(null);
    } catch (err) {
      callback(null);
    }
  });

  const remoteServer = process.env.SERVER_URL || 'http://dunhas.ddns.net:3000';
  mainWindow.loadURL('http://localhost:3000').catch(() => {
    console.log('[Electron] Local server not active, connecting to remote server:', remoteServer);
    mainWindow.loadURL(remoteServer).catch(() => {
      mainWindow.loadFile(path.join(__dirname, '../client/index.html'));
    });
  });

  mainWindow.on('closed', () => {
    stopAudioProcess();
    mainWindow = null;
  });
}

function stopAudioProcess() {
  if (audioCaptureProcess) {
    try { audioCaptureProcess.kill(); } catch (e) {}
    audioCaptureProcess = null;
  }
}

function getAudioBinPath() {
  const possiblePaths = [];

  if (process.resourcesPath) {
    possiblePaths.push(
      path.join(process.resourcesPath, 'process_audio_capture.exe'),
      path.join(process.resourcesPath, 'src', 'bin', 'process_audio_capture.exe'),
      path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'bin', 'process_audio_capture.exe')
    );
  }

  if (app && typeof app.getAppPath === 'function') {
    const appPath = app.getAppPath();
    if (appPath.includes('app.asar')) {
      possiblePaths.push(
        path.join(appPath.replace('app.asar', 'app.asar.unpacked'), 'src', 'bin', 'process_audio_capture.exe')
      );
    }
  }

  // Development fallback paths (unpacked filesystem)
  possiblePaths.push(
    path.join(__dirname, '../bin/process_audio_capture.exe'),
    path.join(__dirname, '../../src/bin/process_audio_capture.exe'),
    path.join(process.cwd(), 'src', 'bin', 'process_audio_capture.exe')
  );

  for (const binPath of possiblePaths) {
    // Only return path if it physically exists on disk and is NOT inside virtual app.asar
    if (fs.existsSync(binPath) && !binPath.includes('app.asar\\') && !binPath.includes('app.asar/')) {
      console.log('[Electron Audio] Found native audio binary at:', binPath);
      return binPath;
    }
  }

  console.warn('[Electron Audio] Warning: Native audio binary not found in standard paths, falling back to relative path');
  return path.join(__dirname, '../bin/process_audio_capture.exe');
}

ipcMain.handle('select-desktop-source', (event, sourceId) => {
  currentSelectedSourceId = sourceId;
  return true;
});

// IPC: Start native WASAPI audio capture matching window name, HWND or PID
ipcMain.handle('start-process-audio-capture', async (event, sourceInfo) => {
  stopAudioProcess();
  const binPath = getAudioBinPath();
  let targetArg = '0';

  if (typeof sourceInfo === 'number') {
    targetArg = sourceInfo.toString();
  } else if (typeof sourceInfo === 'object' && sourceInfo.pid) {
    targetArg = sourceInfo.pid.toString();
  } else if (typeof sourceInfo === 'string') {
    const cleanName = sourceInfo.toLowerCase().replace(/[^a-z0-9]/g, '');
    const procList = await getRunningProcesses();
    const match = procList.find((p) => {
      const pClean = p.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      return cleanName.includes(pClean) || (pClean.length > 3 && cleanName.includes(pClean));
    });

    if (match) {
      targetArg = match.pid.toString();
    } else {
      targetArg = `-name ${sourceInfo}`;
    }
  }

  const args = targetArg.includes(' ') ? targetArg.split(' ') : [targetArg];
  console.log('[Electron Audio] Spawning process_audio_capture from:', binPath, 'with args:', args);

  try {
    audioCaptureProcess = spawn(binPath, args, { stdio: ['ignore', 'pipe', 'inherit'] });
    let chunkCount = 0;

    audioCaptureProcess.on('error', (err) => {
      console.error('[Electron Audio] Failed to spawn audio capturer process:', err);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('process-audio-error', err.message);
      }
      audioCaptureProcess = null;
    });

    audioCaptureProcess.stdout.on('data', (chunk) => {
      chunkCount++;
      if (chunkCount % 50 === 1) {
        console.log(`[Electron Audio] Streaming audio: chunk #${chunkCount}, bytes: ${chunk.length}`);
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('process-audio-data', chunk);
      }
    });

    audioCaptureProcess.on('exit', (code) => {
      console.log('[Electron Audio] Process audio capture stopped (exit code:', code, ')');
      audioCaptureProcess = null;
    });
    return true;
  } catch (err) {
    console.error('[Electron Audio] Failed to start audio capture:', err);
    return false;
  }
});

function getRunningProcesses() {
  return new Promise((resolve) => {
    exec('powershell "Get-Process | Select-Object Id, ProcessName | ConvertTo-Json"', (err, stdout) => {
      if (err || !stdout) return resolve([]);
      try {
        const parsed = JSON.parse(stdout);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        resolve(list.map((p) => ({ pid: p.Id, name: p.ProcessName })));
      } catch (e) {
        resolve([]);
      }
    });
  });
}

ipcMain.handle('stop-process-audio-capture', () => {
  stopAudioProcess();
  return true;
});

ipcMain.handle('get-desktop-sources', async (event, options = {}) => {
  try {
    const sources = await desktopCapturer.getSources({
      types: options.types || ['window', 'screen'],
      thumbnailSize: options.thumbnailSize || { width: 480, height: 270 },
      fetchWindowIcons: true
    });

    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL(),
      appIcon: s.appIcon ? s.appIcon.toDataURL() : null
    }));
  } catch (err) {
    return [];
  }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
