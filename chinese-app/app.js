// ==================== БАЗА ДАННЫХ ====================
const DB_NAME = 'chinese_app';
const DB_VERSION = 1;
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('words')) {
        const store = d.createObjectStore('words', { keyPath: 'id', autoIncrement: true });
        store.createIndex('hz', 'hz', { unique: true });
      }
      if (!d.objectStoreNames.contains('notes')) {
        const store = d.createObjectStore('notes', { keyPath: 'id', autoIncrement: true });
        store.createIndex('wordId', 'wordId', { unique: false });
      }
      if (!d.objectStoreNames.contains('settings')) {
        d.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror = e => reject(e.target.error);
  });
}

function tx(store, mode = 'readonly') {
  return db.transaction(store, mode).objectStore(store);
}

function dbGetAll(store) {
  return new Promise((res, rej) => {
    const r = tx(store).getAll();
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function dbGet(store, key) {
  return new Promise((res, rej) => {
    const r = tx(store).get(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function dbPut(store, value) {
  return new Promise((res, rej) => {
    const r = tx(store, 'readwrite').put(value);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function dbAdd(store, value) {
  return new Promise((res, rej) => {
    const r = tx(store, 'readwrite').add(value);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function dbDelete(store, key) {
  return new Promise((res, rej) => {
    const r = tx(store, 'readwrite').delete(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

// ==================== НАСТРОЙКИ ====================
const DEFAULT_SETTINGS = {
  hourStart: 9,
  hourEnd: 23,
  lastNotifiedWordId: null,
  lastNotifyTime: 0,
};

async function getSettings() {
  const s = await dbGet('settings', 'main');
  return s ? { ...DEFAULT_SETTINGS, ...s.value } : { ...DEFAULT_SETTINGS };
}

async function saveSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch };
  await dbPut('settings', { key: 'main', value: next });
  return next;
}

// ==================== SRS ====================
// Интервалы в днях: 1 → 3 → 7 → 14 → 30
const SRS_INTERVALS = [1, 3, 7, 14, 30];

function nextDue(word, remembered) {
  const now = Date.now();
  if (!remembered) {
    word.srsLevel = 0;
    word.dueAt = now + SRS_INTERVALS[0] * 86400000;
  } else {
    const lvl = Math.min((word.srsLevel || 0) + 1, SRS_INTERVALS.length - 1);
    word.srsLevel = lvl;
    word.dueAt = now + SRS_INTERVALS[lvl] * 86400000;
  }
  return word;
}

// ==================== УТИЛИТЫ ====================
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
    + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

// ==================== РЕНДЕР СПИСКА ====================
let allWords = [];
let searchQuery = '';

async function loadWords() {
  allWords = await dbGetAll('words');
  allWords.sort((a, b) => (a.dueAt || 0) - (b.dueAt || 0));
}

function renderList() {
  const list = document.getElementById('list');
  const q = searchQuery.trim().toLowerCase();
  let filtered = allWords;
  if (q) {
    filtered = allWords.filter(w =>
      w.hz.includes(q) ||
      (w.py || '').toLowerCase().includes(q) ||
      (w.tr || '').toLowerCase().includes(q)
    );
  }
  if (!filtered.length) {
    list.innerHTML = '<div class="empty">' +
      (q ? 'Ничего не найдено' : 'Список пуст. Нажмите «+» или «Импорт».') +
      '</div>';
    return;
  }
  const now = Date.now();
  list.innerHTML = filtered.map(w => {
    const due = w.dueAt && w.dueAt <= now;
    return `<div class="card" data-id="${w.id}">
      <div class="hz">${escapeHtml(w.hz)}</div>
      <div class="py">${escapeHtml(w.py || '')}</div>
      <div class="tr">${escapeHtml(w.tr || '')}</div>
      <div class="meta">${due ? '🔔 Пора повторить' : 'Следующее: ' + (w.dueAt ? formatDate(w.dueAt) : 'не задано')}</div>
    </div>`;
  }).join('');
  list.querySelectorAll('.card').forEach(el => {
    el.addEventListener('click', () => openWordModal(Number(el.dataset.id)));
  });
}

// ==================== МОДАЛКА СЛОВА ====================
async function openWordModal(id) {
  const word = id ? await dbGet('words', id) : null;
  const notes = id ? (await dbGetAll('notes')).filter(n => n.wordId === id).sort((a,b)=>b.createdAt-a.createdAt) : [];
  const isNew = !id;
  const w = word || { hz: '', py: '', tr: '', srsLevel: 0, dueAt: Date.now() };

  const root = document.getElementById('modalRoot');
  root.innerHTML = `
    <div class="modal-bg" id="modalBg">
      <div class="modal" id="modalContent">
        <h2>${isNew ? 'Новое слово' : 'Слово'}</h2>
        <label>Иероглиф</label>
        <input id="mHz" value="${escapeHtml(w.hz)}" ${isNew ? '' : 'readonly'}>
        <label>Пиньинь</label>
        <input id="mPy" value="${escapeHtml(w.py)}">
        <label>Перевод</label>
        <textarea id="mTr">${escapeHtml(w.tr)}</textarea>
        <div class="error hidden" id="mErr"></div>
        ${!isNew ? `
          <label>Моё предложение (заметка)</label>
          <textarea id="mNote" placeholder="Напиши предложение с этим словом..."></textarea>
          <button class="btn-primary" id="mAddNote" style="width:100%;margin-top:8px;padding:10px;border:none;border-radius:8px;font-weight:600;">Сохранить заметку</button>
          <div id="notesList" style="margin-top:12px;">
            ${notes.map(n => `<div class="note-item"><div class="date">${formatDate(n.createdAt)}</div>${escapeHtml(n.text)}</div>`).join('')}
          </div>
          <label style="margin-top:18px;">Повторение</label>
          <div class="row">
            <button class="btn-secondary" id="mForgot">😕 Забыла</button>
            <button class="btn-primary" id="mRemember">😊 Помню</button>
          </div>
        ` : ''}
        <div class="row">
          <button class="btn-secondary" id="mCancel">Отмена</button>
          <button class="btn-primary" id="mSave">Сохранить</button>
        </div>
        ${!isNew ? `<div class="row"><button class="btn-danger" id="mDelete">Удалить слово</button></div>` : ''}
      </div>
    </div>
  `;

  const close = () => root.innerHTML = '';
  document.getElementById('modalBg').addEventListener('click', e => {
    if (e.target.id === 'modalBg') close();
  });
  document.getElementById('mCancel').addEventListener('click', close);

  document.getElementById('mSave').addEventListener('click', async () => {
    const hz = document.getElementById('mHz').value.trim();
    const py = document.getElementById('mPy').value.trim();
    const tr = document.getElementById('mTr').value.trim();
    const err = document.getElementById('mErr');
    err.classList.add('hidden');
    if (!hz) { err.textContent = 'Введите иероглиф'; err.classList.remove('hidden'); return; }
    if (isNew) {
      const existing = allWords.find(x => x.hz === hz);
      if (existing) {
        err.textContent = `Такое слово уже есть: ${existing.py} — ${existing.tr}`;
        err.classList.remove('hidden');
        return;
      }
      const now = Date.now();
      const newWord = {
        hz, py, tr,
        srsLevel: 0,
        dueAt: now, // сразу доступно к повторению
        createdAt: now,
      };
      await dbAdd('words', newWord);
    } else {
      w.py = py; w.tr = tr;
      await dbPut('words', w);
    }
    await loadWords();
    renderList();
    close();
  });

  if (!isNew) {
    document.getElementById('mRemember').addEventListener('click', async () => {
      nextDue(w, true);
      await dbPut('words', w);
      await loadWords();
      renderList();
      close();
    });
    document.getElementById('mForgot').addEventListener('click', async () => {
      nextDue(w, false);
      await dbPut('words', w);
      await loadWords();
      renderList();
      close();
    });
    document.getElementById('mDelete').addEventListener('click', async () => {
      if (!confirm('Удалить слово и все его заметки?')) return;
      const allNotes = await dbGetAll('notes');
      for (const n of allNotes) if (n.wordId === id) await dbDelete('notes', n.id);
      await dbDelete('words', id);
      await loadWords();
      renderList();
      close();
    });
    document.getElementById('mAddNote').addEventListener('click', async () => {
      const text = document.getElementById('mNote').value.trim();
      if (!text) return;
      await dbAdd('notes', { wordId: id, text, createdAt: Date.now() });
      openWordModal(id);
    });
  }
}

// ==================== ИМПОРТ / ЭКСПОРТ ====================
async function importWords() {
  const text = prompt('Вставь строки в формате:\nиероглиф|пиньинь|перевод\n\nКаждая строка — одно слово.');
  if (!text) return;
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let added = 0, skipped = 0, dup = 0;
  const now = Date.now();
  for (const line of lines) {
    const parts = line.split('|').map(s => s.trim());
    if (parts.length < 3) { skipped++; continue; }
    const [hz, py, tr] = parts;
    if (allWords.find(x => x.hz === hz)) { dup++; continue; }
    await dbAdd('words', { hz, py, tr, srsLevel: 0, dueAt: now, createdAt: now });
    added++;
  }
  await loadWords();
  renderList();
  alert(`Добавлено: ${added}\nДубликатов: ${dup}\nПропущено (неверный формат): ${skipped}`);
}

async function exportWords() {
  const words = await dbGetAll('words');
  const text = words.map(w => `${w.hz}|${w.py}|${w.tr}`).join('\n');
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'chinese_words_export.txt';
  a.click();
  URL.revokeObjectURL(url);
}

// ==================== НАСТРОЙКИ (UI) ====================
async function openSettings() {
  const s = await getSettings();
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
    <div class="modal-bg" id="modalBg">
      <div class="modal">
        <h2>Настройки</h2>
        <label>Уведомления с (час)</label>
        <input id="sStart" type="number" min="0" max="23" value="${s.hourStart}">
        <label>Уведомления до (час)</label>
        <input id="sEnd" type="number" min="1" max="24" value="${s.hourEnd}">
        <label>Запросить разрешение на уведомления</label>
        <button class="btn-secondary" id="sPerm" style="width:100%;padding:10px;border:none;border-radius:8px;">Разрешить уведомления</button>
        <div class="error hidden" id="sErr"></div>
        <div class="row">
          <button class="btn-secondary" id="sCancel">Отмена</button>
          <button class="btn-primary" id="sSave">Сохранить</button>
        </div>
      </div>
    </div>
  `;
  const close = () => root.innerHTML = '';
  document.getElementById('modalBg').addEventListener('click', e => {
    if (e.target.id === 'modalBg') close();
  });
  document.getElementById('sCancel').addEventListener('click', close);
  document.getElementById('sPerm').addEventListener('click', async () => {
    const perm = await Notification.requestPermission();
    alert('Разрешение: ' + perm);
  });
  document.getElementById('sSave').addEventListener('click', async () => {
    const start = parseInt(document.getElementById('sStart').value);
    const end = parseInt(document.getElementById('sEnd').value);
    if (isNaN(start) || isNaN(end) || start < 0 || end > 24 || start >= end) {
      const err = document.getElementById('sErr');
      err.textContent = 'Проверь часы: начало < конец, в пределах 0–24';
      err.classList.remove('hidden');
      return;
    }
    await saveSettings({ hourStart: start, hourEnd: end });
    close();
  });
}

// ==================== УВЕДОМЛЕНИЯ ====================
// PWA: setInterval в service worker не работает надёжно.
// Используем комбинацию: при открытии приложения планируем следующий показ,
// плюс service worker получает сообщение через postMessage и показывает
// уведомление по таймеру, пока жив (обычно живёт недолго в фоне).
// Реально надёжный способ для PWA — периодическая синхронизация
// (Periodic Background Sync), но она поддерживается не везде.
// Поэтому делаем так: при каждом открытии приложения ставим "будильник"
// через setTimeout на ближайший час, и записываем в настройки.
// Если приложение закрыто — уведомление придёт при следующем открытии.

let notifyTimer = null;

async function scheduleNextNotification() {
  if (notifyTimer) clearTimeout(notifyTimer);
  const s = await getSettings();
  const now = new Date();
  const hour = now.getHours();
  if (hour < s.hourStart || hour >= s.hourEnd) return;

  // Уведомление раз в час: вычислим, сколько осталось до следующего "ровного" часа
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  const delay = next - now;
  notifyTimer = setTimeout(() => {
    showRandomWordNotification();
    scheduleNextNotification();
  }, delay);
}

async function showRandomWordNotification() {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  const words = await dbGetAll('words');
  if (!words.length) return;
  // Приоритет: слова, у которых dueAt <= now
  const now = Date.now();
  const due = words.filter(w => (w.dueAt || 0) <= now);
  const pool = due.length ? due : words;
  const word = pool[Math.floor(Math.random() * pool.length)];
  const reg = await navigator.serviceWorker.ready;
  reg.showNotification(word.hz, {
    body: word.py,
    tag: 'chinese-word-' + word.id,
    data: { wordId: word.id },
    icon: 'icon.png',
    badge: 'icon.png',
  });
  await saveSettings({ lastNotifiedWordId: word.id, lastNotifyTime: Date.now() });
}

// Клик по уведомлению — открыть карточку слова
navigator.serviceWorker.addEventListener('message', e => {
  if (e.data && e.data.type === 'notification-click') {
    openWordModal(e.data.wordId);
  }
});

// ==================== СТАРТ ====================
async function init() {
  await openDB();
  await loadWords();
  renderList();

  document.getElementById('searchInput').addEventListener('input', e => {
    searchQuery = e.target.value;
    renderList();
  });
  document.getElementById('addBtn').addEventListener('click', () => openWordModal(null));
  document.getElementById('importBtn').addEventListener('click', importWords);
  document.getElementById('exportBtn').addEventListener('click', exportWords);
  document.getElementById('settingsBtn').addEventListener('click', openSettings);

  // Регистрируем SW
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('sw.js');
    } catch (e) { console.warn('SW reg failed', e); }
  }

  // Запрашиваем разрешение (если ещё не дано)
  if ('Notification' in window && Notification.permission === 'default') {
    // Не сразу, а через 3 секунды после старта
    setTimeout(() => Notification.requestPermission(), 3000);
  }

  // Планируем уведомления и обновляем при возврате в приложение
  scheduleNextNotification();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleNextNotification();
  });
}

init();