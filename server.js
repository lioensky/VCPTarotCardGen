#!/usr/bin/env node
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3107);
const THEMES_DIR = path.join(ROOT, 'tarotcardsthemes');
const DEFAULT_CARDS_DIR = path.join(THEMES_DIR, 'defaulttarotcards');
const TEMPLATE_THEME = path.join(ROOT, 'templates', 'default-theme.json');
const PUBLIC_DIR = path.join(ROOT, 'public');
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

// 生图引擎注册表
const PROVIDERS = {
  gptimage: { id: 'gptimage', name: 'GPT Image (gpt-image-2)', script: 'GPTImageGen.js', scope: 'gptimage' },
  doubao: { id: 'doubao', name: '豆包 Seedream (火山方舟)', script: 'DoubaoGen.js', scope: 'doubao' }
};

// Seedream 对最小像素数有要求，512x1024 等小尺寸会被拒绝，这里映射为同为 1:2 的合规尺寸
// 可在 config.env 中通过 DOUBAO_SIZE_1K / DOUBAO_SIZE_2K 覆盖（支持 1K/2K/4K 或 WxH）
const DOUBAO_SIZE_MAP = {
  '512x1024': '1440x2880',
  '1024x2048': '2048x4096'
};

function log(scope, message, meta = {}) {
  const time = new Date().toISOString();
  const metaText = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  console.log(`[${time}] [${scope}] ${message}${metaText}`);
}

function maskSecret(value) {
  if (!value) return '';
  const text = String(value);
  if (text.length <= 8) return '***';
  return `${text.slice(0, 4)}***${text.slice(-4)}`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function loadEnvFile() {
  const envPath = path.join(ROOT, 'config.env');
  const env = {};
  if (!fs.existsSync(envPath)) return env;
  for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return env;
}

function send(res, status, data, headers = {}) {
  const body = Buffer.isBuffer(data) ? data : JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': Buffer.isBuffer(data) ? 'application/octet-stream' : 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...headers
  });
  res.end(body);
}

function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(text);
}

function safeId(value) {
  return String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function assertSafeThemeId(themeId) {
  const id = safeId(themeId);
  if (!id || id !== themeId) throw new Error('非法 themeId');
  return id;
}

function themePath(themeId) {
  return path.join(THEMES_DIR, assertSafeThemeId(themeId));
}

function cardFileStem(cardId, orientation = 'upright') {
  return orientation === 'reversed' ? `逆位${cardId}` : cardId;
}

function mimeOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.html') return 'text/html; charset=utf-8';
  return 'application/octet-stream';
}

function getCanonicalCards() {
  const majors = ['0-愚人', '1-魔术师', '2-女祭祀', '3-皇后', '4-皇帝', '5-教皇', '6-恋人', '7-战车', '8-力量', '9-隐士', '10-命运之轮', '11-正义', '12-吊人', '13-死神', '14-节制', '15-恶魔', '16-高塔', '17-星星', '18-月亮', '19-太阳', '20-审判', '21-世界'];
  const suits = ['权杖', '圣杯', '宝剑', '星币'];
  const ranks = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '侍从', '骑士', '皇后', '国王'];
  const cards = majors.map((name) => ({ id: name, name, arcana: 'major' }));
  for (const suit of suits) {
    for (const rank of ranks) cards.push({ id: `${suit}${rank}`, name: `${suit}${rank}`, arcana: 'minor', suit, rank });
  }
  cards.push({ id: '牌背', name: '牌背', arcana: 'back' });
  return cards;
}

