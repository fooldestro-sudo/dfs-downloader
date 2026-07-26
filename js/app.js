const API_BASE = 'http://localhost:3001';

const linksContainer = document.getElementById('linksContainer');
const addLinkBtn = document.getElementById('addLinkBtn');
const downloadAllBtn = document.getElementById('downloadAllBtn');
const clearAllBtn = document.getElementById('clearAllBtn');
const statusCard = document.getElementById('statusCard');
const statusList = document.getElementById('statusList');
const overallProgress = document.getElementById('overallProgress');
const toast = document.getElementById('toast');

let isDownloading = false;

function showToast(message, type = 'success') {
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toast.classList.remove('show');
  }, 4000);
}

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

function createStatusItem(url, index) {
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

function updateStatusItem(index, { status, message, progress }) {
  const item = statusList.querySelector(`[data-index="${index}"]`);
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

async function checkBackend() {
  try {
    const res = await fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

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
    statusList.appendChild(createStatusItem(url, index));
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
          handleDownloadEvent(event, links.length, () => {
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
      updateStatusItem(index, { status: 'error', message: err.message || 'Failed' });
    });
  } finally {
    isDownloading = false;
    downloadAllBtn.disabled = false;
    addLinkBtn.disabled = false;
    clearAllBtn.disabled = false;
  }
}

function handleDownloadEvent(event, total, onComplete) {
  const { type, index, message, progress, title } = event;

  switch (type) {
    case 'start':
      updateStatusItem(index, { status: 'downloading', message: 'Starting download…', progress: 5 });
      break;
    case 'progress':
      updateStatusItem(index, {
        status: 'downloading',
        message: message || 'Downloading…',
        progress: progress || 50,
      });
      break;
    case 'complete':
      updateStatusItem(index, {
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
      updateStatusItem(index, { status: 'error', message: message || 'Download failed', progress: 100 });
      onComplete();
      break;
    default:
      break;
  }
}

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

linksContainer.addEventListener('click', (e) => {
  if (e.target.classList.contains('remove-btn')) return;
});

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

checkBackend().then((ready) => {
  if (!ready) {
    showToast('Start the backend: node server/server.js', 'error');
  }
});
