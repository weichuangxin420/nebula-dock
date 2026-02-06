const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');
const dataDir = path.join(__dirname, 'data');
const notesFile = path.join(dataDir, 'notes.json');
const llmDir = path.join(dataDir, 'llm');
const llmSessionsFile = path.join(llmDir, 'sessions.json');
const mcpServersFile = path.join(llmDir, 'mcp.json');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_SUMMARY_MODEL = process.env.OPENAI_SUMMARY_MODEL || OPENAI_MODEL;
const LLM_SYSTEM_PROMPT =
  process.env.LLM_SYSTEM_PROMPT ||
  '你是 Nebula Dock 的本地助手，回答需简洁、结构清晰，并在需要时调用工具。';
const LLM_MAX_CONTEXT_CHARS = Number(process.env.LLM_MAX_CONTEXT_CHARS || 8000);
const LLM_MAX_TAIL_MESSAGES = Number(process.env.LLM_MAX_TAIL_MESSAGES || 20);
const LLM_MAX_TOOL_LOOPS = Number(process.env.LLM_MAX_TOOL_LOOPS || 3);
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 12000);

const cliCommands = {
  'project-status': {
    label: '项目状态',
    description: 'git status -sb',
    command: 'git status -sb',
  },
  'list-root': {
    label: '根目录列表',
    description: 'ls -la',
    command: 'ls -la',
  },
  'list-public': {
    label: 'public 目录',
    description: 'ls -la public',
    command: 'ls -la public',
  },
  'node-version': {
    label: 'Node 版本',
    description: 'node --version',
    command: 'node --version',
  },
  'disk-usage': {
    label: '磁盘占用',
    description: 'df -h',
    command: 'df -h',
  },
  uptime: {
    label: '系统运行时间',
    description: 'uptime',
    command: 'uptime',
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
fs.mkdirSync(llmDir, { recursive: true });

let notes = [];
let llmSessions = {};
let llmSessionOrder = [];
let mcpServers = {};

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

function loadJsonFile(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

function saveJsonFile(filePath, payload) {
  return fs.promises.writeFile(filePath, JSON.stringify(payload, null, 2));
}

function loadLlmSessions() {
  const state = loadJsonFile(llmSessionsFile, { sessions: {}, order: [] });
  llmSessions = state.sessions || {};
  llmSessionOrder = Array.isArray(state.order)
    ? state.order.filter((id) => llmSessions[id])
    : Object.keys(llmSessions);
}

function saveLlmSessions() {
  return saveJsonFile(llmSessionsFile, {
    sessions: llmSessions,
    order: llmSessionOrder,
  });
}

function loadMcpServers() {
  const state = loadJsonFile(mcpServersFile, { servers: {} });
  mcpServers = state.servers || {};
}

function saveMcpServers() {
  return saveJsonFile(mcpServersFile, { servers: mcpServers });
}

loadNotes();
loadLlmSessions();
loadMcpServers();

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
    command: command.command,
  }));
}