function listDefaultCards() {
  if (!fs.existsSync(DEFAULT_CARDS_DIR)) return [];
  return fs.readdirSync(DEFAULT_CARDS_DIR)
    .filter((file) => IMAGE_EXTS.has(path.extname(file).toLowerCase()))
    .filter((file) => !/^Thumbs\.db$/i.test(file))
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function normalizeTheme(theme, fallbackId) {
  const cards = getCanonicalCards();
  theme.schemaVersion ||= 1;
  theme.id ||= fallbackId;
  theme.name ||= fallbackId;
  theme.resolution ||= { label: '1k', size: '512x1024', prompt: '竖版塔罗牌构图，输出比例 1:2，建议分辨率 512x1024。' };
  theme.prompts ||= {};
  theme.prompts.frameImageGuide ||= '';
  theme.prompts.theme ||= '';
  theme.prompts.innerStyle ||= '';
  theme.prompts.negative ||= '';
  theme.assets ||= { frameExample: 'frame-example.png' };
  theme.cards ||= {};
  for (const card of cards) {
    theme.cards[card.id] ||= { upright: '', reversed: card.id === '牌背' ? '' : '' };
    theme.cards[card.id].upright ||= '';
    theme.cards[card.id].reversed ||= '';
  }
  return theme;
}

function loadTheme(themeId) {
  const dir = themePath(themeId);
  const file = path.join(dir, 'theme.json');
  if (!fs.existsSync(file)) throw new Error(`主题不存在: ${themeId}`);
  return normalizeTheme(readJson(file), themeId);
}

function saveTheme(themeId, theme) {
  const dir = themePath(themeId);
  ensureDir(dir);
  theme.id = themeId;
  writeJson(path.join(dir, 'theme.json'), normalizeTheme(theme, themeId));
}

function createTheme(name, sourceThemeId = '') {
  const id = safeId(name);
  if (!id) throw new Error('主题名称不能为空');
  const dir = themePath(id);
  if (fs.existsSync(dir)) throw new Error(`主题已存在: ${id}`);
  log('theme', '创建主题', { id, name, sourceThemeId: sourceThemeId || 'template' });
  ensureDir(dir);
  ensureDir(path.join(dir, 'cards'));
  ensureDir(path.join(dir, 'backup'));
  const sourceFile = sourceThemeId ? path.join(themePath(sourceThemeId), 'theme.json') : TEMPLATE_THEME;
  const theme = normalizeTheme(readJson(sourceFile), id);
  theme.id = id;
  theme.name = name;
  writeJson(path.join(dir, 'theme.json'), theme);
  const sourceFrame = sourceThemeId ? path.join(themePath(sourceThemeId), theme.assets.frameExample || 'frame-example.png') : '';
  if (sourceFrame && fs.existsSync(sourceFrame)) fs.copyFileSync(sourceFrame, path.join(dir, theme.assets.frameExample || 'frame-example.png'));
  return getThemeState(id);
}

function findCardImage(themeId, cardId, orientation = 'upright') {
  const cardsDir = path.join(themePath(themeId), 'cards');
  const stem = cardFileStem(cardId, orientation);
  for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
    const file = path.join(cardsDir, `${stem}${ext}`);
    if (fs.existsSync(file)) return file;
  }
  return '';
}

function listBackups(themeId, cardId, orientation = 'upright') {
  const backupDir = path.join(themePath(themeId), 'backup');
  if (!fs.existsSync(backupDir)) return [];
  const stem = cardFileStem(cardId, orientation);
  return fs.readdirSync(backupDir)
    .filter((file) => file.startsWith(`${stem}.`) || file.startsWith(`${stem}-`))
    .filter((file) => IMAGE_EXTS.has(path.extname(file).toLowerCase()))
    .sort()
    .reverse()
    .map((file) => ({ file, url: `/api/themes/${encodeURIComponent(themeId)}/backup/${encodeURIComponent(file)}` }));
}

function getThemeState(themeId) {
  const theme = loadTheme(themeId);
  const dir = themePath(themeId);
  const frame = path.join(dir, theme.assets.frameExample || 'frame-example.png');
  const cards = getCanonicalCards().map((card) => {
    const upright = findCardImage(themeId, card.id, 'upright');
    const reversed = card.id === '牌背' ? '' : findCardImage(themeId, card.id, 'reversed');
    return {
      ...card,
      prompts: theme.cards[card.id] || { upright: '', reversed: '' },
      images: {
        upright: upright ? `/api/themes/${encodeURIComponent(themeId)}/cards/${encodeURIComponent(path.basename(upright))}` : '',
        reversed: reversed ? `/api/themes/${encodeURIComponent(themeId)}/cards/${encodeURIComponent(path.basename(reversed))}` : ''
      },
      backups: {
        upright: listBackups(themeId, card.id, 'upright'),
        reversed: card.id === '牌背' ? [] : listBackups(themeId, card.id, 'reversed')
      }
    };
  });
  return {
    theme,
    frameExampleExists: fs.existsSync(frame),
    frameExampleUrl: fs.existsSync(frame) ? `/api/themes/${encodeURIComponent(themeId)}/frame` : '',
    cards
  };
}

