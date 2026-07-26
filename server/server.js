const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

process.env.PATH = `${path.join(process.env.HOME, '.local', 'bin')}:${process.env.PATH}`;

const app = express();
const PORT = 3001;

const DOWNLOADS_DIR = path.join(process.env.HOME, 'Downloads', 'DFS');

if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..')));

function findYtDlp() {
  return new Promise((resolve) => {
    const check = spawn('yt-dlp', ['--version']);
    check.on('close', (code) => resolve(code === 0));
    check.on('error', () => resolve(false));
  });
}

function sanitizeDirName(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim().substring(0, 100);
}

function downloadWithProgress(url, index, send, outputDir) {
  send({ type: 'start', index, message: 'Starting download…' });

  const outTemplate = outputDir
    ? path.join(outputDir, '%(title)s [%(id)s].%(ext)s')
    : path.join(DOWNLOADS_DIR, '%(title)s [%(id)s].%(ext)s');

  const args = [
    url,
    '-o', outTemplate,
    '--no-playlist',
    '--newline',
    '--progress',
    '-f', 'bestvideo+bestaudio/best',
    '--merge-output-format', 'mp4',
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args);
    let title = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      const lines = text.split('\n');

      for (const line of lines) {
        const pctMatch = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
        if (pctMatch) {
          const progress = parseFloat(pctMatch[1]);
          send({ type: 'progress', index, message: `Downloading… ${progress.toFixed(0)}%`, progress });
        }

        const destMatch = line.match(/\[download\] Destination: .+[\\/](.+)\.\w+/);
        if (destMatch) title = destMatch[1];
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();

      const mergeMatch = stderr.match(/\[Merger\] Merging formats into "(.+)"/);
      if (mergeMatch) {
        title = path.basename(mergeMatch[1], path.extname(mergeMatch[1]));
        send({ type: 'progress', index, message: 'Merging audio & video…', progress: 95 });
      }
    });

    proc.on('close', (code) => {
      if (code === 0) {
        send({ type: 'complete', index, title: title || 'video', progress: 100 });
        resolve({ title });
      } else {
        const errMsg = stderr.includes('ERROR:')
          ? stderr.match(/ERROR: (.+)/)?.[1]?.trim() || 'Download failed'
          : 'Download failed';
        send({ type: 'error', index, message: errMsg });
        reject(new Error(errMsg));
      }
    });

    proc.on('error', () => {
      const msg = 'yt-dlp not installed. Run: pip install yt-dlp (or sudo apt install yt-dlp)';
      send({ type: 'error', index, message: msg });
      reject(new Error(msg));
    });
  });
}

/* ── HEALTH ── */
app.get('/api/health', async (_req, res) => {
  const hasYtDlp = await findYtDlp();
  res.json({
    status: 'ok',
    ytDlp: hasYtDlp,
    downloadsDir: DOWNLOADS_DIR,
    name: 'DFS — Downloading For Society',
  });
});

/* ── DOWNLOAD ── */
app.post('/api/download', async (req, res) => {
  const { urls, playlist } = req.body;

  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'No URLs provided' });
  }

  const hasYtDlp = await findYtDlp();
  if (!hasYtDlp) {
    return res.status(503).json({
      error: 'yt-dlp is not installed. Install with: pip install yt-dlp',
    });
  }

  let outputDir = DOWNLOADS_DIR;
  if (playlist) {
    const folderName = sanitizeDirName(playlist);
    outputDir = path.join(DOWNLOADS_DIR, folderName);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const send = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  for (let i = 0; i < urls.length; i++) {
    try {
      await downloadWithProgress(urls[i], i, send, playlist ? outputDir : null);
    } catch {
      /* error already sent via SSE */
    }
  }

  res.end();
});

/* ── PLAYLIST ── */
app.post('/api/playlist', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'No URL provided' });
  }

  const hasYtDlp = await findYtDlp();
  if (!hasYtDlp) {
    return res.status(503).json({
      error: 'yt-dlp is not installed. Install with: pip install yt-dlp',
    });
  }

  const args = [
    '--flat-playlist',
    '--print', '%(title)s|||%(duration_string)s|||%(url)s',
    '--no-warnings',
    url,
  ];

  const proc = spawn('yt-dlp', args);
  let stdout = '';
  let stderr = '';

  proc.stdout.on('data', (data) => { stdout += data.toString(); });
  proc.stderr.on('data', (data) => { stderr += data.toString(); });

  proc.on('close', (code) => {
    if (code !== 0) {
      const errMsg = stderr.includes('ERROR:')
        ? stderr.match(/ERROR: (.+)/)?.[1]?.trim() || 'Failed to fetch playlist'
        : 'Failed to fetch playlist';
      return res.status(500).json({ error: errMsg });
    }

    const lines = stdout.split('\n').filter(l => l.trim());
    const videos = lines.map(line => {
      const parts = line.split('|||');
      return {
        title: parts[0] || 'Untitled',
        duration: parts[1] || '',
        url: parts[2] || '',
      };
    }).filter(v => v.url);

    let title = 'Playlist';
    try {
      const titleProc = spawn('yt-dlp', ['--playlist-items', '0', '--print', '%(playlist_title)s', '--no-warnings', url]);
      let titleOut = '';
      titleProc.stdout.on('data', (d) => { titleOut += d.toString(); });
      titleProc.on('close', () => {
        const t = titleOut.trim();
        if (t && !t.includes('ERROR')) title = t;
        res.json({ title, videos });
      });
    } catch {
      res.json({ title, videos });
    }
  });
});

/* ── START ── */
app.listen(PORT, () => {
  console.log(`\n  DFS — Downloading For Society`);
  console.log(`  Backend running on http://localhost:${PORT}`);
  console.log(`  Downloads saved to: ${DOWNLOADS_DIR}\n`);
});
