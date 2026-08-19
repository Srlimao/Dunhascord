const { app, BrowserWindow, ipcMain, desktopCapturer, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');

app.commandLine.appendSwitch('disable-features', 'WebRtcAllowWgcScreenCapturer,WebRtcAllowWgcWindowCapturer');
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

  const port = process.env.PORT || 3000;
  mainWindow.loadURL(`http://localhost:${port}`).catch(() => {
    mainWindow.loadURL('http://localhost:3005').catch(() => {
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
  const localBin = path.join(__dirname, '../bin/process_audio_capture.exe');
  if (fs.existsSync(localBin)) return localBin;
  const resBin = path.join(process.resourcesPath || '', 'src/bin/process_audio_capture.exe');
  if (fs.existsSync(resBin)) return resBin;
  return localBin;
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
  console.log('[Electron Audio] Spawning process_audio_capture with args:', args);

  try {
    audioCaptureProcess = spawn(binPath, args, { stdio: ['ignore', 'pipe', 'inherit'] });
    let chunkCount = 0;

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
