const express = require('express');
const https = require('https');
const http = require('http');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');
const selfsigned = require('selfsigned');
const SignalingHandler = require('./signaling_handler');

// Parse CLI flags and environment variables
const args = process.argv.slice(2);
const isDev = args.includes('--dev') || process.env.NODE_ENV === 'development';
const portIndex = args.indexOf('--port');
const customPort = portIndex !== -1 ? parseInt(args[portIndex + 1], 10) : null;

const HTTP_PORT = customPort || (isDev ? 3005 : (parseInt(process.env.PORT, 10) || 3000));
const HTTPS_PORT = customPort ? customPort + 443 : (isDev ? 3445 : (parseInt(process.env.HTTPS_PORT, 10) || 3443));

const app = express();

// Collect local IP addresses
const interfaces = os.networkInterfaces();
const ipAddresses = [];
for (const name of Object.keys(interfaces)) {
  for (const net of interfaces[name]) {
    if (net.family === 'IPv4' && !net.internal) {
      ipAddresses.push({ interface: name, address: net.address });
    }
  }
}

// Generate valid self-signed certificate with complete Subject Alternative Names (SAN)
const pems = selfsigned.generate(
  [{ name: 'commonName', value: 'dunhas.ddns.net' }],
  {
    days: 365,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 2, value: 'dunhas.ddns.net' },
          { type: 7, ip: '127.0.0.1' },
          ...ipAddresses.map((item) => ({ type: 7, ip: item.address }))
        ]
      }
    ]
  }
);

const credentials = { key: pems.private, cert: pems.cert };

// Serve static frontend assets
const clientPath = path.join(__dirname, '../client');
app.use(express.static(clientPath));

// API endpoint returning network connection info
app.get('/api/network-info', (req, res) => {
  res.json({
    httpPort: HTTP_PORT,
    httpsPort: HTTPS_PORT,
    addresses: ipAddresses
  });
});

const signalingHandler = new SignalingHandler();

// 1. Create HTTP Server
const httpServer = http.createServer(app);
const wssHttp = new WebSocketServer({ server: httpServer });
wssHttp.on('connection', (ws) => signalingHandler.handleConnection(ws));

// 2. Create HTTPS Server
const httpsServer = https.createServer(credentials, app);
const wssHttps = new WebSocketServer({ server: httpsServer });
wssHttps.on('connection', (ws) => signalingHandler.handleConnection(ws));

// Start both HTTP and HTTPS listeners
httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log('====================================================');
  console.log(`🚀 Dunhascord ${isDev ? '(DEV MODE)' : ''} Running`);
  console.log('----------------------------------------------------');
  console.log(`🌐 HTTP Access:      http://localhost:${HTTP_PORT}`);
  console.log(`   Domain (HTTP):     http://dunhas.ddns.net:${HTTP_PORT}`);
  console.log('----------------------------------------------------');
  console.log(`🔒 HTTPS Access:     https://localhost:${HTTPS_PORT}`);
  console.log(`   Domain (HTTPS):    https://dunhas.ddns.net:${HTTPS_PORT}`);
  console.log('====================================================');
});

httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {});
