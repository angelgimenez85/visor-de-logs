const searchInput = document.getElementById('searchInput');
const consoleEl = document.getElementById('console');
const statusBar = document.getElementById('statusBar');
const tabBar = document.getElementById('tabBar');

const openFileOption = document.getElementById('openFileOption');
const quitOption = document.getElementById('quitOption');
const recentFilesSubmenu = document.getElementById('recentFilesSubmenu');
const aboutOption = document.getElementById('aboutOption');
const aboutModal = document.getElementById('aboutModal');
const aboutCloseBtn = document.getElementById('aboutCloseBtn');
const cursorPosEl = document.getElementById('cursorPos');

const settingsOption = document.getElementById('settingsOption');
const settingsModal = document.getElementById('settingsModal');
const settingsCloseBtn = document.getElementById('settingsCloseBtn');
const themeDarkOption = document.getElementById('themeDarkOption');
const themeLightOption = document.getElementById('themeLightOption');
const fontFamilyInput = document.getElementById('fontFamilyInput');
const fontSizeInput = document.getElementById('fontSizeInput');

const RECENT_KEY = 'visor-logs:recentFiles';
const MAX_RECENT = 10;
const NEAR_BOTTOM_THRESHOLD = 60;

const DEFAULT_CONFIG = {
  theme: 'dark',
  fontFamily: '"SF Mono", "Fira Code", Consolas, Menlo, monospace',
  fontSize: 12.5
};

let currentConfig = { ...DEFAULT_CONFIG };

// tabs: Map<filePath, { filePath, fileName, contentEl, filterTerm, nextLineNumber, lastEntryState }>
const tabs = new Map();
let activeFilePath = null;

// Detecta fechas/horas tipo "2024-01-15 10:23:45,123", "2024-01-15T10:23:45Z" o "10:23:45"
const DATE_REGEX = /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})?)?\b|\b\d{2}:\d{2}:\d{2}(?:[.,]\d{1,6})?\b/g;

// Detecta el nivel del log (primera aparición en la línea)
const LEVEL_REGEX = /\b(FATAL|SEVERE|ERROR|WARNING|WARN|INFO|DEBUG)\b/i;

// Una línea inicia una entrada nueva si arranca con fecha/hora o con el nivel;
// cualquier otra línea (p. ej. un stack trace) se considera continuación de la anterior.
const ENTRY_START_REGEX = /^\[?(?:\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2})?|\d{2}:\d{2}:\d{2}|(?:FATAL|SEVERE|ERROR|WARNING|WARN|INFO|DEBUG)\b)/i;

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function levelClass(level) {
  const upper = level.toUpperCase();
  if (upper === 'INFO') return 'lvl-info';
  if (upper === 'WARN' || upper === 'WARNING') return 'lvl-warn';
  if (upper === 'DEBUG') return 'lvl-debug';
  return 'lvl-error'; // ERROR / FATAL / SEVERE
}

function entryLevelKey(level) {
  if (!level) return null;
  const upper = level.toUpperCase();
  if (upper === 'INFO') return 'info';
  if (upper === 'WARN' || upper === 'WARNING') return 'warn';
  if (upper === 'DEBUG') return 'debug';
  return 'error'; // ERROR / FATAL / SEVERE
}

function formatLine(rawLine) {
  let html = escapeHtml(rawLine);

  html = html.replace(DATE_REGEX, (match) => `<span class="log-date">${match}</span>`);

  const levelMatch = rawLine.match(LEVEL_REGEX);
  if (levelMatch) {
    const level = levelMatch[0];
    const cls = levelClass(level);
    html = html.replace(new RegExp(`\\b${level}\\b`), `<span class="${cls}">${level}</span>`);
  }

  return `<span class="log-text">${html}</span>`;
}

function groupIntoEntries(lines) {
  const entries = [];
  let current = null;

  lines.forEach((line) => {
    if (current === null || ENTRY_START_REGEX.test(line)) {
      current = [line];
      entries.push(current);
    } else {
      current.push(line);
    }
  });

  return entries;
}