function listThemes() {
  ensureDir(THEMES_DIR);
  return fs.readdirSync(THEMES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(THEMES_DIR, entry.name, 'theme.json')))
    .map((entry) => {
      const theme = loadTheme(entry.name);
      return { id: theme.id, name: theme.name, description: theme.description || '' };
    });
}

function assemblePrompt(theme, cardId, orientation = 'upright', includeResolution = true) {
  const chunks = [
    theme.prompts.frameImageGuide,
    theme.prompts.theme,
    theme.prompts.innerStyle,
    includeResolution ? theme.resolution?.prompt : '',
    theme.cards?.[cardId]?.[orientation],
    theme.prompts.negative ? `负面约束：${theme.prompts.negative}` : ''
  ];
  return chunks.filter(Boolean).join('\n\n');
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function backupExisting(themeId, cardId, orientation) {
  const existing = findCardImage(themeId, cardId, orientation);
  if (!existing) return '';
  const backupDir = path.join(themePath(themeId), 'backup');
  ensureDir(backupDir);
  const stem = cardFileStem(cardId, orientation);
  const dest = path.join(backupDir, `${stem}-${timestamp()}${path.extname(existing)}`);
  fs.renameSync(existing, dest);
  log('backup', '已备份旧卡牌', {
    themeId,
    cardId,
    orientation,
    from: path.relative(ROOT, existing),
    to: path.relative(ROOT, dest)
  });
  return dest;
}

function isConfiguredValue(value) {
  const text = String(value || '').trim();
  return Boolean(text) && !/your[_-]?api[_-]?key|sk-your-api-key-here/i.test(text);
}

function getDefaultProviderId() {
  const env = { ...process.env, ...loadEnvFile() };
  const id = String(env.IMAGE_PROVIDER || 'gptimage').trim().toLowerCase();
  return PROVIDERS[id] ? id : 'gptimage';
}

function listProviders() {
  const env = { ...process.env, ...loadEnvFile() };
  return {
    defaultProvider: getDefaultProviderId(),
    providers: [
      { id: 'gptimage', name: PROVIDERS.gptimage.name, configured: isConfiguredValue(env.OPENAI_API_KEY) },
      { id: 'doubao', name: PROVIDERS.doubao.name, configured: isConfiguredValue(env.VOLCENGINE_API_KEY) }
    ]
  };
}

function resolveProvider(value) {
  const id = String(value || getDefaultProviderId()).trim().toLowerCase();
  if (!PROVIDERS[id]) throw new Error(`未知的生图引擎: ${id}`);
  return PROVIDERS[id];
}

function doubaoSize(size) {
  const env = { ...process.env, ...loadEnvFile() };
  const key = size === '1024x2048' ? 'DOUBAO_SIZE_2K' : 'DOUBAO_SIZE_1K';
  return env[key] || DOUBAO_SIZE_MAP[size] || size;
}

function fileToDataUri(file) {
  const buffer = fs.readFileSync(file);
  return `data:${mimeOf(file)};base64,${buffer.toString('base64')}`;
}

/**
 * 按引擎构建子进程入参
 * - GPTImageGen：本地路径直接传，size/quality/response_format
 * - DoubaoGen：只认 data:/http(s)/file:// 图片，统一转 data URI；尺寸用 resolution 并做合规映射
 */
function buildPluginArgs(provider, { command, prompt, image, size }) {
  if (provider.id === 'doubao') {
    const args = {
      command,
      prompt,
      resolution: doubaoSize(size),
      output_format: 'png',
      watermark: false,
      showbase64: false
    };
    if (image) args.image = fileToDataUri(image);
    return args;
  }
  const args = { command, prompt, size, quality: 'auto', response_format: 'b64_json' };
  if (image) args.image = image;
  return args;
}

function describeProvider(provider, env) {
  if (provider.id === 'doubao') {
    return {
      model: env.SEEDREAM_MODEL_ID || '(DoubaoGen 默认)',
      apiUrl: env.VOLCENGINE_API_URL || '(默认方舟端点)',
      apiKey: maskSecret(String(env.VOLCENGINE_API_KEY || '').split(',')[0].trim())
    };
  }
  return {
    model: env.GPT_IMAGE_MODEL || 'gpt-image-2',
    baseUrl: env.OPENAI_BASE_URL || '',
    apiKey: maskSecret(env.OPENAI_API_KEY)
  };
}

function runImagePlugin(provider, args, context = {}) {
  return new Promise((resolve, reject) => {
    const envFile = loadEnvFile();
    const env = { ...process.env, ...envFile, PROJECT_BASE_PATH: ROOT };
    const startedAt = Date.now();
    const scope = provider.scope;
    const imageDesc = !args.image
      ? ''
      : (String(args.image).startsWith('data:') ? `data-uri(${args.image.length} chars)` : path.relative(ROOT, args.image));
    const safeArgs = {
      command: args.command,
      size: args.size || args.resolution,
      quality: args.quality,
      response_format: args.response_format,
      image: imageDesc,
      promptLength: args.prompt?.length || 0,
      promptPreview: args.prompt ? `${args.prompt.slice(0, 160)}${args.prompt.length > 160 ? '...' : ''}` : ''
    };

    log(scope, `开始调用 ${provider.script}`, {
      ...context,
      provider: provider.id,
      ...describeProvider(provider, env),
      args: safeArgs
    });

    const child = spawn(process.execPath, [path.join(ROOT, provider.script)], { cwd: ROOT, env, stdio: ['pipe', 'pipe', 'pipe'] });
    if (context.queueJob) context.queueJob.activeChild = child;
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      text.split(/\r?\n/).filter(Boolean).forEach((line) => log(`${scope}:stderr`, line));
    });
    child.on('error', (error) => {
      log(scope, '子进程启动失败', { ...context, error: error.message });
      reject(error);
    });
    child.on('close', (code) => {
      const durationMs = Date.now() - startedAt;
      try {
        const parsed = JSON.parse(stdout.trim());
        if (parsed.status !== 'success') {
          const errorMessage = parsed.error || stderr || `${provider.script} 调用失败`;
          log(scope, '调用失败', { ...context, code, durationMs, error: errorMessage });
          reject(new Error(errorMessage));
        } else {
          const details = parsed.result?.details || {};
          log(scope, '调用成功', {
            ...context,
            code,
            durationMs,
            serverPath: details.serverPath,
            fileName: details.fileName,
            imageCount: details.image_count
          });
          resolve(parsed);
        }
      } catch (error) {
        log(scope, '输出解析失败', {
          ...context,
          code,
          durationMs,
          error: error.message,
          stdoutPreview: stdout.slice(0, 300),
          stderrPreview: stderr.slice(0, 300)
        });
        reject(new Error(`${provider.script} 输出解析失败: ${error.message}\n${stdout.slice(0, 1000)}\n${stderr.slice(0, 1000)}`));
      }
    });
    child.stdin.end(JSON.stringify(args));
  });
}

