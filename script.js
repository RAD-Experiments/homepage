const gradientPalettes = [
  ['#ffecd2', '#fcb69f', '#fad0c4', '#cfd9df'],
  ['#F5EFFF', '#E5D9F2', '#CDC1FF', '#A294F9'],
  ['#ffdbdb', '#f4d6df', '#e9d1e3', '#decce7'],
  ['#F08787', '#FFC7A7', '#FEE2AD', '#F8FAB4'],
  ['#fbf1f4', '#fbe0e0', '#f2a4ab', '#c22b62'],
  ['#e9e8ee', '#7ab7fe', '#66c1f4', '#1d6af9'],
  ['#faf4f9', '#f5d5d4', '#ffb8ae', '#db584e'],
  ['#f8f3ef', '#b8e797', '#90d417', '#249456']
];

const STORAGE_KEYS = {
  sheetUrl: 'quoteSheetUrl',
  quoteOfDay: 'quoteOfDay',
  quoteList: 'quoteList',
  quoteListFetchedAt: 'quoteListFetchedAt'
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const elements = {
  quoteText: document.getElementById('quote-text'),
  quoteDate: document.getElementById('quote-date'),
  quoteCard: document.querySelector('.quote-card'),
  resetButton: document.getElementById('reset-button'),
  fetchStatus: document.getElementById('fetch-status'),
  modal: document.getElementById('setup-modal'),
  modalForm: document.getElementById('modal-form'),
  sheetInput: document.getElementById('sheet-url'),
  urlError: document.getElementById('url-error'),
  updateToast: document.getElementById('update-toast'),
  updateToastButton: document.getElementById('update-toast-button')
};

let lastFocusedElement = null;
let serviceWorkerRegistration = null;
let waitingServiceWorker = null;
let isUpdateToastVisible = false;
let hasShownUpdateToast = false;
let hasRegisteredControllerChangeListener = false;
let hasReloadedAfterControllerChange = false;
let hasBoundUpdateListener = false;

document.addEventListener('DOMContentLoaded', () => {
  applyRandomGradient();
  initializeModalState();
  bindEventListeners();
  renderStoredQuoteIfAvailable();

  const sheetUrl = loadSheetUrl();
  if (!sheetUrl) {
    showModal();
  } else {
    ensureQuoteForToday();
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', registerServiceWorker);
  }
});

function initializeModalState() {
  if (elements.modal) {
    elements.modal.setAttribute('aria-hidden', 'true');
  }
}

function bindEventListeners() {
  if (elements.modalForm) {
    elements.modalForm.addEventListener('submit', handleModalSubmit);
  }

  if (elements.resetButton) {
    elements.resetButton.addEventListener('click', handleReset);
  }

  if (elements.updateToastButton) {
    elements.updateToastButton.addEventListener(
      'click',
      handleUpdateToastButtonClick
    );
  }

  if (elements.modal) {
    elements.modal.addEventListener('keydown', trapModalFocus);
  }
}

function renderStoredQuoteIfAvailable() {
  const storedQuote = loadStoredQuoteOfDay();
  if (storedQuote && storedQuote.text) {
    renderQuote(storedQuote.text, storedQuote.date);
  } else {
    renderQuote('', '');
  }
}

function applyRandomGradient() {
  const palette =
    gradientPalettes[Math.floor(Math.random() * gradientPalettes.length)];
  const gradients = [
    `radial-gradient(circle at top left, ${palette[0]} 0%, transparent 60%)`,
    `radial-gradient(circle at top right, ${palette[1]} 0%, transparent 60%)`,
    `radial-gradient(circle at bottom left, ${palette[2]} 0%, transparent 60%)`,
    `radial-gradient(circle at bottom right, ${palette[3]} 0%, transparent 60%)`
  ];

  document.body.style.background = gradients.join(', ');
  document.body.style.backgroundColor = blendAverageColor(palette);
  document.body.style.backgroundRepeat = 'no-repeat';
  document.body.style.backgroundAttachment = 'fixed';

  const avgColor = blendAverageColor(palette);
  const brightness = perceivedBrightness(hexToRgb(avgColor));
  const textColor = brightness > 0.6 ? '#1a1a1a' : '#ffffff';
  document.documentElement.style.setProperty('--quote-color', textColor);

  if (textColor === '#ffffff') {
    document.documentElement.style.setProperty(
      '--card-backdrop',
      'rgba(0, 0, 0, 0.35)'
    );
    document.documentElement.style.setProperty(
      '--card-shadow',
      '0 20px 45px rgba(0, 0, 0, 0.35)'
    );
  } else {
    document.documentElement.style.setProperty(
      '--card-backdrop',
      'rgba(255, 255, 255, 0.4)'
    );
    document.documentElement.style.setProperty(
      '--card-shadow',
      '0 20px 45px rgba(0, 0, 0, 0.15)'
    );
  }
}

function hexToRgb(hex) {
  const sanitized = hex.replace('#', '');
  const normalized =
    sanitized.length === 3
      ? sanitized
          .split('')
          .map((char) => char + char)
          .join('')
      : sanitized;
  const bigint = parseInt(normalized, 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255
  };
}

function perceivedBrightness({ r, g, b }) {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function blendAverageColor(palette) {
  const totals = palette.reduce(
    (acc, color) => {
      const { r, g, b } = hexToRgb(color);
      acc.r += r;
      acc.g += g;
      acc.b += b;
      return acc;
    },
    { r: 0, g: 0, b: 0 }
  );
  const avg = {
    r: Math.round(totals.r / palette.length),
    g: Math.round(totals.g / palette.length),
    b: Math.round(totals.b / palette.length)
  };
  return rgbToHex(avg);
}

function rgbToHex({ r, g, b }) {
  const toHex = (value) => value.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function handleModalSubmit(event) {
  event.preventDefault();
  clearModalError();
  const rawValue = elements.sheetInput.value.trim();

  if (!rawValue) {
    displayModalError('Adres URL jest wymagany.');
    return;
  }

  try {
    const sanitizedUrl = sanitizeSheetUrl(rawValue);
    localStorage.setItem(STORAGE_KEYS.sheetUrl, sanitizedUrl);
    hideModal();
    setFetchStatus('Pobieranie cytatów…');
    ensureQuoteForToday();
  } catch (error) {
    displayModalError(error.message || 'Podano nieprawidłowy adres URL.');
  }
}

function sanitizeSheetUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error('Podaj poprawny adres URL.');
  }

  if (url.protocol !== 'https:') {
    throw new Error('Adres musi zaczynać się od https://');
  }

  if (url.hostname !== 'docs.google.com') {
    throw new Error('Adres musi wskazywać na docs.google.com');
  }

  return url.toString();
}

function displayModalError(message) {
  if (elements.urlError) {
    elements.urlError.textContent = message;
  }
}

function clearModalError() {
  if (elements.urlError) {
    elements.urlError.textContent = '';
  }
}

function showModal() {
  if (!elements.modal) return;
  lastFocusedElement = document.activeElement;
  elements.modal.classList.remove('hidden');
  elements.modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  elements.sheetInput.value = loadSheetUrl() || '';
  clearModalError();
  requestAnimationFrame(() => {
    elements.sheetInput.focus();
    elements.sheetInput.select();
  });
}

function hideModal() {
  if (!elements.modal) return;
  elements.modal.classList.add('hidden');
  elements.modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
    lastFocusedElement.focus();
  } else if (elements.quoteCard) {
    elements.quoteCard.focus();
  }
  lastFocusedElement = null;
}