/**
 * Agrega una línea de continuación (p. ej. un renglón de stack trace) a una
 * entrada ya renderizada, creando el contenedor de líneas extra la primera vez.
 * Se usa tanto al construir el log inicial como al recibir nuevas líneas en vivo.
 */
function appendContinuationLine(entryState, line) {
  if (!entryState.extraEl) {
    entryState.extraEl = document.createElement('div');
    entryState.extraEl.className = 'entry-extra';
    entryState.wrapper.appendChild(entryState.extraEl);

    entryState.countEl = document.createElement('span');
    entryState.countEl.className = 'entry-count';
    const firstLineSpan = entryState.header.querySelector('.entry-first-line');
    entryState.header.insertBefore(entryState.countEl, firstLineSpan);
  }

  entryState.lines.push(line);
  const lineNo = entryState.startLine + entryState.lines.length - 1;

  const lineEl = document.createElement('span');
  lineEl.className = 'log-line';
  const lineNoEl = document.createElement('span');
  lineNoEl.className = 'line-no';
  lineNoEl.textContent = lineNo;
  lineEl.appendChild(lineNoEl);
  const contentEl = document.createElement('span');
  contentEl.className = 'line-content';
  contentEl.innerHTML = formatLine(line);
  lineEl.appendChild(contentEl);
  entryState.extraEl.appendChild(lineEl);

  const extraCount = entryState.lines.length - 1;
  entryState.countEl.textContent = `(+${extraCount} línea${extraCount === 1 ? '' : 's'})`;

  entryState.wrapper.dataset.raw += '\n' + line.toLowerCase();
}

/**
 * Construye el DOM de una entrada nueva a partir de su primera línea y
 * devuelve un estado editable (para poder ir agregándole líneas después,
 * tanto durante el parseo inicial como en vivo).
 */
function buildEntryState(firstLine, startLine) {
  const levelMatch = firstLine.match(LEVEL_REGEX);
  const level = levelMatch ? levelMatch[0].toUpperCase() : null;
  const levelKey = entryLevelKey(level);

  const wrapper = document.createElement('div');
  wrapper.className = 'log-entry collapsible collapsed' + (levelKey ? ` entry-${levelKey}` : '');
  wrapper.dataset.raw = firstLine.toLowerCase();

  const header = document.createElement('span');
  header.className = 'log-line log-entry-header';
  header.title = 'Clic para expandir / contraer';

  const lineNo = document.createElement('span');
  lineNo.className = 'line-no';
  lineNo.textContent = startLine;
  header.appendChild(lineNo);

  const toggle = document.createElement('span');
  toggle.className = 'entry-toggle';
  toggle.textContent = '▸';
  header.appendChild(toggle);

  const headerText = document.createElement('span');
  headerText.className = 'entry-first-line line-content';
  headerText.innerHTML = formatLine(firstLine);
  header.appendChild(headerText);

  header.addEventListener('click', () => {
    // No colapsar si el usuario está seleccionando texto (p. ej. para copiarlo)
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) return;

    const collapsedNow = wrapper.classList.toggle('collapsed');
    toggle.textContent = collapsedNow ? '▸' : '▾';
  });

  wrapper.appendChild(header);

  return {
    wrapper,
    header,
    extraEl: null,
    countEl: null,
    lines: [firstLine],
    startLine
  };
}

function buildLogContent(content) {
  const container = document.createElement('div');
  container.className = 'console-content';

  let lines = content.split(/\r\n|\r|\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines = lines.slice(0, -1);
  }

  const groups = groupIntoEntries(lines);
  let cursor = 1;
  let lastEntryState = null;

  groups.forEach((entryLines) => {
    const state = buildEntryState(entryLines[0], cursor);
    entryLines.slice(1).forEach((line) => appendContinuationLine(state, line));
    container.appendChild(state.wrapper);
    cursor += entryLines.length;
    lastEntryState = state;
  });

  return { container, nextLineNumber: cursor, lastEntryState };
}