function runCliCommand(commandInput) {
  const command = commandInput.trim();
  if (!command) {
    return Promise.resolve({ ok: false, error: '命令不能为空' });
  }

  return new Promise((resolve) => {
    const startedAt = Date.now();
    exec(
      command,
      {
        cwd: __dirname,
        timeout: 8000,
        maxBuffer: 256 * 1024,
        shell: '/bin/zsh',
      },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - startedAt;
        if (error && error.killed) {
          return resolve({ ok: false, error: '命令超时' });
        }

        const exitCode = typeof error?.code === 'number' ? error.code : 0;
        resolve({
          ok: true,
          result: {
            command,
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

function createNote(text) {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) {
    return { ok: false, error: '内容不能为空' };
  }
  if (trimmed.length > 200) {
    return { ok: false, error: '内容过长' };
  }

  const note = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    text: trimmed,
    createdAt: new Date().toISOString(),
  };

  notes.unshift(note);
  notes = notes.slice(0, 50);
  return { ok: true, note };
}

function generateId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function createSession({ title, systemPrompt } = {}) {
  const id = generateId('sess');
  const now = new Date().toISOString();
  const session = {
    id,
    title: title || '新会话',
    systemPrompt: systemPrompt || LLM_SYSTEM_PROMPT,
    summary: '',
    messages: [],
    createdAt: now,
    updatedAt: now,
    meta: {},
  };

  llmSessions[id] = session;
  llmSessionOrder.unshift(id);
  saveLlmSessions();
  return session;
}

function listSessions() {
  return llmSessionOrder.map((id) => {
    const session = llmSessions[id];
    return {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: session.messages.length,
      summary: session.summary || '',
    };
  });
}

function getSession(sessionId) {
  return llmSessions[sessionId] || null;
}

function updateSession(session) {
  session.updatedAt = new Date().toISOString();
  llmSessions[session.id] = session;
  if (!llmSessionOrder.includes(session.id)) {
    llmSessionOrder.unshift(session.id);
  }
  return saveLlmSessions();
}

function addMessage(session, message) {
  session.messages.push({
    id: generateId('msg'),
    role: message.role,
    content: message.content,
    toolCallId: message.toolCallId || null,
    toolCalls: message.toolCalls || null,
    createdAt: new Date().toISOString(),
  });
}

function estimateChars(messages) {
  return messages.reduce((total, msg) => total + (msg.content?.length || 0), 0);
}

async function summarizeMessages(messages) {
  const text = messages
    .map((msg) => `${msg.role}: ${msg.content}`)
    .join('\n')
    .slice(0, 6000);

  if (!OPENAI_API_KEY) {
    return `本地摘要：${text.slice(0, 800)}${text.length > 800 ? '...' : ''}`;
  }

  const summaryMessages = [
    { role: 'system', content: '请用简洁中文总结以下对话，保留关键上下文。' },
    { role: 'user', content: text },
  ];

  const result = await callOpenAIChat({
    messages: summaryMessages,
    model: OPENAI_SUMMARY_MODEL,
    temperature: 0.2,
  });

  return result.text || `本地摘要：${text.slice(0, 800)}${text.length > 800 ? '...' : ''}`;
}

async function compactSession(session) {
  const totalChars = estimateChars(session.messages);
  if (totalChars <= LLM_MAX_CONTEXT_CHARS) {
    return;
  }

  const overflowIndex = Math.max(0, session.messages.length - LLM_MAX_TAIL_MESSAGES);
  const toSummarize = session.messages.slice(0, overflowIndex);
  if (!toSummarize.length) {
    return;
  }

  const summary = await summarizeMessages(toSummarize);
  session.summary = summary;
  session.messages = session.messages.slice(overflowIndex);
}

function buildChatMessages(session) {
  const messages = [];
  const systemPrompt = session.systemPrompt || LLM_SYSTEM_PROMPT;
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  if (session.summary) {
    messages.push({ role: 'system', content: `上下文摘要：${session.summary}` });
  }
  session.messages.forEach((msg) => {
    if (msg.role === 'tool') {
      messages.push({
        role: 'tool',
        tool_call_id: msg.toolCallId,
        content: msg.content,
      });
    } else {
      const entry = { role: msg.role, content: msg.content };
      if (msg.role === 'assistant' && msg.toolCalls) {
        entry.tool_calls = msg.toolCalls;
      }
      messages.push(entry);
    }
  });
  return messages;
}

async function callOpenAIChat({ messages, tools, model, temperature, maxTokens }) {
  if (!OPENAI_API_KEY) {
    return { text: '', raw: null, error: '缺少 OPENAI_API_KEY' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || OPENAI_MODEL,
        messages,
        tools,
        tool_choice: tools && tools.length ? 'auto' : 'none',
        temperature: typeof temperature === 'number' ? temperature : 0.6,
        max_tokens: typeof maxTokens === 'number' ? maxTokens : undefined,
      }),
      signal: controller.signal,
    });

    const data = await response.json();
    if (!response.ok) {
      return { text: '', raw: data, error: data?.error?.message || '模型调用失败' };
    }

    const choice = data.choices?.[0];
    const message = choice?.message;
    const text = message?.content || '';
    return { text, raw: data, message };
  } catch (error) {
    if (error.name === 'AbortError') {
      return { text: '', raw: null, error: '模型调用超时' };
    }
    return { text: '', raw: null, error: '模型调用失败' };
  } finally {
    clearTimeout(timer);
  }
}

async function mcpRequest(server, method, params) {
  const payload = {
    jsonrpc: '2.0',
    id: generateId('mcp'),
    method,
    params,
  };

  const response = await fetch(server.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(server.headers || {}),
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (data.error) {
    throw new Error(data.error.message || 'MCP 调用失败');
  }
  return data.result;
}

async function listMcpTools(serverId) {
  const server = mcpServers[serverId];
  if (!server) {
    throw new Error('MCP 服务器不存在');
  }
  const result = await mcpRequest(server, 'tools/list');
  return result.tools || [];
}

async function callMcpTool(serverId, name, args) {
  const server = mcpServers[serverId];
  if (!server) {
    throw new Error('MCP 服务器不存在');
  }
  return mcpRequest(server, 'tools/call', { name, arguments: args || {} });
}

const skills = {
  get_time: {
    name: 'get_time',
    description: '获取服务器当前时间',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => ({ now: new Date().toISOString() }),
  },
  list_notes: {
    name: 'list_notes',
    description: '列出最新便笺',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => ({ notes }),
  },
  add_note: {
    name: 'add_note',
    description: '新增一条便笺',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '便笺内容' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    handler: async ({ text }) => {
      const result = createNote(text);
      if (!result.ok) {
        throw new Error(result.error);
      }
      await saveNotes();
      return { note: result.note };
    },
  },
  run_cli: {
    name: 'run_cli',
    description: '在服务器上执行命令（本地模式）',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的命令' },
      },
      required: ['command'],
      additionalProperties: false,
    },
    handler: async ({ command }) => {
      const result = await runCliCommand(command);
      if (!result.ok) {
        throw new Error(result.error);
      }
      return result.result;
    },
  },
  mcp_list_tools: {
    name: 'mcp_list_tools',
    description: '列出指定 MCP 服务器的工具',
    parameters: {
      type: 'object',
      properties: {
        serverId: { type: 'string', description: 'MCP 服务器 ID' },
      },
      required: ['serverId'],
      additionalProperties: false,
    },
    handler: async ({ serverId }) => ({ tools: await listMcpTools(serverId) }),
  },
  mcp_call_tool: {
    name: 'mcp_call_tool',
    description: '调用 MCP 服务器工具',
    parameters: {
      type: 'object',
      properties: {
        serverId: { type: 'string', description: 'MCP 服务器 ID' },
        name: { type: 'string', description: '工具名称' },
        arguments: { type: 'object', description: '工具参数' },
      },
      required: ['serverId', 'name'],
      additionalProperties: false,
    },
    handler: async ({ serverId, name, arguments: args }) => ({
      result: await callMcpTool(serverId, name, args || {}),
    }),
  },
};

function listSkills() {
  return Object.values(skills).map((skill) => ({
    name: skill.name,
    description: skill.description,
    parameters: skill.parameters,
  }));
}

async function runSkill(name, args) {
  const skill = skills[name];
  if (!skill) {
    return { ok: false, error: '技能不存在' };
  }
  try {
    const result = await skill.handler(args || {});
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: error.message || '技能执行失败' };
  }
}

