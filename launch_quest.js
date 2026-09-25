import http from 'http';
import fs from 'fs';
import path from 'path';
import { exec, execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 8000;
const ROOT_DIR = __dirname;

// Known locations for adb on Windows
const ADB_CANDIDATES = [
  'adb',
  'C:\\Program Files\\Wonderland\\WonderlandEngine\\bin\\adb.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Android\\Sdk\\platform-tools\\adb.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Programs\\Oculus Developer Hub\\resources\\bin\\adb.exe'),
  'C:\\Program Files\\Oculus Developer Hub\\resources\\bin\\adb.exe',
  'C:\\Program Files\\Meta Quest Developer Hub\\resources\\bin\\adb.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Programs\\SideQuest\\resources\\app.asar.unpacked\\build\\platform-tools\\adb.exe')
];

function findAdb() {
  for (const candidate of ADB_CANDIDATES) {
    try {
      execSync(`"${candidate}" version`, { stdio: 'ignore' });
      return candidate;
    } catch (e) {
      // try next
    }
  }
  return null;
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json'
};

// 1. Create HTTP static server
const server = http.createServer((req, res) => {
  // CORS & No-cache headers for dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let reqPath = decodeURI(req.url.split('?')[0]);
  if (reqPath === '/' || reqPath === '') reqPath = '/forest.html';

  const filePath = path.normalize(path.join(ROOT_DIR, reqPath));

  // Security check: ensure path stays within ROOT_DIR
  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`404 Not Found: ${reqPath}`);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`🌲 Forest Dev Server is RUNNING on http://localhost:${PORT}`);
  console.log(`======================================================\n`);

  const adb = findAdb();
  if (!adb) {
    console.error(`⚠️ Could not find adb.exe automatically.`);
    console.log(`Please make sure your Quest is in Developer Mode, or run manual steps.`);
    return;
  }

  console.log(`Using ADB: ${adb}`);

  // Check connected devices
  try {
    const devicesOutput = execSync(`"${adb}" devices`).toString();
    console.log(devicesOutput.trim());

    if (!devicesOutput.includes('\tdevice')) {
      console.warn(`\n⚠️ No active Quest device detected via ADB!`);
      console.log(`Please connect your Quest via USB/Wi-Fi and allow USB Debugging in the headset.`);
      return;
    }

    // 2. Reverse port 8000 so Quest can access PC's localhost:8000 securely
    console.log(`Configuring ADB reverse tunnel: tcp:${PORT} -> tcp:${PORT}...`);
    execSync(`"${adb}" reverse tcp:${PORT} tcp:${PORT}`);
    console.log(`✅ ADB reverse active: Quest can access http://localhost:${PORT}`);

    // 3. Launch Oculus Browser
    const targetUrl = `http://localhost:${PORT}/forest.html`;
    console.log(`Launching Oculus Browser on Quest to ${targetUrl}...`);
    const cmd = `"${adb}" shell am start -a android.intent.action.VIEW -d "${targetUrl}" com.oculus.browser`;
    execSync(cmd);
    console.log(`\n🚀 LAUNCH SUCCESSFUL!`);
    console.log(`Look inside your Quest headset: Oculus Browser is now opening Forest!`);
    console.log(`Click "ENTER VR" at the bottom right to enter immersive VR with wrist FPS HUD.`);
    console.log(`Press Ctrl+C to stop the dev server when done.\n`);
  } catch (err) {
    console.error(`ADB execution error:`, err.message);
  }
});