function isScrolledNearBottom() {
  return consoleEl.scrollTop + consoleEl.clientHeight >= consoleEl.scrollHeight - NEAR_BOTTOM_THRESHOLD;
}

function scrollToBottom() {
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

/**
 * Calcula la línea (según el gutter) y la columna de texto donde está
 * parado el cursor, a partir de la selección actual del navegador.
 */
function computeLineAndColumn() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  const node = range.startContainer;
  const anchorEl = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  if (!anchorEl || !consoleEl.contains(anchorEl)) return null;

  const lineEl = anchorEl.closest('.log-line');
  if (!lineEl) return null;

  const lineNoEl = lineEl.querySelector('.line-no');
  if (!lineNoEl) return null;
  const line = lineNoEl.textContent.trim();

  const contentEl = lineEl.querySelector('.line-content');
  let column = 1;

  if (contentEl && contentEl.contains(node)) {
    const walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT);
    let charCount = 0;
    let current;
    while ((current = walker.nextNode())) {
      if (current === node) {
        charCount += range.startOffset;
        break;
      }
      charCount += current.textContent.length;
    }
    column = charCount + 1;
  }

  return { line, column };
}

function updateCursorPosition() {
  if (!cursorPosEl) return;
  const pos = computeLineAndColumn();
  if (pos) {
    cursorPosEl.textContent = `Ln ${pos.line}, Col ${pos.column}`;
  }
}

function applyFilter(query) {
  const term = query.trim().toLowerCase();
  const entries = consoleEl.querySelectorAll('.log-entry');
  let visibleCount = 0;

  entries.forEach((entry) => {
    const matches = term === '' || entry.dataset.raw.includes(term);
    entry.classList.toggle('hidden', !matches);
    if (matches) visibleCount++;
  });

  if (entries.length === 0) {
    statusBar.textContent = 'Sin archivo cargado';
  } else if (term !== '') {
    statusBar.textContent = `${visibleCount} de ${entries.length} entradas coinciden con "${query}"`;
  } else {
    statusBar.textContent = `${entries.length} entradas cargadas`;
  }
}

function refreshStatusBarIfActive(filePath) {
  if (activeFilePath !== filePath) return;

  const term = searchInput.value.trim();
  const entries = consoleEl.querySelectorAll('.log-entry');
  if (term === '') {
    statusBar.textContent = `${entries.length} entradas cargadas`;
  } else {
    const visible = consoleEl.querySelectorAll('.log-entry:not(.hidden)').length;
    statusBar.textContent = `${visible} de ${entries.length} entradas coinciden con "${term}"`;
  }
}

/* ---------------- Recarga automática en vivo ---------------- */

function handleLogFileChanged({ filePath, type, lines, content }) {
  const tab = tabs.get(filePath);
  if (!tab) return;

  if (type === 'reloaded') {
    const { container, nextLineNumber, lastEntryState } = buildLogContent(content);
    tab.contentEl = container;
    tab.nextLineNumber = nextLineNumber;
    tab.lastEntryState = lastEntryState;

    if (activeFilePath === filePath) {
      consoleEl.innerHTML = '';
      consoleEl.appendChild(tab.contentEl);
      applyFilter(tab.filterTerm || '');
      scrollToBottom();
    }
    return;
  }

  if (type === 'appended' && Array.isArray(lines) && lines.length > 0) {
    const wasNearBottom = activeFilePath === filePath && isScrolledNearBottom();
    const term = (tab.filterTerm || '').trim().toLowerCase();

    lines.forEach((line) => {
      let entryState;
      if (tab.lastEntryState && !ENTRY_START_REGEX.test(line)) {
        appendContinuationLine(tab.lastEntryState, line);
        entryState = tab.lastEntryState;
      } else {
        entryState = buildEntryState(line, tab.nextLineNumber);
        tab.contentEl.appendChild(entryState.wrapper);
        tab.lastEntryState = entryState;
      }
      tab.nextLineNumber++;

      if (term !== '') {
        const matches = entryState.wrapper.dataset.raw.includes(term);
        entryState.wrapper.classList.toggle('hidden', !matches);
      }
    });

    refreshStatusBarIfActive(filePath);
    if (wasNearBottom) scrollToBottom();
  }
}

