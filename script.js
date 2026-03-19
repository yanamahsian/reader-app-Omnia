let book = null;
let rendition = null;
let currentFontSize = 100;
let currentTheme = 'dark';
let selectedFragment = '';

const searchInput = document.getElementById('searchInput');
const languageSelect = document.getElementById('languageSelect');
const searchBtn = document.getElementById('searchBtn');
const resultsEl = document.getElementById('results');

const bookTitleEl = document.getElementById('bookTitle');
const statusTextEl = document.getElementById('statusText');
const emptyStateEl = document.getElementById('emptyState');
const readerFrameEl = document.getElementById('readerFrame');

const actionPanelEl = document.getElementById('actionPanel');
const selectedTextBoxEl = document.getElementById('selectedTextBox');
const actionResultEl = document.getElementById('actionResult');

const closeActionPanelBtn = document.getElementById('closeActionPanelBtn');
const translateBtn = document.getElementById('translateBtn');
const explainBtn = document.getElementById('explainBtn');
const saveBtn = document.getElementById('saveBtn');

const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const fontMinusBtn = document.getElementById('fontMinusBtn');
const fontPlusBtn = document.getElementById('fontPlusBtn');

const themeDefaultBtn = document.getElementById('themeDefaultBtn');
const themeDarkBtn = document.getElementById('themeDarkBtn');
const themePurpleBtn = document.getElementById('themePurpleBtn');
const themeRedBtn = document.getElementById('themeRedBtn');

searchBtn.addEventListener('click', searchBooks);
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') searchBooks();
});

prevBtn.addEventListener('click', prevPage);
nextBtn.addEventListener('click', nextPage);

fontMinusBtn.addEventListener('click', () => changeFontSize(-2));
fontPlusBtn.addEventListener('click', () => changeFontSize(2));

themeDefaultBtn.addEventListener('click', () => setTheme('default'));
themeDarkBtn.addEventListener('click', () => setTheme('dark'));
themePurpleBtn.addEventListener('click', () => setTheme('purple'));
themeRedBtn.addEventListener('click', () => setTheme('red'));

closeActionPanelBtn.addEventListener('click', closeActionPanel);
translateBtn.addEventListener('click', translateSelection);
explainBtn.addEventListener('click', explainSelection);
saveBtn.addEventListener('click', saveSelection);

document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') prevPage();
  if (e.key === 'ArrowRight') nextPage();
});

function setTheme(theme) {
  document.body.className = theme === 'default' ? '' : `theme-${theme}`;
  currentTheme = theme;
  applyReaderStyles();
}

function changeFontSize(delta) {
  currentFontSize += delta;
  if (currentFontSize < 80) currentFontSize = 80;
  if (currentFontSize > 180) currentFontSize = 180;
  applyReaderStyles();
}

function prevPage() {
  if (rendition) rendition.prev();
}

function nextPage() {
  if (rendition) rendition.next();
}

function closeActionPanel() {
  actionPanelEl.classList.remove('active');
}

function openActionPanel(text) {
  if (!text || !text.trim()) return;
  selectedFragment = text.trim();
  selectedTextBoxEl.textContent = selectedFragment;
  actionResultEl.textContent = 'Выбери действие: перевести, объяснить или сохранить.';
  actionPanelEl.classList.add('active');
}

function translateSelection() {
  if (!selectedFragment) return;
  actionResultEl.textContent =
    'Тестовый перевод:\n\n' +
    'На следующем этапе сюда подключается настоящий AI-перевод. Сейчас мы проверяем механику интерфейса.';
}

function explainSelection() {
  if (!selectedFragment) return;
  actionResultEl.textContent =
    'Тестовое объяснение:\n\n' +
    'Этот фрагмент пока объясняется заглушкой. Следующим шагом сюда подключается интеллектуальное объяснение текста.';
}