function trapModalFocus(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
  }

  if (event.key !== 'Tab') {
    return;
  }

  const focusableSelectors =
    'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';
  const focusableElements = Array.from(
    elements.modal.querySelectorAll(focusableSelectors)
  ).filter((el) => !el.hasAttribute('disabled'));

  if (!focusableElements.length) {
    event.preventDefault();
    return;
  }

  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];

  if (!event.shiftKey && document.activeElement === lastElement) {
    event.preventDefault();
    firstElement.focus();
  } else if (event.shiftKey && document.activeElement === firstElement) {
    event.preventDefault();
    lastElement.focus();
  }
}

function handleReset() {
  Object.values(STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
  renderQuote('', '');
  setFetchStatus('Podaj nowy adres arkusza, aby kontynuować.');
  showModal();
}

function setFetchStatus(message, isError = false) {
  if (!elements.fetchStatus) return;
  elements.fetchStatus.textContent = message || '';
  elements.fetchStatus.classList.toggle('is-error', Boolean(isError));
}

function loadSheetUrl() {
  return localStorage.getItem(STORAGE_KEYS.sheetUrl);
}

function loadStoredQuoteOfDay() {
  const raw = localStorage.getItem(STORAGE_KEYS.quoteOfDay);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.text === 'string' && parsed.date) {
      return parsed;
    }
  } catch (error) {
    console.warn('Nie można odczytać zapisanego cytatu dnia.', error);
  }
  return null;
}

