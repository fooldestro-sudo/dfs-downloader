var express = require('express');
var cors = require('cors');
var path = require('path');
var fs = require('fs');
var spawn = require('child_process').spawn;

process.env.PATH = path.join(process.env.HOME, '.local', 'bin') + ':' + process.env.PATH;

var app = express();
var PORT = process.env.PORT || 3001;

var DOWNLOADS_DIR = path.join(process.env.HOME, 'Downloads', 'DFS');

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
  if (lower.includes('bilibili.com')) return 'Bilibili';
  if (lower.includes('ok.ru')) return 'OK.ru';
  if (lower.includes('vk.com') || lower.includes('vkvideo.ru')) return 'VK';
  if (lower.includes('bitchute.com')) return 'BitChute';
  if (lower.includes('rumble.com')) return 'Rumble';
  if (lower.includes('odysee.com') || lower.includes('lbry.tv')) return 'Odysee/LBRY';
  if (lower.includes('bandcamp.com')) return 'Bandcamp';
  if (lower.includes('deezer.com')) return 'Deezer';
  if (lower.includes('mixcloud.com')) return 'Mixcloud';
  if (lower.includes('archive.org')) return 'Archive.org';
  if (lower.includes('nicovideo.jp')) return 'NicoNico';
  if (lower.includes('dzen.ru')) return 'Dzen';
  return 'Other';
}

function runYtDlp(args, timeout) {
  return new Promise(function (resolve) {
    var proc = spawn('yt-dlp', args);
    var stdout = '';
    var stderr = '';
    var timer = null;

    if (timeout) {
      timer = setTimeout(function () {
        proc.kill('SIGKILL');
      }, timeout);
    }

    proc.stdout.on('data', function (d) { stdout += d.toString(); });
    proc.stderr.on('data', function (d) { stderr += d.toString(); });
    proc.on('close', function (code) {
      if (timer) clearTimeout(timer);
      resolve({ code: code, stdout: stdout, stderr: stderr });
    });
    proc.on('error', function () {
      if (timer) clearTimeout(timer);
      resolve({ code: 1, stdout: '', stderr: 'Failed to run yt-dlp' });
    });
  });
}

function parseVideoList(raw) {
  var lines = raw.split('\n').filter(function (l) { return l.trim(); });
  var videos = [];
  for (var i = 0; i < lines.length; i++) {
    var parts = lines[i].split('|||');
    if (parts.length >= 3 && parts[2] && parts[2].trim()) {
      videos.push({
        title: parts[0] || 'Untitled',
        duration: parts[1] || '',
        url: parts[2].trim(),
      });
    }
  }
  return videos;
}

function downloadWithProgress(url, index, send, outputDir) {
  send({ type: 'start', index: index, message: 'Starting download...' });

  var outTemplate = outputDir
    ? path.join(outputDir, '%(title)s [%(id)s].%(ext)s')
    : path.join(DOWNLOADS_DIR, '%(title)s [%(id)s].%(ext)s');

  var args = [
    url,
    '-o', outTemplate,
    '--no-playlist',
    '--newline',
    '--progress',
    '--no-check-certificates',
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
  var baseArgs = ['--print', '%(title)s|||%(duration_string)s|||%(url)s', '--no-warnings', '--no-check-certificates'];

  var attempt1 = await runYtDlp(baseArgs.concat(['--flat-playlist', url]), 30000);
  if (attempt1.code === 0) {
    var videos = parseVideoList(attempt1.stdout);
    if (videos.length > 0) {
      var titleResult = await runYtDlp(['--playlist-items', '0', '--print', '%(playlist_title)s', '--no-warnings', '--no-check-certificates', url], 10000);
      var title = 'Playlist';
      var t = titleResult.stdout.trim();
      if (t && !t.includes('ERROR')) title = t;
      return res.json({ title: title, videos: videos, platform: platform, isSingleVideo: false });
    }
  }

  var attempt2 = await runYtDlp(baseArgs.concat(['--flat-playlist', '--no-playlist', url]), 30000);
  if (attempt2.code === 0) {
    var videos2 = parseVideoList(attempt2.stdout);
    if (videos2.length > 0) {
      return res.json({ title: videos2[0].title || 'Playlist', videos: videos2, platform: platform, isSingleVideo: videos2.length === 1 });
    }
  }

  var attempt3 = await runYtDlp(baseArgs.concat([url]), 30000);
  if (attempt3.code === 0) {
    var videos3 = parseVideoList(attempt3.stdout);
    if (videos3.length > 0) {
      return res.json({ title: videos3.length === 1 ? videos3[0].title + ' (single video)' : 'Playlist', videos: videos3, platform: platform, isSingleVideo: videos3.length === 1 });
    }
  }

  var attempt4 = await runYtDlp(['--print', 'title|||duration_string|||webpage_url', '--no-warnings', '--no-check-certificates', url], 15000);
  if (attempt4.code === 0 && attempt4.stdout.trim()) {
    var parts = attempt4.stdout.trim().split('|||');
    var video = { title: parts[0] || 'Untitled', duration: parts[1] || '', url: parts[2] || url };
    return res.json({ title: video.title + ' (single video)', videos: [video], platform: platform, isSingleVideo: true });
  }

  var finalError = 'This URL could not be processed. The site may not be supported for playlist fetching. Try copying individual video URLs and pasting them in the Single Download tab.';
  if (attempt1.stderr && attempt1.stderr.includes('ERROR:')) {
    var m = attempt1.stderr.match(/ERROR: (.+)/);
    if (m) finalError = m[1].trim() + '. Try copying individual video URLs and pasting them in the Single Download tab.';
  }

  return res.status(500).json({ error: finalError });
});

app.listen(PORT, function () {
  console.log('');
  console.log('  DFS - Downloading For Society');
  console.log('  Backend running on http://localhost:' + PORT);
  console.log('  Downloads saved to: ' + DOWNLOADS_DIR);
  console.log('');
});
