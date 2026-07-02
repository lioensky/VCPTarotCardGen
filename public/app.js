const state = {
  themes: [],
  current: null,
  defaultCards: [],
  busy: false
};

const $ = (id) => document.getElementById(id);

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function setBusy(flag) {
  state.busy = flag;
  document.querySelectorAll('button').forEach((btn) => { btn.disabled = flag; });
}

function resolutionPrompt(size) {
  return size === '1024x2048'
    ? '竖版塔罗牌构图，输出比例 1:2，建议分辨率 1024x2048。'
    : '竖版塔罗牌构图，输出比例 1:2，建议分辨率 512x1024。';
}

function getEditorTheme() {
  const theme = structuredClone(state.current.theme);
  theme.name = $('themeName').value.trim() || theme.name;
  theme.resolution.size = $('themeResolution').value;
  theme.resolution.label = theme.resolution.size === '1024x2048' ? '2k' : '1k';
  theme.resolution.prompt = $('resolutionPrompt').value;
  theme.prompts.frameImageGuide = $('frameGuide').value;
  theme.prompts.theme = $('themePrompt').value;
  theme.prompts.innerStyle = $('innerStyle').value;
  theme.prompts.negative = $('negativePrompt').value;
  document.querySelectorAll('[data-card-prompt]').forEach((textarea) => {
    const cardId = textarea.dataset.cardId;
    const orientation = textarea.dataset.orientation;
    theme.cards[cardId] ||= { upright: '', reversed: '' };
    theme.cards[cardId][orientation] = textarea.value;
  });
  return theme;
}

function assemblePrompt(theme, cardId, orientation) {
  const chunks = [
    theme.prompts.frameImageGuide,
    theme.prompts.theme,
    theme.prompts.innerStyle,
    theme.resolution.prompt,
    theme.cards?.[cardId]?.[orientation],
    theme.prompts.negative ? `负面约束：${theme.prompts.negative}` : ''
  ];
  return chunks.filter(Boolean).join('\n\n');
}

function renderThemeList() {
  const select = $('themeSelect');
  select.innerHTML = '';
  state.themes.forEach((theme) => {
    const option = document.createElement('option');
    option.value = theme.id;
    option.textContent = `${theme.name} (${theme.id})`;
    if (state.current?.theme?.id === theme.id) option.selected = true;
    select.appendChild(option);
  });
}

function renderDefaultCardsSummary() {
  const files = state.defaultCards.files || [];
  const canonical = state.defaultCards.canonical || [];
  $('defaultCardsSummary').innerHTML = `
    <div>实际文件：${files.length} 个</div>
    <div>规范卡位：${canonical.length} 个（78 张塔罗 + 牌背）</div>
    <div>包含正位与逆位文件，逆位以“逆位”前缀区分。</div>
  `;
}

function renderFrame() {
  const box = $('framePreview');
  if (state.current?.frameExampleExists) {
    box.classList.remove('empty');
    box.innerHTML = `<img src="${state.current.frameExampleUrl}?t=${Date.now()}" alt="卡牌框示例图">`;
  } else {
    box.classList.add('empty');
    box.textContent = '未提供卡牌框示例图';
  }
}

function renderEditor() {
  if (!state.current) {
    $('themeEditor').classList.add('hidden');
    $('emptyState').classList.remove('hidden');
    return;
  }

  const theme = state.current.theme;
  $('themeEditor').classList.remove('hidden');
  $('emptyState').classList.add('hidden');
  $('themeTitle').textContent = theme.name;
  $('themeName').value = theme.name || '';
  $('themeResolution').value = theme.resolution?.size || '512x1024';
  $('resolutionPrompt').value = theme.resolution?.prompt || resolutionPrompt($('themeResolution').value);
  $('frameGuide').value = theme.prompts?.frameImageGuide || '';
  $('themePrompt').value = theme.prompts?.theme || '';
  $('innerStyle').value = theme.prompts?.innerStyle || '';
  $('negativePrompt').value = theme.prompts?.negative || '';

  renderFrame();
  renderCards();
}

function renderImage(url) {
  if (!url) return '<div class="preview">未生成</div>';
  return `<div class="preview"><img src="${url}?t=${Date.now()}" alt="card"></div>`;
}

function renderBackups(backups) {
  if (!backups?.length) return '<div class="backups">暂无备份</div>';
  return `<div class="backups">备份：${backups.slice(0, 5).map((item, index) => `<a href="${item.url}" target="_blank">#${index + 1}</a>`).join('')}</div>`;
}

function renderVersion(card, orientation) {
  if (card.id === '牌背' && orientation === 'reversed') return '';
  const prompt = card.prompts?.[orientation] || '';
  const image = card.images?.[orientation] || '';
  const backups = card.backups?.[orientation] || [];
  const title = orientation === 'reversed' ? '逆位' : '正位';
  const generateText = image ? '重新生成' : '生成';
  return `
    <section class="version">
      <div class="version-title"><strong>${title}</strong><span>${image ? '已生成' : '空'}</span></div>
      ${renderImage(image)}
      <textarea class="prompt-text" data-card-prompt data-card-id="${card.id}" data-orientation="${orientation}">${prompt}</textarea>
      <div class="actions">
        <button data-action="show-prompt" data-card-id="${card.id}" data-orientation="${orientation}">预览4合1</button>
        <button data-action="generate-card" data-card-id="${card.id}" data-orientation="${orientation}">${generateText}</button>
      </div>
      ${renderBackups(backups)}
    </section>
  `;
}

