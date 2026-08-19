const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

console.log('📦 Building standalone dist package...');

fs.mkdirSync(distDir, { recursive: true });

// Helper to copy directory recursively
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 1. Copy src to dist
copyDir(path.join(rootDir, 'src'), path.join(distDir, 'src'));

// 2. Create minimal package.json for dist
const distPackageJson = {
  name: "streamhub-dist",
  version: "1.0.0",
  description: "Standalone 1080p 60fps WebRTC Screen Sharing Server",
  main: "src/server/server.js",
  scripts: {
    "start": "node src/server/server.js"
  },
  dependencies: {
    "express": "^4.21.2",
    "selfsigned": "^2.4.1",
    "ws": "^8.18.0"
  }
};
fs.writeFileSync(path.join(distDir, 'package.json'), JSON.stringify(distPackageJson, null, 2));

// 3. Create start.bat (Double-click to run in its own window)
const startBatContent = `@echo off
title StreamHub 1080p 60fps Server
cd /d "%~dp0"
echo ===================================================
echo   Starting StreamHub WebRTC Server...
echo ===================================================
node src/server/server.js
pause
`;
fs.writeFileSync(path.join(distDir, 'start.bat'), startBatContent);

// 4. Create start-hidden.vbs (Runs silently in background)
const startVbsContent = `Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "node src/server/server.js", 0, False
`;
fs.writeFileSync(path.join(distDir, 'start-background.vbs'), startVbsContent);

// 5. Create stop-server.bat
const stopBatContent = `@echo off
echo Stopping StreamHub server...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000" ^| findstr "LISTENING"') do taskkill /f /pid %%a
echo Server stopped.
pause
`;
fs.writeFileSync(path.join(distDir, 'stop-server.bat'), stopBatContent);

console.log('✅ Dist build updated successfully in: ' + distDir);