const generationJobs = new Map();

function getQueueJob(jobId) {
  const job = generationJobs.get(jobId);
  if (!job) throw new Error(`生成队列不存在: ${jobId}`);
  return job;
}

function serializeQueueJob(job) {
  return {
    id: job.id,
    themeId: job.themeId,
    provider: job.provider,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
    cancelRequested: job.cancelRequested,
    total: job.items.length,
    completed: job.items.filter((item) => item.status === 'success').length,
    skipped: job.items.filter((item) => item.status === 'skipped').length,
    failed: job.items.filter((item) => item.status === 'failed').length,
    canceled: job.items.filter((item) => item.status === 'canceled').length,
    current: job.items.find((item) => item.status === 'running')?.label || null,
    items: job.items.map(({ cardId, orientation, label, status, error, image }) => ({
      cardId, orientation, label, status, error: error || '', image: image || ''
    }))
  };
}

function findBlankGenerationItems(themeId) {
  const state = getThemeState(themeId);
  const items = [];
  for (const card of state.cards) {
    for (const orientation of ['upright', 'reversed']) {
      if (card.id === '牌背' && orientation === 'reversed') continue;
      if (!card.images?.[orientation]) {
        items.push({
          cardId: card.id,
          orientation,
          label: `${card.name} / ${orientation === 'reversed' ? '逆位' : '正位'}`,
          status: 'queued'
        });
      }
    }
  }
  return items;
}