function buildToolDefinitions() {
  return Object.values(skills).map((skill) => ({
    type: 'function',
    function: {
      name: skill.name,
      description: skill.description,
      parameters: skill.parameters,
    },
  }));
}

async function runToolCalls(toolCalls) {
  const toolMessages = [];
  for (const call of toolCalls) {
    const name = call.function?.name;
    let args = {};
    try {
      args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
    } catch (error) {
      args = {};
    }
    const result = await runSkill(name, args);
    toolMessages.push({
      role: 'tool',
      tool_call_id: call.id,
      content: JSON.stringify(result.ok ? result.result : { error: result.error }),
    });
  }
  return toolMessages;
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
      const command = typeof payload.command === 'string' ? payload.command.trim() : '';

      let commandToRun = command;
      if (!commandToRun && commandId) {
        const preset = cliCommands[commandId];
        commandToRun = preset?.command || '';
      }

      if (!commandToRun) {
        return sendJson(res, 400, { ok: false, error: '命令不能为空' });
      }

      const result = await runCliCommand(commandToRun);
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

  if (pathname === '/api/llm/status' && req.method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      openaiConfigured: Boolean(OPENAI_API_KEY),
      model: OPENAI_MODEL,
      baseUrl: OPENAI_BASE_URL,
      sessionCount: llmSessionOrder.length,
    });
  }

  if (pathname === '/api/llm/skills' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, skills: listSkills() });
  }

  if (pathname === '/api/llm/skills/run' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req, 64 * 1024);
      const name = typeof payload.name === 'string' ? payload.name.trim() : '';
      if (!name) {
        return sendJson(res, 400, { ok: false, error: '技能名称不能为空' });
      }
      const result = await runSkill(name, payload.args || {});
      if (!result.ok) {
        return sendJson(res, 400, { ok: false, error: result.error });
      }
      return sendJson(res, 200, { ok: true, result: result.result });
    } catch (error) {
      return sendJson(res, 500, { ok: false, error: '服务器错误' });
    }
  }

  if (pathname === '/api/llm/sessions' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, sessions: listSessions() });
  }

  if (pathname === '/api/llm/sessions' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req, 32 * 1024);
      const session = createSession({
        title: payload.title,
        systemPrompt: payload.systemPrompt,
      });
      return sendJson(res, 201, { ok: true, session });
    } catch (error) {
      return sendJson(res, 500, { ok: false, error: '服务器错误' });
    }
  }

  const sessionMatch = pathname.match(/^\/api\/llm\/sessions\/([^/]+)$/);
  if (sessionMatch) {
    const sessionId = sessionMatch[1];
    const session = getSession(sessionId);
    if (!session) {
      return sendJson(res, 404, { ok: false, error: '会话不存在' });
    }

    if (req.method === 'GET') {
      return sendJson(res, 200, { ok: true, session });
    }

    if (req.method === 'DELETE') {
      delete llmSessions[sessionId];
      llmSessionOrder = llmSessionOrder.filter((id) => id !== sessionId);
      await saveLlmSessions();
      return sendJson(res, 200, { ok: true });
    }
  }

  const sessionMessagesMatch = pathname.match(/^\/api\/llm\/sessions\/([^/]+)\/messages$/);
  if (sessionMessagesMatch && req.method === 'POST') {
    try {
      const sessionId = sessionMessagesMatch[1];
      const session = getSession(sessionId);
      if (!session) {
        return sendJson(res, 404, { ok: false, error: '会话不存在' });
      }
      const payload = await readJsonBody(req, 64 * 1024);
      const role = payload.role;
      const content = typeof payload.content === 'string' ? payload.content.trim() : '';
      if (!content || !['user', 'assistant', 'tool'].includes(role)) {
        return sendJson(res, 400, { ok: false, error: '消息内容或角色无效' });
      }
      addMessage(session, {
        role,
        content,
        toolCallId: payload.toolCallId || null,
      });
      await updateSession(session);
      return sendJson(res, 200, { ok: true, session });
    } catch (error) {
      return sendJson(res, 500, { ok: false, error: '服务器错误' });
    }
  }

  if (pathname === '/api/llm/chat' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req, 256 * 1024);
      const message = typeof payload.message === 'string' ? payload.message.trim() : '';
      if (!message) {
        return sendJson(res, 400, { ok: false, error: 'message 不能为空' });
      }

      let session = payload.sessionId ? getSession(payload.sessionId) : null;
      if (!session) {
        session = createSession({
          title: payload.title,
          systemPrompt: payload.systemPrompt,
        });
      }

      addMessage(session, { role: 'user', content: message });
      await compactSession(session);

      const tools = payload.enableTools === false ? [] : buildToolDefinitions();
      let messages = buildChatMessages(session);
      let assistantContent = '';
      let toolCalls = null;
      let rawResponse = null;
      let assistantAdded = false;

      if (!OPENAI_API_KEY) {
        assistantContent = '未配置 OPENAI_API_KEY，本地模式仅记录消息。';
      } else {
        let loopCount = 0;
        while (loopCount <= LLM_MAX_TOOL_LOOPS) {
          const result = await callOpenAIChat({
            messages,
            tools,
            model: payload.model,
            temperature: payload.temperature,
            maxTokens: payload.maxTokens,
          });

          if (result.error) {
            assistantContent = `模型调用失败：${result.error}`;
            break;
          }

          rawResponse = result.raw;
          const messageObj = result.message || {};
          assistantContent = messageObj.content || '';
          toolCalls = messageObj.tool_calls || null;

          addMessage(session, {
            role: 'assistant',
            content: assistantContent,
            toolCalls,
          });
          assistantAdded = true;

          if (!toolCalls || toolCalls.length === 0) {
            break;
          }

          const toolMessages = await runToolCalls(toolCalls);
          toolMessages.forEach((toolMsg) => {
            addMessage(session, {
              role: 'tool',
              content: toolMsg.content,
              toolCallId: toolMsg.tool_call_id,
            });
          });

          messages = messages.concat(messageObj, toolMessages);
          loopCount += 1;
        }
      }

      if (!assistantContent) {
        assistantContent = '模型未返回内容。';
      }

      if (!assistantAdded) {
        addMessage(session, { role: 'assistant', content: assistantContent });
        assistantAdded = true;
      }

      await updateSession(session);
      return sendJson(res, 200, {
        ok: true,
        sessionId: session.id,
        assistant: {
          content: assistantContent,
          toolCalls,
        },
        raw: payload.includeRaw ? rawResponse : undefined,
      });
    } catch (error) {
      return sendJson(res, 500, { ok: false, error: '服务器错误' });
    }
  }

  if (pathname === '/api/mcp/servers' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, servers: Object.values(mcpServers) });
  }

  if (pathname === '/api/mcp/servers' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req, 32 * 1024);
      const url = typeof payload.url === 'string' ? payload.url.trim() : '';
      if (!url) {
        return sendJson(res, 400, { ok: false, error: 'url 不能为空' });
      }
      const id = payload.id ? String(payload.id) : generateId('mcp');
      mcpServers[id] = {
        id,
        name: payload.name || id,
        url,
        headers: payload.headers || {},
        createdAt: new Date().toISOString(),
      };
      await saveMcpServers();
      return sendJson(res, 201, { ok: true, server: mcpServers[id] });
    } catch (error) {
      return sendJson(res, 500, { ok: false, error: '服务器错误' });
    }
  }

  const mcpServerMatch = pathname.match(/^\/api\/mcp\/servers\/([^/]+)$/);
  if (mcpServerMatch && req.method === 'DELETE') {
    const serverId = mcpServerMatch[1];
    if (!mcpServers[serverId]) {
      return sendJson(res, 404, { ok: false, error: 'MCP 服务器不存在' });
    }
    delete mcpServers[serverId];
    await saveMcpServers();
    return sendJson(res, 200, { ok: true });
  }

  const mcpToolsMatch = pathname.match(/^\/api\/mcp\/servers\/([^/]+)\/tools$/);
  if (mcpToolsMatch && req.method === 'GET') {
    try {
      const serverId = mcpToolsMatch[1];
      const tools = await listMcpTools(serverId);
      return sendJson(res, 200, { ok: true, tools });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  const mcpCallMatch = pathname.match(/^\/api\/mcp\/servers\/([^/]+)\/call$/);
  if (mcpCallMatch && req.method === 'POST') {
    try {
      const serverId = mcpCallMatch[1];
      const payload = await readJsonBody(req, 64 * 1024);
      const name = typeof payload.name === 'string' ? payload.name.trim() : '';
      if (!name) {
        return sendJson(res, 400, { ok: false, error: '工具名称不能为空' });
      }
      const result = await callMcpTool(serverId, name, payload.arguments || {});
      return sendJson(res, 200, { ok: true, result });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  if (pathname === '/api/notes') {
    if (req.method === 'GET') {
      return sendJson(res, 200, { ok: true, notes });
    }

    if (req.method === 'POST') {
      try {
        const payload = await readJsonBody(req);
        const result = createNote(payload.text);
        if (!result.ok) {
          return sendJson(res, 400, { ok: false, error: result.error });
        }

        await saveNotes();
        return sendJson(res, 201, { ok: true, note: result.note });
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