function saveQuoteOfDay(value) {
  localStorage.setItem(STORAGE_KEYS.quoteOfDay, JSON.stringify(value));
}

function loadStoredQuoteList() {
  const raw = localStorage.getItem(STORAGE_KEYS.quoteList);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    console.warn('Nie można odczytać zapisanej listy cytatów.', error);
    return null;
  }
}

function saveQuoteList(list) {
  localStorage.setItem(STORAGE_KEYS.quoteList, JSON.stringify(list));
  localStorage.setItem(STORAGE_KEYS.quoteListFetchedAt, new Date().toISOString());
}

function shouldFetchQuotes(lastFetchedAt) {
  if (!lastFetchedAt) return true;
  const lastFetchedDate = new Date(lastFetchedAt);
  if (Number.isNaN(lastFetchedDate.getTime())) {
    return true;
  }
  return Date.now() - lastFetchedDate.getTime() > DAY_IN_MS;
}

async function ensureQuoteForToday() {
  const sheetUrl = loadSheetUrl();
  if (!sheetUrl) {
    showModal();
    return;
  }

  let quoteOfDay = loadStoredQuoteOfDay();
  const todayKey = getTodayKey();

  let quoteList = loadStoredQuoteList();
  const lastFetchedAt = localStorage.getItem(STORAGE_KEYS.quoteListFetchedAt);
  const needsFetch =
    !quoteList || !quoteList.length || shouldFetchQuotes(lastFetchedAt);

  if (needsFetch) {
    try {
      setFetchStatus('Pobieranie nowych cytatów…');
      const fetchedQuotes = await fetchQuotes(sheetUrl);
      if (fetchedQuotes.length) {
        quoteList = fetchedQuotes;
        saveQuoteList(fetchedQuotes);
        setFetchStatus('');
      } else {
        setFetchStatus('W arkuszu nie znaleziono cytatów.', true);
      }
    } catch (error) {
      console.error('Błąd pobierania arkusza Google.', error);
      setFetchStatus(
        'Nie udało się pobrać nowych cytatów. Wyświetlam ostatnio zapisane.',
        true
      );
      quoteList = loadStoredQuoteList() || quoteList;
    }
  }

  if (quoteOfDay && quoteOfDay.text && quoteOfDay.date === todayKey) {
    renderQuote(quoteOfDay.text, quoteOfDay.date);
    return;
  }

  if (!quoteList || !quoteList.length) {
    if (quoteOfDay && quoteOfDay.text) {
      renderQuote(quoteOfDay.text, quoteOfDay.date);
    } else {
      renderQuote(
        'Brak cytatów do wyświetlenia. Upewnij się, że arkusz zawiera dane.',
        ''
      );
    }
    return;
  }

  const newQuote = pickQuoteForToday(quoteList);
  quoteOfDay = {
    date: todayKey,
    text: newQuote
  };
  saveQuoteOfDay(quoteOfDay);
  renderQuote(newQuote, todayKey);
}

