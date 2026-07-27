const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

process.env.PATH = path.join(process.env.HOME, '.local', 'bin') + ':' + process.env.PATH;

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
  return new Promise(function (resolve) {
    var check = spawn('yt-dlp', ['--version']);
    check.on('close', function (code) { resolve(code === 0); });
    check.on('error', function () { resolve(false); });
  });
}

function sanitizeDirName(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim().substring(0, 100);
}

function detectPlatform(url) {
  var lower = url.toLowerCase();
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'YouTube';
  if (lower.includes('spotify.com')) return 'Spotify';
  if (lower.includes('soundcloud.com')) return 'SoundCloud';
  if (lower.includes('tiktok.com') || lower.includes('vm.tiktok.com')) return 'TikTok';
  if (lower.includes('instagram.com')) return 'Instagram';
  if (lower.includes('facebook.com') || lower.includes('fb.watch')) return 'Facebook';
  if (lower.includes('twitter.com') || lower.includes('x.com')) return 'X/Twitter';
  if (lower.includes('vimeo.com')) return 'Vimeo';
  if (lower.includes('dailymotion.com')) return 'Dailymotion';
  if (lower.includes('twitch.tv')) return 'Twitch';
  if (lower.includes('reddit.com')) return 'Reddit';
  if (lower.includes('nicovideo.jp')) return 'NicoNico';
  if (lower.includes('bilibili.com')) return 'Bilibili';
  if (lower.includes('tumblr.com')) return 'Tumblr';
  if (lower.includes('archive.org')) return 'Archive.org';
  if (lower.includes('archivevideo.com')) return 'Archive.org';
  if (lower.includes('dzen.ru')) return 'Dzen';
  if (lower.includes('ok.ru')) return 'OK.ru';
  if (lower.includes('vk.com') || lower.includes('vkvideo.ru')) return 'VK';
  if (lower.includes('bitchute.com')) return 'BitChute';
  if (lower.includes('rumble.com')) return 'Rumble';
  if (lower.includes('odysee.com') || lower.includes('lbry.tv')) return 'Odysee/LBRY';
  if (lower.includes('peertube')) return 'PeerTube';
  if (lower.includes('streamable.com')) return 'Streamable';
  if (lower.includes('mixcloud.com')) return 'Mixcloud';
  if (lower.includes('bandcamp.com')) return 'Bandcamp';
  if (lower.includes('deezer.com')) return 'Deezer';
  if (lower.includes('piped.video') || lower.includes('piped.kavin.rocks')) return 'Piped (YouTube proxy)';
  if (lower.includes('invidious')) return 'Invidious (YouTube proxy)';
  return 'Unknown';
}

function downloadWithProgress(url, index, send, outputDir) {
  send({ type: 'start', index, message: 'Starting download...' });

  var outTemplate = outputDir
    ? path.join(outputDir, '%(title)s [%(id)s].%(ext)s')
    : path.join(DOWNLOADS_DIR, '%(title)s [%(id)s].%(ext)s');

  var args = [
    url,
    '-o', outTemplate,
    '--no-playlist',
    '--newline',
    '--progress',
    '-f', 'bestvideo+bestaudio/best',
    '--merge-output-format', 'mp4',
  ];

  return new Promise(function (resolve, reject) {
    var proc = spawn('yt-dlp', args);
    var title = '';
    var stderr = '';

    proc.stdout.on('data', function (data) {
      var text = data.toString();
      var lines = text.split('\n');

      for (var i = 0; i < lines.length; i++) {
        var pctMatch = lines[i].match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
        if (pctMatch) {
          var progress = parseFloat(pctMatch[1]);
          send({ type: 'progress', index: index, message: 'Downloading... ' + progress.toFixed(0) + '%', progress: progress });
        }

        var destMatch = lines[i].match(/\[download\] Destination: .+[\\/](.+)\.\w+/);
        if (destMatch) title = destMatch[1];
      }
    });

    proc.stderr.on('data', function (data) {
      stderr += data.toString();

      var mergeMatch = stderr.match(/\[Merger\] Merging formats into "(.+)"/);
      if (mergeMatch) {
        title = path.basename(mergeMatch[1], path.extname(mergeMatch[1]));
        send({ type: 'progress', index: index, message: 'Merging audio & video...', progress: 95 });
      }
    });

    proc.on('close', function (code) {
      if (code === 0) {
        send({ type: 'complete', index: index, title: title || 'video', progress: 100 });
        resolve({ title: title });
      } else {
        var errMsg = 'Download failed';
        if (stderr.includes('ERROR:')) {
          var m = stderr.match(/ERROR: (.+)/);
          if (m) errMsg = m[1].trim();
        }
        send({ type: 'error', index: index, message: errMsg });
        reject(new Error(errMsg));
      }
    });

    proc.on('error', function () {
      var msg = 'yt-dlp not installed. Run: pip install yt-dlp (or sudo apt install yt-dlp)';
      send({ type: 'error', index: index, message: msg });
      reject(new Error(msg));
    });
  });
}