function saveSelection() {
  if (!selectedFragment) return;
  actionResultEl.textContent =
    'Фрагмент сохранён в тестовом режиме. Позже подключим реальные заметки и цитаты.';
}

function escapeHtml(str) {
  return str
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function searchBooks() {
  const query = searchInput.value.trim();
  const lang = languageSelect.value.trim();

  if (!query) {
    resultsEl.innerHTML = `
      <div class="book-card">
        <div class="book-title">Пустой запрос</div>
        <div class="book-meta">Введи автора или название книги.</div>
      </div>
    `;
    return;
  }

  resultsEl.innerHTML = `
    <div class="book-card">
      <div class="book-title">Ищу книги…</div>
      <div class="book-meta">Подожди пару секунд.</div>
    </div>
  `;

  let url = `https://gutendex.com/books?search=${encodeURIComponent(query)}`;
  if (lang) url += `&languages=${encodeURIComponent(lang)}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    const books = data.results || [];

    if (!books.length) {
      resultsEl.innerHTML = `
        <div class="book-card">
          <div class="book-title">Ничего не найдено</div>
          <div class="book-meta">Попробуй другой запрос.</div>
        </div>
      `;
      return;
    }

    renderResults(books.slice(0, 18));
  } catch (error) {
    console.error(error);
    resultsEl.innerHTML = `
      <div class="book-card">
        <div class="book-title">Ошибка</div>
        <div class="book-meta">Не удалось загрузить библиотеку.</div>
      </div>
    `;
  }
}

function renderResults(books) {
  resultsEl.innerHTML = '';

  books.forEach((item) => {
    const title = item.title || 'Без названия';
    const authors = (item.authors || []).map(a => a.name).join(', ') || 'Автор неизвестен';
    const languages = (item.languages || []).join(', ') || '—';
    const downloads = item.download_count || 0;

    const epubUrl =
      item.formats['application/epub+zip'] ||
      item.formats['application/epub+zip; charset=binary'];

    const htmlUrl =
      item.formats['text/html'] ||
      item.formats['text/html; charset=utf-8'];

    const card = document.createElement('div');
    card.className = 'book-card';

    card.innerHTML = `
      <div class="book-title">${escapeHtml(title)}</div>
      <div class="book-meta">
        ${escapeHtml(authors)}<br>
        Язык: ${escapeHtml(languages)}<br>
        Скачиваний: ${downloads}
      </div>
      <div class="book-actions">
        ${epubUrl ? `<button data-epub="${encodeURIComponent(epubUrl)}" data-title="${escapeHtml(title)}">Открыть EPUB</button>` : ''}
        ${htmlUrl ? `<button data-html="${encodeURIComponent(htmlUrl)}">Открыть HTML</button>` : ''}
      </div>
    `;

    resultsEl.appendChild(card);

    const epubButton = card.querySelector('[data-epub]');
    if (epubButton) {
      epubButton.addEventListener('click', () => {
        openEpub(decodeURIComponent(epubButton.dataset.epub), epubButton.dataset.title);
      });
    }

    const htmlButton = card.querySelector('[data-html]');
    if (htmlButton) {
      htmlButton.addEventListener('click', () => {
        window.open(decodeURIComponent(htmlButton.dataset.html), '_blank', 'noopener,noreferrer');
      });
    }
  });
}

async function openEpub(epubUrl, title) {
  emptyStateEl.style.display = 'none';
  readerFrameEl.style.display = 'block';
  bookTitleEl.textContent = title;
  statusTextEl.textContent = 'Загружаю книгу…';

  try {
    document.getElementById('viewer').innerHTML = '';

    const proxyUrl = `https://cors.isomorphic-git.org/${epubUrl}`;
    book = ePub(proxyUrl);

    rendition = book.renderTo('viewer', {
      width: '100%',
      height: '100%',
      spread: 'none'
    });

    rendition.hooks.content.register((contents) => {
      setupSelectionHandling(contents);
    });

    await rendition.display();

    book.loaded.metadata.then((metadata) => {
      if (metadata && metadata.title) {
        bookTitleEl.textContent = metadata.title;
      }
    });

    rendition.on('rendered', () => {
      statusTextEl.textContent = 'Книга открыта.';
      applyReaderStyles();
    });

    rendition.on('relocated', (location) => {
      const percentage =
        location &&
        location.start &&
        typeof location.start.percentage === 'number'
          ? Math.round(location.start.percentage * 100)
          : 0;

      statusTextEl.textContent = `Прочитано: ${percentage}%`;
    });

    applyReaderStyles();
  } catch (error) {
    console.error(error);
    statusTextEl.textContent = 'Не удалось открыть EPUB.';
    alert('EPUB не открылся. Иногда это бывает из-за ограничений внешнего сервера.');
  }
}

