/**
 * 财报精灵 — Pipeline 引擎
 * 
 * 核心逻辑：把 7 个财务 AI Agent 的 System Prompt 按顺序串起来，
 * 依次调用 DeepSeek API，前一步输出 → 下一步输入。
 * 
 * 完全不依赖 EasyClaw，纯 Node.js + HTTP。
 * 架构与「法典」一致，仅 Agent 定义和 Pipeline 不同。
 */
const fs = require('fs');
const path = require('path');

// ── 配置 ──
const AGENTS_DIR = path.join(__dirname, 'agents');
const KEY_FILE = path.join(require('os').homedir(), '.finance-elf-api-key');

const DEEPSEEK_API = 'https://api.deepseek.com/chat/completions';
const MODEL = 'deepseek-chat';

// ── API Key 管理 ──
function saveApiKey(key) {
  fs.writeFileSync(KEY_FILE, key.trim(), 'utf-8');
}

function getApiKey() {
  try {
    return fs.readFileSync(KEY_FILE, 'utf-8').trim();
  } catch {
    return null;
  }
}

// ── 读取 Agent System Prompt ──
function loadAgentPrompt(agentId) {
  const soulPath = path.join(AGENTS_DIR, agentId, 'SOUL.md');
  const agentPath = path.join(AGENTS_DIR, agentId, 'AGENTS.md');

  let prompt = '';

  if (fs.existsSync(soulPath)) {
    prompt += fs.readFileSync(soulPath, 'utf-8').trim();
  }

  if (fs.existsSync(agentPath)) {
    const agents = fs.readFileSync(agentPath, 'utf-8').trim();
    if (agents) {
      prompt += '\n\n## 行为准则\n' + agents;
    }
  }

  return prompt;
}

// ── 调用 DeepSeek API ──
async function callLLM(systemPrompt, userMessage, onChunk) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('API Key 未配置，请在设置中填入 DeepSeek API Key');
  }

  const body = JSON.stringify({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    temperature: 0.3,
    max_tokens: 8192,
    stream: !!onChunk
  });

  if (!onChunk) {
    const res = await fetch(DEEPSEEK_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`API 调用失败 (${res.status}): ${err}`);
    }

    const data = await res.json();
    return data.choices[0].message.content;
  }

  // 流式
  const response = await fetch(DEEPSEEK_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API 调用失败 (${response.status}): ${err}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content || '';
        if (content) {
          fullContent += content;
          if (onChunk) onChunk(content);
        }
      } catch { /* 跳过解析错误的行 */ }
    }
  }

  return fullContent;
}

// ── Pipeline 阶段定义 ──
const PIPELINES = {
  // 快速概览：解读官 → 风险预警员
  quick_overview: {
    name: '快速概览',
    steps: [
      { id: 'interpreter', name: '财报解读官', emoji: '🔍', desc: '通读三张表，提取关键数据' },
      { id: 'risk-watcher', name: '风险预警员', emoji: '🔴', desc: '标注核心风险点' }
    ]
  },

  // 标准分析：解读官 → 研究员 → 比率分析师 → 审计顾问
  standard_analysis: {
    name: '标准分析',
    steps: [
      { id: 'interpreter', name: '财报解读官', emoji: '🔍', desc: '通读三张表，拆结构、标异常' },
      { id: 'researcher', name: '准则研究员', emoji: '📚', desc: '检索会计准则，判断会计政策合理性' },
      { id: 'analyst', name: '比率分析师', emoji: '⚖️', desc: '四维指标计算与杜邦分析' },
      { id: 'auditor', name: '审计顾问', emoji: '📋', desc: '终审验收，输出完整报告' }
    ]
  },

  // 深度诊断：解读官 → 研究员 → 比率分析师 → 风险预警员 → 报告起草员 → 审计顾问
  deep_diagnosis: {
    name: '深度诊断',
    steps: [
      { id: 'interpreter', name: '财报解读官', emoji: '🔍', desc: '通读三张表，逐项分析' },
      { id: 'researcher', name: '准则研究员', emoji: '📚', desc: '对标会计准则，评估会计政策' },
      { id: 'analyst', name: '比率分析师', emoji: '⚖️', desc: '四维指标 + 杜邦拆解 + 趋势分析' },
      { id: 'risk-watcher', name: '风险预警员', emoji: '🔴', desc: '全面风险排查与预警' },
      { id: 'drafter', name: '报告起草员', emoji: '✍️', desc: '撰写结构化深度分析报告' },
      { id: 'auditor', name: '审计顾问', emoji: '📋', desc: '终审验收，出具分析意见' }
    ]
  }
};