/* ---------------- Recientes ---------------- */

function loadRecentFiles() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRecentFiles(list) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}

function addRecentFile(filePath) {
  let list = loadRecentFiles().filter((p) => p !== filePath);
  list.unshift(filePath);
  list = list.slice(0, MAX_RECENT);
  saveRecentFiles(list);
  renderRecentFilesMenu();
}

function removeRecentFile(filePath) {
  const list = loadRecentFiles().filter((p) => p !== filePath);
  saveRecentFiles(list);
  renderRecentFilesMenu();
}

function renderRecentFilesMenu() {
  const list = loadRecentFiles();
  recentFilesSubmenu.innerHTML = '';

  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'submenu-empty';
    empty.textContent = 'No hay archivos recientes';
    recentFilesSubmenu.appendChild(empty);
    return;
  }

  list.forEach((filePath) => {
    const opt = document.createElement('div');
    opt.className = 'menu-option';
    opt.title = filePath;
    opt.textContent = filePath.split(/[\\/]/).pop();
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      closeAllMenus();
      openRecentFile(filePath);
    });
    recentFilesSubmenu.appendChild(opt);
  });
}

/* ---------------- Pestañas ---------------- */

function renderTabBar() {
  tabBar.innerHTML = '';

  tabs.forEach((tab) => {
    const tabEl = document.createElement('div');
    tabEl.className = 'tab' + (tab.filePath === activeFilePath ? ' active' : '');
    tabEl.title = tab.filePath;

    const dot = document.createElement('span');
    dot.className = 'tab-dot';
    tabEl.appendChild(dot);

    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = tab.fileName;
    tabEl.appendChild(label);

    const close = document.createElement('span');
    close.className = 'tab-close';
    close.textContent = '×';
    close.title = 'Cerrar';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.filePath);
    });
    tabEl.appendChild(close);

    tabEl.addEventListener('click', () => switchTab(tab.filePath));

    tabBar.appendChild(tabEl);
  });
}

function switchTab(filePath) {
  const tab = tabs.get(filePath);
  if (!tab) return;

  activeFilePath = filePath;
  consoleEl.innerHTML = '';
  consoleEl.appendChild(tab.contentEl);
  searchInput.value = tab.filterTerm || '';
  applyFilter(searchInput.value);
  renderTabBar();
  scrollToBottom();
  if (cursorPosEl) cursorPosEl.textContent = 'Ln 1, Col 1';
}

function closeTab(filePath) {
  window.api.unwatchLogFile(filePath);
  tabs.delete(filePath);

  if (activeFilePath === filePath) {
    const remaining = Array.from(tabs.keys());
    if (remaining.length > 0) {
      switchTab(remaining[remaining.length - 1]);
    } else {
      activeFilePath = null;
      consoleEl.innerHTML = '';
      searchInput.value = '';
      statusBar.textContent = 'Sin archivo cargado';
      renderTabBar();
      if (cursorPosEl) cursorPosEl.textContent = 'Ln —, Col —';
    }
  } else {
    renderTabBar();
  }
}

function openOrSwitchTab(filePath, content) {
  if (tabs.has(filePath)) {
    switchTab(filePath);
    return;
  }

  const fileName = filePath.split(/[\\/]/).pop();
  const { container, nextLineNumber, lastEntryState } = buildLogContent(content);

  tabs.set(filePath, {
    filePath,
    fileName,
    contentEl: container,
    filterTerm: '',
    nextLineNumber,
    lastEntryState
  });

  switchTab(filePath);
  window.api.watchLogFile(filePath);
}

async function openLogFile() {
  const result = await window.api.openLogFile();
  if (!result) return;

  addRecentFile(result.filePath);
  openOrSwitchTab(result.filePath, result.content);
}

