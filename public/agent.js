const goalInput = document.querySelector('[data-agent-goal]');
const generateBtn = document.querySelector('[data-agent-generate]');
const planList = document.querySelector('[data-agent-plan]');
const outputEl = document.querySelector('[data-agent-output]');
const chips = document.querySelectorAll('[data-agent-chip]');
const statusEl = document.querySelector('[data-agent-status]');
const timeEl = document.querySelector('[data-agent-time]');
const syncBtn = document.querySelector('[data-agent-sync]');

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

refreshStatus();