async function fetchQuotes(sheetUrl) {
  const response = await fetch(sheetUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Nie udało się pobrać arkusza (status ${response.status}).`);
  }
  const csvText = await response.text();
  const quotes = parseCsvQuotes(csvText);
  if (!quotes.length) {
    console.warn('Nie znaleziono cytatów w podanym arkuszu.');
  }
  return quotes;
}

function parseCsvQuotes(csvText) {
  const cleanText = csvText.replace(/^\uFEFF/, '');
  const lines = cleanText.split(/\r?\n/);
  if (!lines.length) return [];
  const dataLines = lines.slice(1);
  const quotes = [];

  for (const rawLine of dataLines) {
    if (!rawLine || !rawLine.trim()) continue;
    const cells = splitCsvLine(rawLine);
    const firstNonEmpty = cells.find((cell) => cell.trim() !== '');
    if (!firstNonEmpty) continue;
    const sanitized = firstNonEmpty
      .replace(/^"|"$/g, '')
      .replace(/""/g, '"')
      .trim();
    if (sanitized) {
      quotes.push(sanitized);
    }
  }

  return quotes;
}

function splitCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }

    current += char;
  }
  cells.push(current);
  return cells;
}

function pickQuoteForToday(quotes) {
  if (!quotes.length) return '';
  const index = Math.floor(Math.random() * quotes.length);
  return quotes[index];
}

function renderQuote(text, dateKey) {
  const cleanedText = typeof text === 'string' ? text.trim() : '';
  if (!cleanedText) {
    elements.quoteText.textContent = 'Tutaj pojawi się Twój cytat.';
    elements.quoteDate.textContent = '';
    return;
  }

  elements.quoteText.textContent = cleanedText;

  if (!dateKey) {
    elements.quoteDate.textContent = '';
    return;
  }

  const formattedDate = formatDateLabel(dateKey);
  if (formattedDate) {
    const label =
      dateKey === getTodayKey()
        ? `Dzisiejszy cytat — ${formattedDate}`
        : `Ostatnio zapisany cytat — ${formattedDate}`;
    elements.quoteDate.textContent = label;
  } else {
    elements.quoteDate.textContent = '';
  }
}

function formatDateLabel(dateKey) {
  if (!dateKey) return '';
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(date);
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function isServiceWorkerInWaitingState(worker) {
  return Boolean(worker && worker.state === 'installed');
}

function setWaitingServiceWorker(worker) {
  if (waitingServiceWorker === worker) {
    return;
  }

  if (waitingServiceWorker) {
    waitingServiceWorker.removeEventListener(
      'statechange',
      handleWaitingServiceWorkerStateChange
    );
  }

  waitingServiceWorker = worker || null;

  if (waitingServiceWorker) {
    waitingServiceWorker.addEventListener(
      'statechange',
      handleWaitingServiceWorkerStateChange
    );
  }
}

async function getCurrentWaitingWorker() {
  if (isServiceWorkerInWaitingState(waitingServiceWorker)) {
    return waitingServiceWorker;
  }

  if (
    serviceWorkerRegistration &&
    isServiceWorkerInWaitingState(serviceWorkerRegistration.waiting)
  ) {
    setWaitingServiceWorker(serviceWorkerRegistration.waiting);
    return serviceWorkerRegistration.waiting;
  }

  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.getRegistration) {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration && isServiceWorkerInWaitingState(registration.waiting)) {
      setupUpdateFlow(registration);
      return registration.waiting;
    }
  } catch (error) {
    console.warn('Nie udało się pobrać rejestracji Service Workera.', error);
  }

  return null;
}

function handleWaitingServiceWorkerStateChange(event) {
  const worker = event.target;
  if (!worker) {
    return;
  }

  if (worker.state === 'activated') {
    if (waitingServiceWorker === worker) {
      setWaitingServiceWorker(null);
    } else {
      worker.removeEventListener(
        'statechange',
        handleWaitingServiceWorkerStateChange
      );
    }
    triggerReload();
    return;
  }

  if (worker.state === 'redundant') {
    if (waitingServiceWorker === worker) {
      setWaitingServiceWorker(null);
    } else {
      worker.removeEventListener(
        'statechange',
        handleWaitingServiceWorkerStateChange
      );
    }
    const nextWaitingWorker =
      serviceWorkerRegistration && serviceWorkerRegistration.waiting;

    if (nextWaitingWorker && nextWaitingWorker !== worker) {
      setWaitingServiceWorker(nextWaitingWorker);
      showUpdateToast();
      return;
    }

    hideUpdateToast();
  }
}

function triggerReload() {
  if (hasReloadedAfterControllerChange) {
    return;
  }
  hasReloadedAfterControllerChange = true;
  window.location.reload();
}

function handleControllerChange() {
  triggerReload();
}

async function registerServiceWorker() {
  try {
    const registration = await navigator.serviceWorker.register(
      './service-worker.js'
    );
    serviceWorkerRegistration = registration;
    setupUpdateFlow(registration);
    addControllerChangeListener();
    navigator.serviceWorker.ready
      .then((readyRegistration) => {
        setupUpdateFlow(readyRegistration);
      })
      .catch((error) => {
        console.warn(
          'Nie udało się uzyskać aktywnej rejestracji Service Workera.',
          error
        );
      });
  } catch (error) {
    console.warn('Nie udało się zarejestrować Service Workera.', error);
  }
}

async function handleUpdateToastButtonClick() {
  const waitingWorker = await getCurrentWaitingWorker();

  if (!waitingWorker) {
    console.warn('Brak oczekującego Service Workera do aktywacji.');
    hideUpdateToast();
    return;
  }

  try {
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  } catch (error) {
    console.warn('Nie udało się wysłać komunikatu do Service Workera.', error);
    return;
  }

  if (elements.updateToastButton) {
    elements.updateToastButton.disabled = true;
    elements.updateToastButton.setAttribute('aria-disabled', 'true');
  }

  hideUpdateToast();
}

function showUpdateToast() {
  if (!elements.updateToast || isUpdateToastVisible) {
    return;
  }

  elements.updateToast.classList.remove('hidden');
  elements.updateToast.setAttribute('aria-hidden', 'false');
  isUpdateToastVisible = true;

  if (elements.updateToastButton) {
    elements.updateToastButton.disabled = false;
    elements.updateToastButton.removeAttribute('aria-disabled');
  }

  if (!hasShownUpdateToast && elements.updateToastButton) {
    elements.updateToastButton.focus();
    hasShownUpdateToast = true;
  }
}

function hideUpdateToast() {
  if (!elements.updateToast) {
    return;
  }

  elements.updateToast.classList.add('hidden');
  elements.updateToast.setAttribute('aria-hidden', 'true');
  isUpdateToastVisible = false;

  if (elements.updateToastButton) {
    elements.updateToastButton.removeAttribute('aria-disabled');
    elements.updateToastButton.disabled = false;
  }
}

function setupUpdateFlow(registration) {
  if (!registration) {
    return;
  }

  const isDifferentRegistration =
    serviceWorkerRegistration && serviceWorkerRegistration !== registration;

  serviceWorkerRegistration = registration;

  if (isDifferentRegistration) {
    hasBoundUpdateListener = false;
  }

  try {
    if (registration.waiting && navigator.serviceWorker.controller) {
      setWaitingServiceWorker(registration.waiting);
      showUpdateToast();
    }

    if (!hasBoundUpdateListener) {
      registration.addEventListener('updatefound', () => {
        const installingWorker = registration.installing;
        if (!installingWorker) {
          return;
        }

        installingWorker.addEventListener('statechange', () => {
          if (installingWorker.state !== 'installed') {
            return;
          }

          if (!navigator.serviceWorker.controller) {
            setWaitingServiceWorker(null);
            return;
          }

          const newWaitingWorker = registration.waiting || installingWorker;
          setWaitingServiceWorker(newWaitingWorker);
          showUpdateToast();
        });
      });
      hasBoundUpdateListener = true;
    }
  } catch (error) {
    console.warn(
      'Nie udało się skonfigurować obsługi aktualizacji Service Workera.',
      error
    );
  }
}

function addControllerChangeListener() {
  if (!('serviceWorker' in navigator) || hasRegisteredControllerChangeListener) {
    return;
  }

  navigator.serviceWorker.addEventListener(
    'controllerchange',
    handleControllerChange
  );

  hasRegisteredControllerChangeListener = true;
}
