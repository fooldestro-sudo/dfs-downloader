const API_BASE = 'http://localhost:3001';

/* ── DOM REFS ── */
const linksContainer = document.getElementById('linksContainer');
const addLinkBtn = document.getElementById('addLinkBtn');
const downloadAllBtn = document.getElementById('downloadAllBtn');
const clearAllBtn = document.getElementById('clearAllBtn');
const statusCard = document.getElementById('statusCard');
const statusList = document.getElementById('statusList');
const overallProgress = document.getElementById('overallProgress');
const toast = document.getElementById('toast');
const themeToggle = document.getElementById('themeToggle');

/* Playlist DOM */
const playlistUrl = document.getElementById('playlistUrl');
const fetchPlaylistBtn = document.getElementById('fetchPlaylistBtn');
const playlistInfo = document.getElementById('playlistInfo');
const playlistTitle = document.getElementById('playlistTitle');
const playlistCount = document.getElementById('playlistCount');
const playlistItems = document.getElementById('playlistItems');
const downloadPlaylistBtn = document.getElementById('downloadPlaylistBtn');
const clearPlaylistBtn = document.getElementById('clearPlaylistBtn');
const playlistStatusCard = document.getElementById('playlistStatusCard');
const playlistStatusList = document.getElementById('playlistStatusList');
const playlistOverallProgress = document.getElementById('playlistOverallProgress');

let isDownloading = false;
let currentPlaylistUrls = [];

/* ── THEME TOGGLE ── */
function getPreferredTheme() {
  const saved = localStorage.getItem('dfs-theme');
  if (saved) return saved;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('dfs-theme', theme);
}

setTheme(getPreferredTheme());

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  setTheme(current === 'dark' ? 'light' : 'dark');
});

/* ── TABS ── */
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
  });
});

/* ── TOAST ── */
function showToast(message, type = 'success') {
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toast.classList.remove('show');
  }, 4000);
}

/* ── SINGLE DOWNLOAD: LINK MANAGEMENT ── */
function renumberLinks() {
  linksContainer.querySelectorAll('.link-row').forEach((row, index) => {
    row.querySelector('.link-number').textContent = index + 1;
  });
}