function renderCards() {
  const grid = $('cardsGrid');
  const search = $('cardSearch').value.trim().toLowerCase();
  const filter = $('orientationFilter').value;
  const cards = state.current.cards.filter((card) => !search || card.name.toLowerCase().includes(search) || card.id.toLowerCase().includes(search));
  grid.innerHTML = cards.map((card) => `
    <article class="card">
      <header>
        <h3>${card.name}</h3>
        <span class="badge">${card.arcana}</span>
      </header>
      <div class="versions">
        ${filter !== 'reversed' ? renderVersion(card, 'upright') : ''}
        ${filter !== 'upright' ? renderVersion(card, 'reversed') : ''}
      </div>
    </article>
  `).join('');
}

async function loadThemes() {
  const data = await api('/api/themes');
  state.themes = data.themes;
  renderThemeList();
}

async function loadDefaultCards() {
  state.defaultCards = await api('/api/cards/default');
  renderDefaultCardsSummary();
}

async function loadTheme(themeId) {
  state.current = await api(`/api/themes/${encodeURIComponent(themeId)}`);
  renderThemeList();
  renderEditor();
}

async function saveTheme() {
  if (!state.current) return;
  setBusy(true);
  try {
    const theme = getEditorTheme();
    state.current = await api(`/api/themes/${encodeURIComponent(theme.id)}`, {
      method: 'PUT',
      body: JSON.stringify(theme)
    });
    await loadThemes();
    renderEditor();
  } catch (error) {
    alert(error.message);
  } finally {
    setBusy(false);
  }
}

async function createTheme() {
  const name = $('newThemeName').value.trim();
  if (!name) return alert('请输入主题名称');
  setBusy(true);
  try {
    state.current = await api('/api/themes', {
      method: 'POST',
      body: JSON.stringify({ name, sourceThemeId: state.current?.theme?.id || '' })
    });
    $('newThemeName').value = '';
    await loadThemes();
    renderEditor();
  } catch (error) {
    alert(error.message);
  } finally {
    setBusy(false);
  }
}

async function generateFrame() {
  if (!state.current) return;
  const prompt = $('framePrompt').value.trim();
  if (!prompt) return alert('请输入卡牌框提示词');
  await saveTheme();
  setBusy(true);
  try {
    await api(`/api/themes/${encodeURIComponent(state.current.theme.id)}/generate-frame`, {
      method: 'POST',
      body: JSON.stringify({ prompt, size: $('frameSize').value })
    });
    await loadTheme(state.current.theme.id);
  } catch (error) {
    alert(error.message);
  } finally {
    setBusy(false);
  }
}

async function generateCard(cardId, orientation) {
  if (!state.current) return;
  await saveTheme();
  setBusy(true);
  try {
    await api(`/api/themes/${encodeURIComponent(state.current.theme.id)}/generate-card`, {
      method: 'POST',
      body: JSON.stringify({ cardId, orientation, forceResolution: !state.current.frameExampleExists })
    });
    await loadTheme(state.current.theme.id);
  } catch (error) {
    alert(error.message);
  } finally {
    setBusy(false);
  }
}

function showPrompt(cardId, orientation) {
  const theme = getEditorTheme();
  $('dialogTitle').textContent = `${cardId} / ${orientation === 'reversed' ? '逆位' : '正位'} 4合1提示词`;
  $('dialogContent').textContent = assemblePrompt(theme, cardId, orientation);
  $('promptDialog').showModal();
}

function bindEvents() {
  $('refreshBtn').addEventListener('click', init);
  $('createThemeBtn').addEventListener('click', createTheme);
  $('saveThemeBtn').addEventListener('click', saveTheme);
  $('generateFrameBtn').addEventListener('click', generateFrame);
  $('themeSelect').addEventListener('change', (event) => loadTheme(event.target.value));
  $('themeResolution').addEventListener('change', () => {
    $('resolutionPrompt').value = resolutionPrompt($('themeResolution').value);
  });
  $('cardSearch').addEventListener('input', renderCards);
  $('orientationFilter').addEventListener('change', renderCards);
  $('cardsGrid').addEventListener('click', (event) => {
    const btn = event.target.closest('button');
    if (!btn) return;
    const cardId = btn.dataset.cardId;
    const orientation = btn.dataset.orientation;
    if (btn.dataset.action === 'show-prompt') showPrompt(cardId, orientation);
    if (btn.dataset.action === 'generate-card') generateCard(cardId, orientation);
  });
}

async function init() {
  setBusy(true);
  try {
    await loadDefaultCards();
    await loadThemes();
    if (state.themes.length && !state.current) await loadTheme(state.themes[0].id);
    else renderEditor();
  } catch (error) {
    alert(error.message);
  } finally {
    setBusy(false);
  }
}

bindEvents();
init();