app.get('/api/health', async function (_req, res) {
  var hasYtDlp = await findYtDlp();
  res.json({
    status: 'ok',
    ytDlp: hasYtDlp,
    downloadsDir: DOWNLOADS_DIR,
    name: 'DFS - Downloading For Society',
  });
});

app.post('/api/download', async function (req, res) {
  var urls = req.body.urls;
  var playlist = req.body.playlist;

  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'No URLs provided' });
  }

  var hasYtDlp = await findYtDlp();
  if (!hasYtDlp) {
    return res.status(503).json({
      error: 'yt-dlp is not installed. Install with: pip install yt-dlp',
    });
  }

  var outputDir = DOWNLOADS_DIR;
  if (playlist) {
    var folderName = sanitizeDirName(playlist);
    outputDir = path.join(DOWNLOADS_DIR, folderName);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  function send(data) {
    res.write('data: ' + JSON.stringify(data) + '\n\n');
  }

  for (var i = 0; i < urls.length; i++) {
    try {
      await downloadWithProgress(urls[i], i, send, playlist ? outputDir : null);
    } catch (e) {
      /* error already sent via SSE */
    }
  }

  res.end();
});

app.post('/api/playlist', async function (req, res) {
  var url = req.body.url;

  if (!url || !url.trim()) {
    return res.status(400).json({ error: 'No URL provided' });
  }

  url = url.trim();

  var hasYtDlp = await findYtDlp();
  if (!hasYtDlp) {
    return res.status(503).json({
      error: 'yt-dlp is not installed. Install with: pip install yt-dlp',
    });
  }

  var platform = detectPlatform(url);

  var args = [
    '--flat-playlist',
    '--print', '%(title)s|||%(duration_string)s|||%(url)s',
    '--no-warnings',
    '--no-check-certificates',
    url,
  ];

  var proc = spawn('yt-dlp', args);
  var stdout = '';
  var stderr = '';

  proc.stdout.on('data', function (data) { stdout += data.toString(); });
  proc.stderr.on('data', function (data) { stderr += data.toString(); });

  proc.on('close', function (code) {
    if (code !== 0) {
      var errMsg = 'Failed to fetch playlist';
      if (stderr.includes('ERROR:')) {
        var m = stderr.match(/ERROR: (.+)/);
        if (m) errMsg = m[1].trim();
      }

      var singleVideoArgs = ['--print', 'title|||duration_string|||webpage_url', '--no-warnings', '--no-check-certificates', url];
      var singleProc = spawn('yt-dlp', singleVideoArgs);
      var singleStdout = '';
      var singleStderr = '';

      singleProc.stdout.on('data', function (d) { singleStdout += d.toString(); });
      singleProc.stderr.on('data', function (d) { singleStderr += d.toString(); });

      singleProc.on('close', function (singleCode) {
        if (singleCode === 0 && singleStdout.trim()) {
          var parts = singleStdout.trim().split('|||');
          var video = {
            title: parts[0] || 'Untitled',
            duration: parts[1] || '',
            url: parts[2] || url,
          };
          return res.json({
            title: video.title + ' (single video)',
            videos: [video],
            platform: platform,
            isSingleVideo: true,
          });
        }

        return res.status(500).json({ error: errMsg });
      });
      return;
    }

    var lines = stdout.split('\n').filter(function (l) { return l.trim(); });
    var videos = [];

    for (var i = 0; i < lines.length; i++) {
      var parts = lines[i].split('|||');
      if (parts[2] && parts[2].trim()) {
        videos.push({
          title: parts[0] || 'Untitled',
          duration: parts[1] || '',
          url: parts[2].trim(),
        });
      }
    }

    if (videos.length === 0) {
      return res.status(400).json({
        error: 'No videos found at this URL. It may not be a playlist or supported format.',
      });
    }

    var title = 'Playlist';

    try {
      var titleProc = spawn('yt-dlp', ['--playlist-items', '0', '--print', '%(playlist_title)s', '--no-warnings', '--no-check-certificates', url]);
      var titleOut = '';

      titleProc.stdout.on('data', function (d) { titleOut += d.toString(); });
      titleProc.on('close', function () {
        var t = titleOut.trim();
        if (t && !t.includes('ERROR')) {
          title = t;
        }
        res.json({ title: title, videos: videos, platform: platform, isSingleVideo: false });
      });
    } catch (e) {
      res.json({ title: title, videos: videos, platform: platform, isSingleVideo: false });
    }
  });
});

app.listen(PORT, function () {
  console.log('');
  console.log('  DFS - Downloading For Society');
  console.log('  Backend running on http://localhost:' + PORT);
  console.log('  Downloads saved to: ' + DOWNLOADS_DIR);
  console.log('');
});