async function openRecentFile(filePath) {
  const result = await window.api.readLogFile(filePath);

  if (!result || result.error) {
    alert(`No se pudo abrir "${filePath}":\n${result ? result.error : 'archivo no disponible'}`);
    removeRecentFile(filePath);
    return;
  }

  addRecentFile(result.filePath);
  openOrSwitchTab(result.filePath, result.content);
}

/* ---------------- Configuración (tema y fuente) ---------------- */

let saveConfigTimer = null;

function applyConfig(config) {
  document.documentElement.dataset.theme = config.theme === 'light' ? 'light' : 'dark';
  document.documentElement.style.setProperty('--console-font-family', config.fontFamily);
  document.documentElement.style.setProperty('--console-font-size', `${config.fontSize}px`);

  themeDarkOption.classList.toggle('active', config.theme !== 'light');
  themeLightOption.classList.toggle('active', config.theme === 'light');
}

function persistConfig() {
  if (saveConfigTimer) clearTimeout(saveConfigTimer);
  saveConfigTimer = setTimeout(() => {
    window.api.saveConfig(currentConfig);
  }, 300);
}

function setTheme(theme) {
  currentConfig.theme = theme;
  applyConfig(currentConfig);
  persistConfig();
}

function populateSettingsForm() {
  fontFamilyInput.value = currentConfig.fontFamily;
  fontSizeInput.value = currentConfig.fontSize;
  themeDarkOption.classList.toggle('active', currentConfig.theme !== 'light');
  themeLightOption.classList.toggle('active', currentConfig.theme === 'light');
}

/* ---------------- Menú ---------------- */

const menuItems = Array.from(document.querySelectorAll('.menu-item.interactive'));

function closeAllMenus() {
  menuItems.forEach((item) => item.classList.remove('open'));
}

menuItems.forEach((item) => {
  item.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = item.classList.contains('open');
    closeAllMenus();
    if (!wasOpen) item.classList.add('open');
  });
});

document.addEventListener('click', () => {
  closeAllMenus();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeAllMenus();
    aboutModal.classList.remove('open');
    settingsModal.classList.remove('open');
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    openLogFile();
  }
});

openFileOption.addEventListener('click', (e) => {
  e.stopPropagation();
  closeAllMenus();
  openLogFile();
});

quitOption.addEventListener('click', (e) => {
  e.stopPropagation();
  window.close();
});

aboutOption.addEventListener('click', (e) => {
  e.stopPropagation();
  closeAllMenus();
  aboutModal.classList.add('open');
});

aboutCloseBtn.addEventListener('click', () => {
  aboutModal.classList.remove('open');
});

aboutModal.addEventListener('click', (e) => {
  if (e.target === aboutModal) aboutModal.classList.remove('open');
});

settingsOption.addEventListener('click', (e) => {
  e.stopPropagation();
  closeAllMenus();
  populateSettingsForm();
  settingsModal.classList.add('open');
});

settingsCloseBtn.addEventListener('click', () => {
  settingsModal.classList.remove('open');
});

settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) settingsModal.classList.remove('open');
});

themeDarkOption.addEventListener('click', () => setTheme('dark'));
themeLightOption.addEventListener('click', () => setTheme('light'));

fontFamilyInput.addEventListener('input', (e) => {
  currentConfig.fontFamily = e.target.value;
  applyConfig(currentConfig);
  persistConfig();
});

fontSizeInput.addEventListener('input', (e) => {
  const value = parseFloat(e.target.value);
  if (Number.isNaN(value) || value <= 0) return;
  currentConfig.fontSize = value;
  applyConfig(currentConfig);
  persistConfig();
});

searchInput.addEventListener('input', (e) => {
  const term = e.target.value;
  if (activeFilePath && tabs.has(activeFilePath)) {
    tabs.get(activeFilePath).filterTerm = term;
  }
  applyFilter(term);
});

window.api.onLogFileChanged(handleLogFileChanged);

document.addEventListener('selectionchange', updateCursorPosition);

renderRecentFilesMenu();

window.api.loadConfig().then((config) => {
  currentConfig = { ...DEFAULT_CONFIG, ...config };
  applyConfig(currentConfig);
});
