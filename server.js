const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');
const dataDir = path.join(__dirname, 'data');
const notesFile = path.join(dataDir, 'notes.json');

const cliCommands = {
  'project-status': {
    label: '项目状态',
    description: 'git status -sb',
    cmd: 'git',
    args: ['status', '-sb'],
  },
  'list-root': {
    label: '根目录列表',
    description: 'ls -la',
    cmd: 'ls',
    args: ['-la'],
  },
  'list-public': {
    label: 'public 目录',
    description: 'ls -la public',
    cmd: 'ls',
    args: ['-la', 'public'],
  },
  'node-version': {
    label: 'Node 版本',
    description: 'node --version',
    cmd: 'node',
    args: ['--version'],
  },
  'disk-usage': {
    label: '磁盘占用',
    description: 'df -h',
    cmd: 'df',
    args: ['-h'],
  },
  uptime: {
    label: '系统运行时间',
    description: 'uptime',
    cmd: 'uptime',
    args: [],
  },
};

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

fs.mkdirSync(dataDir, { recursive: true });

let notes = [];

function loadNotes() {
  try {
    const raw = fs.readFileSync(notesFile, 'utf-8');
    const parsed = JSON.parse(raw);
    notes = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    notes = [];
    fs.writeFileSync(notesFile, JSON.stringify(notes, null, 2));
  }
}

function saveNotes() {
  return fs.promises.writeFile(notesFile, JSON.stringify(notes, null, 2));
}

loadNotes();

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readJsonBody(req, limitBytes = 10 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > limitBytes) {
        reject({ status: 413, message: '请求体过大' });
        req.destroy();
      }
    });

    req.on('end', () => {
      if (!body) {
        return resolve({});
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject({ status: 400, message: 'JSON 格式错误' });
      }
    });

    req.on('error', (error) => reject(error));
  });
}

function trimOutput(value, maxLength = 8000) {
  if (!value) return '';
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n... 输出已截断`;
}

function listCliCommands() {
  return Object.entries(cliCommands).map(([id, command]) => ({
    id,
    label: command.label,
    description: command.description,
  }));
}

function runCliCommand(commandId) {
  const command = cliCommands[commandId];
  if (!command) {
    return Promise.resolve({ ok: false, error: '命令不存在' });
  }

  return new Promise((resolve) => {
    const startedAt = Date.now();
    execFile(
      command.cmd,
      command.args,
      { cwd: __dirname, timeout: 4000, maxBuffer: 64 * 1024 },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - startedAt;
        if (error && error.code === 'ENOENT') {
          return resolve({ ok: false, error: '命令不可用' });
        }
        if (error && error.killed) {
          return resolve({ ok: false, error: '命令超时' });
        }

        const exitCode = typeof error?.code === 'number' ? error.code : 0;
        resolve({
          ok: true,
          result: {
            commandId,
            label: command.label,
            stdout: trimOutput(stdout),
            stderr: trimOutput(stderr),
            exitCode,
            durationMs,
            ranAt: new Date().toISOString(),
          },
        });
      }
    );
  });
}

async function handleApi(req, res, pathname) {
  if (pathname === '/api/status' && req.method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      message: 'Nebula Dock 正在运行。',
      serverTime: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      notesCount: notes.length,
      palette: ['aurora', 'ink', 'sunrise', 'citrine'],
    });
  }

  if (pathname === '/api/cli/commands' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, commands: listCliCommands() });
  }

  if (pathname === '/api/cli/run' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req);
      const commandId = typeof payload.commandId === 'string' ? payload.commandId.trim() : '';

      if (!commandId) {
        return sendJson(res, 400, { ok: false, error: 'commandId 不能为空' });
      }

      const result = await runCliCommand(commandId);
      if (!result.ok) {
        return sendJson(res, 400, { ok: false, error: result.error });
      }

      return sendJson(res, 200, { ok: true, result: result.result });
    } catch (error) {
      if (error && error.status) {
        return sendJson(res, error.status, { ok: false, error: error.message });
      }
      return sendJson(res, 500, { ok: false, error: '服务器错误' });
    }
  }

  if (pathname === '/api/notes') {
    if (req.method === 'GET') {
      return sendJson(res, 200, { ok: true, notes });
    }

    if (req.method === 'POST') {
      try {
        const payload = await readJsonBody(req);
        const text = typeof payload.text === 'string' ? payload.text.trim() : '';

        if (!text) {
          return sendJson(res, 400, { ok: false, error: '内容不能为空' });
        }

        if (text.length > 200) {
          return sendJson(res, 400, { ok: false, error: '内容过长' });
        }

        const note = {
          id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          text,
          createdAt: new Date().toISOString(),
        };

        notes.unshift(note);
        notes = notes.slice(0, 50);

        await saveNotes();
        return sendJson(res, 201, { ok: true, note });
      } catch (error) {
        if (error && error.status) {
          return sendJson(res, error.status, { ok: false, error: error.message });
        }
        return sendJson(res, 500, { ok: false, error: '服务器错误' });
      }
    }

    res.setHeader('Allow', 'GET, POST');
    return sendJson(res, 405, { ok: false, error: '方法不允许' });
  }

  return sendJson(res, 404, {
    ok: false,
    error: '未找到',
  });
}

function createServer() {
  return http.createServer((req, res) => {
    if (!req.url) {
      res.writeHead(400);
      return res.end('Bad Request');
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith('/api/')) {
      handleApi(req, res, pathname).catch(() => {
        sendJson(res, 500, { ok: false, error: 'Server error' });
      });
      return;
    }

    let requestPath = pathname;
    if (pathname === '/') {
      requestPath = '/index.html';
    } else if (pathname === '/agent' || pathname === '/agent/') {
      requestPath = '/agent.html';
    }
    const absolutePath = path.join(publicDir, requestPath);
    const normalizedPath = path.normalize(absolutePath);

    if (!normalizedPath.startsWith(publicDir)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    fs.readFile(normalizedPath, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end('Not Found');
      }

      const ext = path.extname(normalizedPath).toLowerCase();
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

module.exports = { createServer, PORT };