// ── 运行 Pipeline ──
async function runPipeline(content, fileName, pipelineType, onProgress) {
  const pipeline = PIPELINES[pipelineType];
  if (!pipeline) {
    throw new Error(`未知的分析模式: ${pipelineType}`);
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('未配置 API Key，请在左侧面板填入 DeepSeek API Key');
  }

  const results = { stages: [], finalReport: '' };
  let previousOutput = '';
  const startTime = Date.now();

  for (let i = 0; i < pipeline.steps.length; i++) {
    const step = pipeline.steps[i];
    const systemPrompt = loadAgentPrompt(step.id);

    if (!systemPrompt) {
      throw new Error(`未找到 Agent "${step.id}" 的配置文件`);
    }

    let userMessage;
    if (i === 0) {
      userMessage = `请对以下财务报表进行分析。\n\n文件名：${fileName}\n\n财务数据：\n\n${content}`;
    } else {
      userMessage = `请基于以下上一阶段的分析产出，进行本阶段的工作。\n\n---\n原文件名：${fileName}\n\n上一阶段产出：\n\n${previousOutput}\n\n---\n\n原始财务数据（备查）：\n\n${content}`;
    }

    if (onProgress) {
      onProgress({
        stage: i,
        stageName: step.name,
        stageEmoji: step.emoji,
        stageDesc: step.desc,
        status: 'running',
        totalStages: pipeline.steps.length
      });
    }

    const output = await callLLM(systemPrompt, userMessage);
    previousOutput = output;

    results.stages.push({
      name: step.name,
      emoji: step.emoji,
      agentId: step.id,
      output
    });

    if (onProgress) {
      onProgress({
        stage: i,
        stageName: step.name,
        stageEmoji: step.emoji,
        stageDesc: step.desc,
        status: 'done',
        totalStages: pipeline.steps.length
      });
    }
  }

  results.finalReport = results.stages[results.stages.length - 1].output;
  results.elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
  results.pipelineName = pipeline.name;

  return results;
}

// ── 列出可用的 Pipelines ──
function listPipelines() {
  return Object.entries(PIPELINES).map(([id, p]) => ({
    id,
    name: p.name,
    steps: p.steps.map(s => ({ name: s.name, emoji: s.emoji }))
  }));
}

// ── 内嵌 HTTP Server（供前端通过 REST API 调用）──
let server = null;
const PORT = 28998;

async function startServer() {
  server = require('http').createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204); res.end(); return;
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (url.pathname === '/api/check-key') {
      const key = getApiKey();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ hasKey: !!key }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/save-key') {
      const body = await readBody(req);
      const { apiKey } = JSON.parse(body);
      saveApiKey(apiKey);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    if (url.pathname === '/api/pipelines') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(listPipelines()));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/run-review') {
      const body = await readBody(req);
      const { content, fileName, pipelineType } = JSON.parse(body);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      const send = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      try {
        const result = await runPipeline(content, fileName, pipelineType, (progress) => {
          send('progress', progress);
        });
        send('done', result);
      } catch (err) {
        send('error', { error: err.message });
      }

      res.end();
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  return new Promise((resolve) => {
    server.listen(PORT, () => {
      console.log(`📊 财报精灵 Pipeline 引擎已启动，端口 ${PORT}`);
      resolve();
    });
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => resolve());
    } else {
      resolve();
    }
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => resolve(data));
  });
}

// ── 导出 ──
module.exports = {
  saveApiKey,
  getApiKey,
  loadAgentPrompt,
  callLLM,
  runPipeline,
  listPipelines,
  startServer,
  stopServer
};
