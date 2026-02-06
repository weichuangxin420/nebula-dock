const goalInput = document.querySelector('[data-agent-goal]');
const generateBtn = document.querySelector('[data-agent-generate]');
const planList = document.querySelector('[data-agent-plan]');
const outputEl = document.querySelector('[data-agent-output]');
const chips = document.querySelectorAll('[data-agent-chip]');
const statusEl = document.querySelector('[data-agent-status]');
const timeEl = document.querySelector('[data-agent-time]');
const syncBtn = document.querySelector('[data-agent-sync]');
const cliSelect = document.querySelector('[data-cli-select]');
const cliRunBtn = document.querySelector('[data-cli-run]');
const cliOutput = document.querySelector('[data-cli-output]');
const cliMeta = document.querySelector('[data-cli-meta]');
const cliInput = document.querySelector('[data-cli-input]');

let cliCommands = [];

const presetCopy = {
  web: '输出一个清晰的页面结构与视觉节奏说明。',
  api: '输出接口列表、参数、错误码和测试方案。',
  default: '输出执行步骤、时间预估与风险点。',
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildPlan(goal) {
  const normalized = goal.toLowerCase();
  if (/(网页|页面|网站|landing|product)/i.test(normalized)) {
    return [
      '梳理页面信息结构与叙事节奏',
      '定义视觉关键词与参考风格',
      '设计关键模块与交互状态',
      '实现页面结构与样式',
      '检查性能、动效与一致性',
    ];
  }

  if (/(api|接口|后端|服务)/i.test(normalized)) {
    return [
      '定义接口契约与字段说明',
      '实现核心逻辑与错误处理',
      '准备联调数据与测试用例',
      '补充文档与监控指标',
    ];
  }

  return [
    '明确目标与完成标准',
    '拆解关键步骤与依赖',
    '排期与资源准备',
    '执行与阶段复盘',
  ];
}

function renderPlan(steps) {
  if (!planList) return;
  planList.innerHTML = steps
    .map(
      (step, index) => `
        <li class="plan-item" data-state="queued">
          <span class="plan-index">${index + 1}</span>
          <span class="plan-text">${escapeHtml(step)}</span>
          <span class="plan-state">Queued</span>
        </li>`
    )
    .join('');
}

function simulateRun() {
  const items = planList ? planList.querySelectorAll('.plan-item') : [];
  items.forEach((item, index) => {
    setTimeout(() => {
      items.forEach((node) => {
        node.dataset.state = 'queued';
        const stateEl = node.querySelector('.plan-state');
        if (stateEl) stateEl.textContent = 'Queued';
      });
      item.dataset.state = 'running';
      const stateEl = item.querySelector('.plan-state');
      if (stateEl) stateEl.textContent = 'Running';

      setTimeout(() => {
        item.dataset.state = 'done';
        if (stateEl) stateEl.textContent = 'Done';
      }, 600);
    }, index * 800);
  });
}

function updateOutput(goal) {
  if (!outputEl) return;
  let hint = presetCopy.default;
  if (/(网页|页面|网站|landing|product)/i.test(goal)) {
    hint = presetCopy.web;
  } else if (/(api|接口|后端|服务)/i.test(goal)) {
    hint = presetCopy.api;
  }

  outputEl.innerHTML = `
    <div class="output-block">
      <h4>目标概述</h4>
      <p>${escapeHtml(goal)}</p>
    </div>
    <div class="output-block">
      <h4>建议输出</h4>
      <p>${escapeHtml(hint)}</p>
    </div>
  `;
}

async function refreshStatus() {
  if (statusEl) statusEl.textContent = '同步中...';
  try {
    const response = await fetch('/api/status');
    const data = await response.json();
    if (statusEl) statusEl.textContent = data.message || '在线';
    if (timeEl) {
      const time = new Date(data.serverTime).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      });
      timeEl.textContent = time;
    }
  } catch (error) {
    if (statusEl) statusEl.textContent = '离线';
  }
}

