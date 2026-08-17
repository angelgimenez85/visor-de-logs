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

const RECENT_KEY = 'visor-logs:recentFiles';
const MAX_RECENT = 10;

// tabs: Map<filePath, { filePath, fileName, contentEl, filterTerm }>
const tabs = new Map();
let activeFilePath = null;

// Detecta fechas/horas tipo "2024-01-15 10:23:45,123", "2024-01-15T10:23:45Z" o "10:23:45"
const DATE_REGEX = /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})?)?\b|\b\d{2}:\d{2}:\d{2}(?:[.,]\d{1,6})?\b/g;

// Detecta el nivel del log (primera aparición en la línea)
const LEVEL_REGEX = /\b(FATAL|ERROR|WARNING|WARN|INFO)\b/i;

// Una línea inicia una entrada nueva si arranca con fecha/hora o con el nivel;
// cualquier otra línea (p. ej. un stack trace) se considera continuación de la anterior.
const ENTRY_START_REGEX = /^\[?(?:\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2})?|\d{2}:\d{2}:\d{2}|(?:FATAL|ERROR|WARNING|WARN|INFO)\b)/i;

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
  return 'lvl-error'; // ERROR / FATAL
}

function entryLevelKey(level) {
  if (!level) return null;
  const upper = level.toUpperCase();
  if (upper === 'INFO') return 'info';
  if (upper === 'WARN' || upper === 'WARNING') return 'warn';
  return 'error'; // ERROR / FATAL
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

function renderEntry(entry, startLine) {
  const firstLine = entry[0];
  const levelMatch = firstLine.match(LEVEL_REGEX);
  const level = levelMatch ? levelMatch[0].toUpperCase() : null;
  const levelKey = entryLevelKey(level);
  const hasExtraLines = entry.length > 1;

  const wrapper = document.createElement('div');
  wrapper.className = 'log-entry collapsible collapsed' + (levelKey ? ` entry-${levelKey}` : '');
  wrapper.dataset.raw = entry.join('\n').toLowerCase();

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

  if (hasExtraLines) {
    const count = document.createElement('span');
    count.className = 'entry-count';
    count.textContent = `(+${entry.length - 1} línea${entry.length - 1 === 1 ? '' : 's'})`;
    header.appendChild(count);
  }

  const headerText = document.createElement('span');
  headerText.className = 'entry-first-line';
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

  if (entry.length > 1) {
    const extra = document.createElement('div');
    extra.className = 'entry-extra';
    entry.slice(1).forEach((line, i) => {
      const lineEl = document.createElement('span');
      lineEl.className = 'log-line';
      const extraLineNo = document.createElement('span');
      extraLineNo.className = 'line-no';
      extraLineNo.textContent = startLine + i + 1;
      lineEl.appendChild(extraLineNo);
      const extraContent = document.createElement('span');
      extraContent.innerHTML = formatLine(line);
      lineEl.appendChild(extraContent);
      extra.appendChild(lineEl);
    });
    wrapper.appendChild(extra);
  }

  return wrapper;
}

function buildLogContent(content) {
  const container = document.createElement('div');
  container.className = 'console-content';

  let lines = content.split(/\r\n|\r|\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines = lines.slice(0, -1);
  }

  const entries = groupIntoEntries(lines);
  let cursor = 1;
  entries.forEach((entry) => {
    container.appendChild(renderEntry(entry, cursor));
    cursor += entry.length;
  });

  return container;
}

function scrollToBottom() {
  consoleEl.scrollTop = consoleEl.scrollHeight;
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
}

function closeTab(filePath) {
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
  const contentEl = buildLogContent(content);

  tabs.set(filePath, { filePath, fileName, contentEl, filterTerm: '' });
  switchTab(filePath);
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

searchInput.addEventListener('input', (e) => {
  const term = e.target.value;
  if (activeFilePath && tabs.has(activeFilePath)) {
    tabs.get(activeFilePath).filterTerm = term;
  }
  applyFilter(term);
});

renderRecentFilesMenu();