async function processGenerationQueue(job) {
  job.status = 'running';
  job.startedAt = new Date().toISOString();

  for (const item of job.items) {
    if (job.cancelRequested) {
      item.status = 'canceled';
      item.error = '已中止';
      continue;
    }

    // 队列创建后如果该卡牌已被手动生成或被其他任务生成，则跳过，避免重复覆盖。
    if (findCardImage(job.themeId, item.cardId, item.orientation)) {
      item.status = 'skipped';
      item.error = '已有图片，已跳过';
      continue;
    }

    item.status = 'running';
    try {
      const result = await generateCard(job.themeId, item.cardId, item.orientation, false, job.provider, job);
      item.status = 'success';
      item.image = result.image;
    } catch (error) {
      item.status = job.cancelRequested ? 'canceled' : 'failed';
      item.error = job.cancelRequested ? '已中止' : error.message;
      if (!job.cancelRequested) log('queue', '队列项目失败', {
        jobId: job.id, themeId: job.themeId, cardId: item.cardId,
        orientation: item.orientation, error: error.message
      });
    } finally {
      job.activeChild = null;
    }
  }

  if (job.cancelRequested) {
    for (const item of job.items) {
      if (item.status === 'queued' || item.status === 'running') {
        item.status = 'canceled';
        item.error = '已中止';
      }
    }
    job.status = 'canceled';
  } else {
    job.status = job.items.some((item) => item.status === 'failed') ? 'completed_with_errors' : 'completed';
  }
  job.finishedAt = new Date().toISOString();
  job.activeChild = null;
}

function startGenerationQueue(themeId, providerId = '') {
  const provider = resolveProvider(providerId);
  const items = findBlankGenerationItems(themeId);
  if (!items.length) throw new Error('当前主题没有空白卡牌，无需批量生成');

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job = {
    id,
    themeId,
    provider: provider.id,
    items,
    status: 'queued',
    createdAt: new Date().toISOString(),
    cancelRequested: false,
    activeChild: null
  };
  generationJobs.set(id, job);
  processGenerationQueue(job).catch((error) => {
    job.status = 'failed';
    job.finishedAt = new Date().toISOString();
    log('queue', '队列异常终止', { jobId: id, error: error.message });
  });
  return serializeQueueJob(job);
}

function cancelGenerationQueue(jobId) {
  const job = getQueueJob(jobId);
  if (['completed', 'completed_with_errors', 'canceled', 'failed'].includes(job.status)) {
    return serializeQueueJob(job);
  }
  job.cancelRequested = true;
  if (job.activeChild) {
    try {
      job.activeChild.kill();
    } catch (error) {
      log('queue', '终止当前生成进程失败', { jobId, error: error.message });
    }
  }
  return serializeQueueJob(job);
}

function copyGeneratedToTheme(result, themeId, targetName) {
  const details = result.result?.details || {};
  const serverPath = Array.isArray(details.serverPath) ? details.serverPath[0] : details.serverPath;
  if (!serverPath) throw new Error('生成结果缺少 serverPath');
  const source = path.join(ROOT, serverPath);
  if (!fs.existsSync(source)) throw new Error(`生成图片不存在: ${serverPath}`);
  const ext = path.extname(source) || '.png';
  const cardsDir = path.join(themePath(themeId), 'cards');
  ensureDir(cardsDir);
  const dest = path.join(cardsDir, `${targetName}${ext}`);
  fs.copyFileSync(source, dest);
  log('file', '生成图已复制到主题目录', {
    themeId,
    source: path.relative(ROOT, source),
    dest: path.relative(ROOT, dest)
  });
  return dest;
}