function renderCliCommands(commands) {
  if (!cliSelect) return;
  if (!commands.length) {
    cliSelect.innerHTML = '<option>暂无可用命令</option>';
    return;
  }

  const options = [
    '<option value="">选择预设命令（可编辑输入框）</option>',
    ...commands.map((command) => {
      const label = command.description
        ? `${command.label} · ${command.description}`
        : command.label;
      const value = command.command || command.id;
      return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
    }),
  ];

  cliSelect.innerHTML = options.join('');
}

function renderCliOutput(result) {
  if (!cliOutput) return;
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const output = [stdout, stderr].filter(Boolean).join('\n') || '无输出。';
  cliOutput.innerHTML = `<pre>${escapeHtml(output)}</pre>`;

  if (cliMeta) {
    const parts = [];
    if (result.label) parts.push(result.label);
    if (!result.label && result.command) parts.push(result.command);
    if (typeof result.exitCode === 'number') parts.push(`exit ${result.exitCode}`);
    if (result.durationMs) parts.push(`${result.durationMs}ms`);
    cliMeta.textContent = parts.join(' · ') || '执行完成';
  }
}

async function loadCliCommands() {
  if (!cliSelect) return;
  cliSelect.innerHTML = '<option>加载中...</option>';
  try {
    const response = await fetch('/api/cli/commands');
    const data = await response.json();
    if (!data.ok) {
      throw new Error(data.error || '加载失败');
    }
    cliCommands = data.commands || [];
    renderCliCommands(cliCommands);
    if (cliInput && cliCommands.length) {
      const first = cliCommands[0];
      if (first?.command) {
        cliInput.value = first.command;
      }
    }
  } catch (error) {
    cliSelect.innerHTML = '<option>命令加载失败</option>';
    if (cliMeta) cliMeta.textContent = '无法获取命令列表';
  }
}

async function runCliCommand() {
  if (!cliOutput) return;
  const command = cliInput ? cliInput.value.trim() : '';
  const fallback = cliSelect ? cliSelect.value : '';
  const commandToRun = command || fallback;
  if (!commandToRun) return;

  if (cliRunBtn) cliRunBtn.disabled = true;
  cliOutput.innerHTML = '<pre>执行中...</pre>';
  if (cliMeta) cliMeta.textContent = '正在执行';

  try {
    const response = await fetch('/api/cli/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: commandToRun }),
    });
    const data = await response.json();
    if (!data.ok) {
      throw new Error(data.error || '执行失败');
    }
    renderCliOutput(data.result || {});
  } catch (error) {
    cliOutput.innerHTML = `<pre>${escapeHtml(error.message || '执行失败')}</pre>`;
    if (cliMeta) cliMeta.textContent = '执行失败';
  } finally {
    if (cliRunBtn) cliRunBtn.disabled = false;
  }
}

function generatePlan() {
  if (!goalInput) return;
  const goal = goalInput.value.trim();
  if (!goal) return;

  const steps = buildPlan(goal);
  renderPlan(steps);
  updateOutput(goal);
  simulateRun();
}

chips.forEach((chip) => {
  chip.addEventListener('click', () => {
    if (goalInput) {
      goalInput.value = chip.dataset.agentChip || '';
      goalInput.focus();
    }
  });
});

if (generateBtn) {
  generateBtn.addEventListener('click', generatePlan);
}

if (goalInput) {
  goalInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      generatePlan();
    }
  });
}

if (syncBtn) {
  syncBtn.addEventListener('click', refreshStatus);
}

if (cliRunBtn) {
  cliRunBtn.addEventListener('click', runCliCommand);
}

if (cliSelect && cliInput) {
  cliSelect.addEventListener('change', () => {
    const value = cliSelect.value;
    if (value) {
      cliInput.value = value;
    }
  });
}

refreshStatus();
loadCliCommands();