function applyReaderStyles() {
  if (!rendition) return;

  let bg = '#f5f1e8';
  let text = '#181818';

  if (currentTheme === 'dark') {
    bg = '#0f1013';
    text = '#f0f0f0';
  } else if (currentTheme === 'purple') {
    bg = '#261733';
    text = '#f2e8ff';
  } else if (currentTheme === 'red') {
    bg = '#351116';
    text = '#fde6e8';
  }

  rendition.themes.default({
    body: {
      background: `${bg} !important`,
      color: `${text} !important`,
      'font-family': "'EB Garamond', serif !important",
      'font-size': `${currentFontSize}% !important`,
      'line-height': '1.85 !important',
      padding: '28px !important'
    },
    p: {
      'line-height': '1.85 !important'
    },
    'h1, h2, h3, h4, h5, h6': {
      color: `${text} !important`,
      'font-family': "'EB Garamond', serif !important"
    },
    a: {
      color: `${text} !important`
    }
  });

  rendition.themes.select('default');
}

function setupSelectionHandling(contents) {
  const doc = contents.document;
  if (!doc) return;

  doc.addEventListener('mouseup', () => {
    setTimeout(() => {
      const selection = doc.getSelection();
      const text = selection ? selection.toString().trim() : '';

      removeFloatingMenu(doc);

      if (!text || text.length < 2) return;

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      createFloatingMenu(
        doc,
        rect.left + contents.window.scrollX,
        rect.top + contents.window.scrollY - 48,
        text
      );
    }, 10);
  });

  doc.addEventListener('mousedown', (event) => {
    const existingMenu = doc.getElementById('omniaSelectionMenu');
    if (existingMenu && !existingMenu.contains(event.target)) {
      removeFloatingMenu(doc);
    }
  });
}

function removeFloatingMenu(doc) {
  const existing = doc.getElementById('omniaSelectionMenu');
  if (existing) existing.remove();
}

function createFloatingMenu(doc, x, y, text) {
  removeFloatingMenu(doc);

  const menu = doc.createElement('div');
  menu.id = 'omniaSelectionMenu';
  menu.className = 'floating-selection-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const translateButton = doc.createElement('button');
  translateButton.textContent = 'Перевести';
  translateButton.addEventListener('click', () => {
    openActionPanel(text);
    translateSelection();
    removeFloatingMenu(doc);
  });

  const explainButton = doc.createElement('button');
  explainButton.textContent = 'Объяснить';
  explainButton.addEventListener('click', () => {
    openActionPanel(text);
    explainSelection();
    removeFloatingMenu(doc);
  });

  const saveButton = doc.createElement('button');
  saveButton.textContent = 'Сохранить';
  saveButton.addEventListener('click', () => {
    openActionPanel(text);
    saveSelection();
    removeFloatingMenu(doc);
  });

  menu.appendChild(translateButton);
  menu.appendChild(explainButton);
  menu.appendChild(saveButton);

  doc.body.appendChild(menu);
}

window.addEventListener('load', () => {
  searchInput.value = 'Nietzsche';
  searchBooks();
});
