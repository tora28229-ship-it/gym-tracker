const STORAGE_KEY = 'anytime_visit_records_v1';

const STORES = {
  nagamineminami: {
    id: 'nagamineminami',
    name: '長嶺南',
    shortName: '長嶺',
    color: '#8b5cf6',
    dotClass: 'dot-nagamine'
  },
  kurokami: {
    id: 'kurokami',
    name: '黒髪',
    shortName: '黒髪',
    color: '#06b6d4',
    dotClass: 'dot-kurokami'
  },
  higashimachi: {
    id: 'higashimachi',
    name: '東町',
    shortName: '東町',
    color: '#f59e0b',
    dotClass: 'dot-higashi'
  },
  shinoe: {
    id: 'shinoe',
    name: '新大江',
    shortName: '新大江',
    color: '#10b981',
    dotClass: 'dot-shinoe'
  },
  hakata3: {
    id: 'hakata3',
    name: '博多三丁目',
    shortName: '博多',
    color: '#ec4899',
    dotClass: 'dot-hakata3'
  }
};

const STORE_ORDER = ['nagamineminami', 'kurokami', 'higashimachi', 'shinoe', 'hakata3'];
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

// Format Date to YYYY-MM-DD in local time
function formatDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDateKey(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatJapaneseDate(dateStr) {
  const d = parseDateKey(dateStr);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const w = WEEKDAYS[d.getDay()];
  return `${m}月${day}日(${w})`;
}

// State
const todayDate = new Date();
todayDate.setHours(0, 0, 0, 0);
const todayKey = formatDateKey(todayDate);

let selectedDateKey = todayKey;
let currentCalendarYear = todayDate.getFullYear();
let currentCalendarMonth = todayDate.getMonth(); // 0-indexed
let records = loadRecords();
let toastTimer = null;

function loadRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error('Failed to load records from localStorage:', e);
    return {};
  }
}

function saveRecords() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch (e) {
    console.error('Failed to save records to localStorage:', e);
  }
}

// Generate the array of date keys for the past 30 days (including today)
function getPast30DaysKeys() {
  const keys = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(todayDate);
    d.setDate(todayDate.getDate() - i);
    keys.push(formatDateKey(d));
  }
  return keys;
}

// Show Toast feedback
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 2200);
}

// Handle Store Button Tap
function handleStoreTap(storeId) {
  const currentStore = records[selectedDateKey];
  const dateLabel = selectedDateKey === todayKey ? '今日' : formatJapaneseDate(selectedDateKey);

  if (currentStore === storeId) {
    delete records[selectedDateKey];
    showToast(`${dateLabel}の記録を取り消しました`);
  } else {
    records[selectedDateKey] = storeId;
    showToast(`${dateLabel}：「${STORES[storeId].name}」を記録しました`);
  }

  saveRecords();
  renderAll();
}

// Select a specific date from the calendar
function selectDate(dateKey) {
  if (dateKey > todayKey) return; // Ignore future dates
  selectedDateKey = dateKey;
  renderAll();
}

