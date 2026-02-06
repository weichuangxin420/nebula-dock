const statusEl = document.querySelector('[data-status]');
const logEl = document.querySelector('[data-log]');
const refreshButtons = document.querySelectorAll('[data-refresh]');
const notesList = document.querySelector('[data-notes]');
const noteForm = document.querySelector('[data-note-form]');
const uptimeEl = document.querySelector('[data-uptime]');
const notesCountEl = document.querySelector('[data-notes-count]');
const serverTimeEl = document.querySelector('[data-server-time]');

const logTemplates = [
  '指引灯已对齐北向航道。',
  '正在监听信号包。',
  '根据配色提示重建渐变。',
  'Dock 镜头已校准天际线。',
];

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderLogEntries(message, palette) {
  if (!logEl) return;
  const entries = [
    `状态：${message}`,
    `配色提示：${palette.join('、')}`,
    ...logTemplates,
  ];
  logEl.innerHTML = entries.map((line) => `<li>${escapeHtml(line)}</li>`).join('');
}

function renderNotes(notes) {
  if (!notesList) return;
  if (!notes.length) {
    notesList.innerHTML = '<li class="muted">暂无便笺，先写一条吧。</li>';
    return;
  }

  notesList.innerHTML = notes
    .map((note) => {
      const text = escapeHtml(note.text);
      const date = new Date(note.createdAt).toLocaleString('zh-CN');
      return `
        <li>
          <div class="note-text">${text}</div>
          <div class="note-meta">${escapeHtml(date)}</div>
        </li>`;
    })
    .join('');
}

function updateStats(data) {
  if (uptimeEl) {
    uptimeEl.textContent = `${data.uptimeSeconds}s`;
  }
  if (notesCountEl) {
    notesCountEl.textContent = `${data.notesCount}`;
  }
  if (serverTimeEl) {
    const time = new Date(data.serverTime).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    });
    serverTimeEl.textContent = time;
  }
}

async function loadStatus() {
  if (statusEl) {
    statusEl.textContent = '正在同步...';
  }

  try {
    const response = await fetch('/api/status');
    const data = await response.json();
    if (statusEl) {
      statusEl.textContent = `${data.message} · 运行 ${data.uptimeSeconds}s`;
    }
    updateStats(data);
    renderLogEntries(data.message, data.palette || []);
  } catch (error) {
    if (statusEl) {
      statusEl.textContent = '无法连接到 API。';
    }
    renderLogEntries('API 离线', []);
  }
}

async function loadNotes() {
  if (!notesList) return;
  try {
    const response = await fetch('/api/notes');
    const data = await response.json();
    renderNotes(data.notes || []);
  } catch (error) {
    notesList.innerHTML = '<li class="muted">便笺加载失败。</li>';
  }
}

async function submitNote(text) {
  const response = await fetch('/api/notes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });

  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.error || '无法保存便笺');
  }

  return data.note;
}

function setupReveal() {
  const items = document.querySelectorAll('.reveal');
  if (!items.length) return;

  if (!('IntersectionObserver' in window)) {
    items.forEach((item) => item.classList.add('in'));
    return;
  }

  const observer = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          obs.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.18 }
  );

  items.forEach((item) => observer.observe(item));
}

refreshButtons.forEach((button) => {
  button.addEventListener('click', loadStatus);
});

if (noteForm) {
  noteForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = noteForm.querySelector('input[name="note"]');
    if (!input) return;

    const text = input.value.trim();
    if (!text) return;

    noteForm.classList.add('is-loading');
    try {
      await submitNote(text);
      input.value = '';
      await loadNotes();
      await loadStatus();
    } catch (error) {
      alert(error.message || '提交失败');
    } finally {
      noteForm.classList.remove('is-loading');
    }
  });
}

loadStatus();
loadNotes();
setupReveal();