async function generateCard(themeId, cardId, orientation = 'upright', forceResolution = false, providerId = '', queueJob = null) {
  const provider = resolveProvider(providerId);
  const theme = loadTheme(themeId);
  const frame = path.join(themePath(themeId), theme.assets.frameExample || 'frame-example.png');
  if (!fs.existsSync(frame)) throw new Error('缺少卡牌框示例图，请先上传或生成 frame-example.png');

  log('generate-card', '收到卡牌生成请求', {
    themeId,
    cardId,
    orientation,
    forceResolution,
    provider: provider.id,
    size: theme.resolution?.size || '512x1024',
    frame: path.relative(ROOT, frame)
  });

  const prompt = assemblePrompt(theme, cardId, orientation, forceResolution);
  log('generate-card', '已组装提示词', {
    themeId,
    cardId,
    orientation,
    promptLength: prompt.length,
    promptPreview: `${prompt.slice(0, 220)}${prompt.length > 220 ? '...' : ''}`
  });

  const pluginArgs = buildPluginArgs(provider, {
    command: 'edit',
    prompt,
    image: frame,
    size: theme.resolution?.size || '512x1024'
  });
  const result = await runImagePlugin(provider, pluginArgs, { themeId, cardId, orientation, mode: 'image-to-image', queueJob });
  // 先确认生成成功再备份旧图，避免生成失败导致旧卡牌"消失"
  backupExisting(themeId, cardId, orientation);
  const stem = cardFileStem(cardId, orientation);
  const dest = copyGeneratedToTheme(result, themeId, stem);
  log('generate-card', '卡牌生成流程完成', {
    themeId,
    cardId,
    orientation,
    provider: provider.id,
    output: path.relative(ROOT, dest)
  });
  return { prompt, provider: provider.id, image: `/api/themes/${encodeURIComponent(themeId)}/cards/${encodeURIComponent(path.basename(dest))}`, raw: result.result?.details };
}

async function generateFrame(themeId, prompt, size = '512x1024', providerId = '') {
  const provider = resolveProvider(providerId);
  const theme = loadTheme(themeId);
  const fullPrompt = `${prompt}\n\n竖版塔罗牌卡牌框示例图，比例 1:2，分辨率 ${size}。必须包含统一边框、中心插画区、标题/编号装饰区，但不要生成具体塔罗人物。`;

  log('generate-frame', '收到卡牌框生成请求', {
    themeId,
    size,
    provider: provider.id,
    promptLength: fullPrompt.length,
    promptPreview: `${fullPrompt.slice(0, 220)}${fullPrompt.length > 220 ? '...' : ''}`
  });

  const pluginArgs = buildPluginArgs(provider, { command: 'generate', prompt: fullPrompt, size });
  const result = await runImagePlugin(provider, pluginArgs, { themeId, mode: 'text-to-image-frame' });
  const details = result.result?.details || {};
  const serverPath = Array.isArray(details.serverPath) ? details.serverPath[0] : details.serverPath;
  if (!serverPath) throw new Error('生成结果缺少 serverPath');
  const source = path.join(ROOT, serverPath);
  const dest = path.join(themePath(themeId), theme.assets.frameExample || 'frame-example.png');
  fs.copyFileSync(source, dest);
  log('generate-frame', '卡牌框生成流程完成', {
    themeId,
    source: path.relative(ROOT, source),
    output: path.relative(ROOT, dest)
  });
  return { prompt: fullPrompt, frameExampleUrl: `/api/themes/${encodeURIComponent(themeId)}/frame` };
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try { resolve(JSON.parse(text)); } catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.resolve(PUBLIC_DIR, `.${pathname}`);
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  sendText(res, 200, fs.readFileSync(file), mimeOf(file));
  return true;
}