// Render Check-in Card
function renderCheckinSection() {
  const badge = document.getElementById('selected-date-badge');
  const title = document.getElementById('selected-date-title');
  const backBtn = document.getElementById('back-to-today-btn');

  if (selectedDateKey === todayKey) {
    badge.textContent = 'TODAY';
    badge.classList.remove('past-mode');
    title.textContent = `今日（${formatJapaneseDate(todayKey)}）の来店記録`;
    backBtn.classList.add('hidden');
  } else {
    badge.textContent = '過去日の編集';
    badge.classList.add('past-mode');
    title.textContent = `${formatJapaneseDate(selectedDateKey)} の来店記録`;
    backBtn.classList.remove('hidden');
  }

  const activeStore = records[selectedDateKey] || null;
  document.querySelectorAll('.store-btn').forEach(btn => {
    const storeId = btn.getAttribute('data-store');
    if (storeId === activeStore) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

// Render 30-day Percentage Stats & Charts
function renderStatsSection() {
  const past30Keys = getPast30DaysKeys();
  const oldestKey = past30Keys[past30Keys.length - 1];

  const periodLabel = document.getElementById('stats-period-label');
  periodLabel.textContent = `${formatJapaneseDate(oldestKey)} 〜 ${formatJapaneseDate(todayKey)}`;

  const counts = {
    nagamineminami: 0,
    kurokami: 0,
    higashimachi: 0,
    shinoe: 0,
    hakata3: 0
  };

  let totalVisits = 0;
  for (const key of past30Keys) {
    const storeId = records[key];
    if (storeId && counts[storeId] !== undefined) {
      counts[storeId]++;
      totalVisits++;
    }
  }

  document.getElementById('total-visits-count').textContent = totalVisits;

  // Calculate percentages
  const stats = STORE_ORDER.map(id => {
    const count = counts[id];
    const pct = totalVisits > 0 ? Math.round((count / totalVisits) * 100) : 0;
    const exactPct = totalVisits > 0 ? (count / totalVisits) * 100 : 0;
    return {
      ...STORES[id],
      count,
      pct,
      exactPct
    };
  });

  // Render Donut Chart
  const donutChart = document.getElementById('donut-chart');
  const topStoreLabel = document.getElementById('top-store-label');
  const topStorePct = document.getElementById('top-store-pct');

  if (totalVisits === 0) {
    donutChart.style.background = `conic-gradient(var(--color-empty) 0% 100%)`;
    topStoreLabel.textContent = '記録なし';
    topStorePct.textContent = '0%';
  } else {
    let acc = 0;
    const segments = [];
    for (const s of stats) {
      if (s.exactPct > 0) {
        const start = acc;
        const end = acc + s.exactPct;
        segments.push(`${s.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`);
        acc = end;
      }
    }
    donutChart.style.background = `conic-gradient(${segments.join(', ')})`;

    // Find top visited store
    const sorted = [...stats].sort((a, b) => b.count - a.count);
    const top = sorted[0];
    topStoreLabel.textContent = `最多: ${top.name}`;
    topStorePct.textContent = `${top.pct}%`;
  }

  // Render Breakdown List
  const breakdownList = document.getElementById('breakdown-list');
  breakdownList.innerHTML = stats.map(s => `
    <div class="breakdown-item">
      <div class="breakdown-left">
        <span class="store-dot ${s.dotClass}"></span>
        <span class="breakdown-name">${s.name}</span>
      </div>
      <div class="breakdown-right">
        <span class="breakdown-count">${s.count}回</span>
        <span class="breakdown-pct" style="color: ${s.count > 0 ? s.color : 'var(--text-sub)'}">${s.pct}%</span>
      </div>
    </div>
  `).join('');

  // Render Stacked Horizontal Bar
  const stackedBar = document.getElementById('stacked-bar');
  if (totalVisits === 0) {
    stackedBar.innerHTML = `<div class="stacked-empty">店舗をタップすると割合グラフが表示されます</div>`;
  } else {
    stackedBar.innerHTML = stats
      .filter(s => s.exactPct > 0)
      .map(s => `<div class="stacked-segment" style="width: ${s.exactPct}%; background: ${s.color};" title="${s.name}: ${s.pct}% (${s.count}回)"></div>`)
      .join('');
  }
}

// Render Calendar Section
function renderCalendarSection() {
  const monthLabel = document.getElementById('current-month-label');
  monthLabel.textContent = `${currentCalendarYear}年${currentCalendarMonth + 1}月`;

  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = '';

  const firstDay = new Date(currentCalendarYear, currentCalendarMonth, 1);
  const lastDay = new Date(currentCalendarYear, currentCalendarMonth + 1, 0);
  const startDayOfWeek = firstDay.getDay();
  const totalDays = lastDay.getDate();

  const past30Set = new Set(getPast30DaysKeys());

  // Leading empty cells
  for (let i = 0; i < startDayOfWeek; i++) {
    const emptyCell = document.createElement('div');
    emptyCell.className = 'cal-day empty';
    grid.appendChild(emptyCell);
  }

  // Days of month
  for (let day = 1; day <= totalDays; day++) {
    const cellDate = new Date(currentCalendarYear, currentCalendarMonth, day);
    const dateKey = formatDateKey(cellDate);
    const cell = document.createElement('div');
    cell.className = 'cal-day';

    const isFuture = dateKey > todayKey;
    if (isFuture) cell.classList.add('future');
    if (dateKey === todayKey) cell.classList.add('today');
    if (dateKey === selectedDateKey) cell.classList.add('selected');
    if (past30Set.has(dateKey)) cell.classList.add('in-window');

    const numSpan = document.createElement('span');
    numSpan.className = 'cal-day-num';
    numSpan.textContent = day;
    cell.appendChild(numSpan);

    const storeId = records[dateKey];
    if (storeId && STORES[storeId]) {
      const badge = document.createElement('span');
      badge.className = `cal-badge ${storeId}`;
      badge.textContent = STORES[storeId].shortName;
      cell.appendChild(badge);
    }

    if (!isFuture) {
      cell.addEventListener('click', () => selectDate(dateKey));
    }

    grid.appendChild(cell);
  }
}

function renderAll() {
  renderCheckinSection();
  renderStatsSection();
  renderCalendarSection();
}

// Initialize App
function init() {
  document.getElementById('today-date-label').textContent = formatJapaneseDate(todayKey);

  // Store button listeners
  document.querySelectorAll('.store-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const storeId = btn.getAttribute('data-store');
      handleStoreTap(storeId);
    });
  });

  // Back to today button
  document.getElementById('back-to-today-btn').addEventListener('click', () => {
    selectedDateKey = todayKey;
    currentCalendarYear = todayDate.getFullYear();
    currentCalendarMonth = todayDate.getMonth();
    renderAll();
  });

  // Calendar month navigation
  document.getElementById('prev-month-btn').addEventListener('click', () => {
    currentCalendarMonth--;
    if (currentCalendarMonth < 0) {
      currentCalendarMonth = 11;
      currentCalendarYear--;
    }
    renderCalendarSection();
  });

  document.getElementById('next-month-btn').addEventListener('click', () => {
    currentCalendarMonth++;
    if (currentCalendarMonth > 11) {
      currentCalendarMonth = 0;
      currentCalendarYear++;
    }
    renderCalendarSection();
  });

  renderAll();
}

document.addEventListener('DOMContentLoaded', init);