function createLinkRow(value = '') {
  const row = document.createElement('div');
  row.className = 'link-row';
  row.innerHTML = `
    <span class="link-number">1</span>
    <input type="url" class="link-input" placeholder="Paste video URL (YouTube, TikTok, Instagram, Twitter/X, Facebook…)" value="${escapeHtml(value)}" />
    <button type="button" class="btn-icon remove-btn" title="Remove" aria-label="Remove link">×</button>
  `;

  row.querySelector('.remove-btn').addEventListener('click', () => {
    const rows = linksContainer.querySelectorAll('.link-row');
    if (rows.length <= 1) {
      row.querySelector('.link-input').value = '';
      return;
    }
    row.remove();
    renumberLinks();
  });

  return row;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function getLinks() {
  return [...linksContainer.querySelectorAll('.link-input')]
    .map((input) => input.value.trim())
    .filter(Boolean);
}

/* ── SINGLE DOWNLOAD: STATUS ── */
function createStatusItem(url, index, container) {
  const item = document.createElement('div');
  item.className = 'status-item';
  item.dataset.index = index;
  item.innerHTML = `
    <div class="status-indicator pending"></div>
    <div class="status-info">
      <div class="status-url" title="${escapeHtml(url)}">${escapeHtml(url)}</div>
      <div class="status-message">Waiting…</div>
      <div class="status-bar-wrap"><div class="status-bar"></div></div>
    </div>
  `;
  return item;
}

function updateStatusItem(listEl, index, { status, message, progress }) {
  const item = listEl.querySelector(`[data-index="${index}"]`);
  if (!item) return;

  const indicator = item.querySelector('.status-indicator');
  const messageEl = item.querySelector('.status-message');
  const bar = item.querySelector('.status-bar');

  indicator.className = `status-indicator ${status}`;
  messageEl.textContent = message;

  if (progress !== undefined) {
    bar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
  }
}

/* ── BACKEND CHECK ── */
async function checkBackend() {
  try {
    const res = await fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/* ── SINGLE DOWNLOAD ── */
async function downloadAll() {
  const links = getLinks();

  if (links.length === 0) {
    showToast('Please add at least one video link.', 'error');
    return;
  }

  const backendReady = await checkBackend();
  if (!backendReady) {
    showToast('Backend server is not running. Start it with: node server/server.js', 'error');
    return;
  }

  isDownloading = true;
  downloadAllBtn.disabled = true;
  addLinkBtn.disabled = true;
  clearAllBtn.disabled = true;

  statusCard.hidden = false;
  statusList.innerHTML = '';
  overallProgress.textContent = `0 / ${links.length}`;

  links.forEach((url, index) => {
    statusList.appendChild(createStatusItem(url, index, statusList));
  });

  let completed = 0;

  try {
    const response = await fetch(`${API_BASE}/api/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: links }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Download request failed');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6));
          handleDownloadEvent(statusList, event, links.length, () => {
            completed++;
            overallProgress.textContent = `${completed} / ${links.length}`;
          });
        } catch {
          /* skip malformed events */
        }
      }
    }
  } catch (err) {
    showToast(err.message || 'Something went wrong.', 'error');
    links.forEach((_, index) => {
      updateStatusItem(statusList, index, { status: 'error', message: err.message || 'Failed' });
    });
  } finally {
    isDownloading = false;
    downloadAllBtn.disabled = false;
    addLinkBtn.disabled = false;
    clearAllBtn.disabled = false;
  }
}

function handleDownloadEvent(listEl, event, total, onComplete) {
  const { type, index, message, progress, title } = event;

  switch (type) {
    case 'start':
      updateStatusItem(listEl, index, { status: 'downloading', message: 'Starting download…', progress: 5 });
      break;
    case 'progress':
      updateStatusItem(listEl, index, {
        status: 'downloading',
        message: message || 'Downloading…',
        progress: progress || 50,
      });
      break;
    case 'complete':
      updateStatusItem(listEl, index, {
        status: 'success',
        message: title ? `Saved: ${title}` : 'Download complete!',
        progress: 100,
      });
      onComplete();
      if (index === total - 1) {
        showToast('All downloads finished!', 'success');
      }
      break;
    case 'error':
      updateStatusItem(listEl, index, { status: 'error', message: message || 'Download failed', progress: 100 });
      onComplete();
      break;
    default:
      break;
  }
}

/* ── PLAYLIST: FETCH ── */
async function fetchPlaylist() {
  const url = playlistUrl.value.trim();
  if (!url) {
    showToast('Please enter a playlist URL.', 'error');
    return;
  }

  fetchPlaylistBtn.disabled = true;
  fetchPlaylistBtn.innerHTML = '<span class="btn-icon-download">&#8635;</span> Fetching...';
  playlistInfo.hidden = true;

  try {
    const response = await fetch(`${API_BASE}/api/playlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to fetch playlist');
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    const platformBadge = data.platform ? ` [${data.platform}]` : '';
    const label = data.isSingleVideo ? 'Video' : 'Playlist';
    playlistTitle.textContent = (data.title || label) + platformBadge;
    playlistCount.textContent = `${data.videos.length} ${data.isSingleVideo ? 'video' : 'videos'}`;

    playlistItems.innerHTML = '';
    data.videos.forEach((video, i) => {
      const item = document.createElement('div');
      item.className = 'playlist-item';
      item.innerHTML = `
        <span class="playlist-item-num">${i + 1}</span>
        <span class="playlist-item-title" title="${escapeHtml(video.title)}">${escapeHtml(video.title)}</span>
        <span class="playlist-item-duration">${video.duration || ''}</span>
      `;
      playlistItems.appendChild(item);
    });

    currentPlaylistUrls = data.videos.map(v => v.url);
    playlistInfo.hidden = false;

    if (data.isSingleVideo) {
      showToast('Detected single video from ' + (data.platform || 'source'), 'success');
    } else {
      showToast(`Found ${data.videos.length} videos (${data.platform || 'unknown platform'})`, 'success');
    }
  } catch (error) {
    showToast(error.message || 'Failed to fetch playlist', 'error');
  } finally {
    fetchPlaylistBtn.disabled = false;
    fetchPlaylistBtn.innerHTML = '<span class="btn-icon-download">&#8635;</span> Fetch Playlist';
  }
}

/* ── PLAYLIST: DOWNLOAD ── */
async function downloadPlaylist() {
  if (currentPlaylistUrls.length === 0) {
    showToast('No videos to download. Fetch a playlist first.', 'error');
    return;
  }

  const backendReady = await checkBackend();
  if (!backendReady) {
    showToast('Backend server is not running.', 'error');
    return;
  }

  isDownloading = true;
  downloadPlaylistBtn.disabled = true;
  clearPlaylistBtn.disabled = true;
  fetchPlaylistBtn.disabled = true;

  playlistStatusCard.hidden = false;
  playlistStatusList.innerHTML = '';
  playlistOverallProgress.textContent = `0 / ${currentPlaylistUrls.length}`;

  currentPlaylistUrls.forEach((url, index) => {
    playlistStatusList.appendChild(createStatusItem(url, index, playlistStatusList));
  });

  let completed = 0;

  try {
    const playlistName = playlistTitle.textContent || 'playlist';
    const response = await fetch(`${API_BASE}/api/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: currentPlaylistUrls, playlist: playlistName }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Download request failed');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6));
          handleDownloadEvent(playlistStatusList, event, currentPlaylistUrls.length, () => {
            completed++;
            playlistOverallProgress.textContent = `${completed} / ${currentPlaylistUrls.length}`;
          });
        } catch {
          /* skip malformed events */
        }
      }
    }
  } catch (err) {
    showToast(err.message || 'Something went wrong.', 'error');
  } finally {
    isDownloading = false;
    downloadPlaylistBtn.disabled = false;
    clearPlaylistBtn.disabled = false;
    fetchPlaylistBtn.disabled = false;
  }
}

/* ── EVENT LISTENERS ── */
addLinkBtn.addEventListener('click', () => {
  linksContainer.appendChild(createLinkRow());
  renumberLinks();
  linksContainer.lastElementChild.querySelector('.link-input').focus();
});

clearAllBtn.addEventListener('click', () => {
  if (isDownloading) return;
  linksContainer.innerHTML = '';
  linksContainer.appendChild(createLinkRow());
  renumberLinks();
  statusCard.hidden = true;
  statusList.innerHTML = '';
});

downloadAllBtn.addEventListener('click', downloadAll);
fetchPlaylistBtn.addEventListener('click', fetchPlaylist);
downloadPlaylistBtn.addEventListener('click', downloadPlaylist);

clearPlaylistBtn.addEventListener('click', () => {
  if (isDownloading) return;
  playlistUrl.value = '';
  playlistInfo.hidden = true;
  playlistStatusCard.hidden = true;
  playlistStatusList.innerHTML = '';
  playlistItems.innerHTML = '';
  currentPlaylistUrls = [];
});

linksContainer.addEventListener('click', (e) => {
  if (e.target.classList.contains('remove-btn')) return;
});

/* ── PASTE HANDLER ── */
document.addEventListener('paste', (e) => {
  const text = e.clipboardData.getData('text');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 1) return;

  const hasUrl = lines.some((l) => /^https?:\/\//i.test(l));
  if (!hasUrl) return;

  e.preventDefault();

  linksContainer.innerHTML = '';
  lines.forEach((url) => {
    if (/^https?:\/\//i.test(url)) {
      linksContainer.appendChild(createLinkRow(url));
    }
  });

  if (linksContainer.children.length === 0) {
    linksContainer.appendChild(createLinkRow());
  }

  renumberLinks();
  showToast(`Added ${linksContainer.children.length} link(s) from clipboard`);
});

/* ── BACKEND CHECK ON LOAD ── */
checkBackend().then((ready) => {
  if (!ready) {
    showToast('Start the backend: node server/server.js', 'error');
  }
});