function serveThemeFile(res, themeId, area, file = '') {
  const base = themePath(themeId);
  let target = '';
  if (area === 'frame') target = path.join(base, loadTheme(themeId).assets.frameExample || 'frame-example.png');
  if (area === 'cards') target = path.join(base, 'cards', file);
  if (area === 'backup') target = path.join(base, 'backup', file);
  const resolved = path.resolve(target);
  if (!resolved.startsWith(path.resolve(base)) || !fs.existsSync(resolved)) return send(res, 404, { error: '文件不存在' });
  sendText(res, 200, fs.readFileSync(resolved), mimeOf(resolved));
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const parts = url.pathname.split('/').filter(Boolean);
  const startedAt = Date.now();
  log('http', '请求开始', { method: req.method, path: url.pathname });
  try {
    if (req.method === 'GET' && url.pathname === '/api/providers') return send(res, 200, listProviders());
    if (req.method === 'GET' && url.pathname === '/api/cards/default') return send(res, 200, { files: listDefaultCards(), canonical: getCanonicalCards() });
    if (req.method === 'GET' && url.pathname === '/api/themes') return send(res, 200, { themes: listThemes() });
    if (req.method === 'POST' && url.pathname === '/api/themes') {
      const body = await readRequestBody(req);
      return send(res, 200, createTheme(body.name, body.sourceThemeId || ''));
    }
    if (parts[0] === 'api' && parts[1] === 'themes' && parts[2]) {
      const themeId = decodeURIComponent(parts[2]);
      if (req.method === 'GET' && parts.length === 3) return send(res, 200, getThemeState(themeId));
      if (req.method === 'PUT' && parts.length === 3) {
        saveTheme(themeId, await readRequestBody(req));
        return send(res, 200, getThemeState(themeId));
      }
      if (req.method === 'GET' && ['frame', 'cards', 'backup'].includes(parts[3])) return serveThemeFile(res, themeId, parts[3], decodeURIComponent(parts[4] || ''));
      if (req.method === 'POST' && parts[3] === 'generate-card') {
        const body = await readRequestBody(req);
        const result = await generateCard(themeId, body.cardId, body.orientation || 'upright', Boolean(body.forceResolution), body.provider || '');
        log('http', '请求完成', { method: req.method, path: url.pathname, durationMs: Date.now() - startedAt });
        return send(res, 200, result);
      }
      if (req.method === 'POST' && parts[3] === 'generate-blank-queue') {
        const body = await readRequestBody(req);
        return send(res, 202, startGenerationQueue(themeId, body.provider || ''));
      }
      if (req.method === 'GET' && parts[3] === 'generate-blank-queue' && parts[4]) {
        return send(res, 200, serializeQueueJob(getQueueJob(decodeURIComponent(parts[4]))));
      }
      if (req.method === 'POST' && parts[3] === 'cancel-generate-blank-queue' && parts[4]) {
        return send(res, 200, cancelGenerationQueue(decodeURIComponent(parts[4])));
      }
      if (req.method === 'POST' && parts[3] === 'generate-frame') {
        const body = await readRequestBody(req);
        const result = await generateFrame(themeId, body.prompt || '', body.size || '512x1024', body.provider || '');
        log('http', '请求完成', { method: req.method, path: url.pathname, durationMs: Date.now() - startedAt });
        return send(res, 200, result);
      }
    }
    log('http', '请求未匹配', { method: req.method, path: url.pathname, durationMs: Date.now() - startedAt });
    send(res, 404, { error: 'API 不存在' });
  } catch (error) {
    log('http', '请求失败', { method: req.method, path: url.pathname, durationMs: Date.now() - startedAt, error: error.message });
    send(res, 500, { error: error.message });
  }
}

ensureDir(THEMES_DIR);
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) return handleApi(req, res);
  if (serveStatic(req, res)) return;
  send(res, 404, { error: 'Not Found' });
});

server.listen(PORT, () => {
  console.log(`Tarot Card Generator running at http://localhost:${PORT}`);
});