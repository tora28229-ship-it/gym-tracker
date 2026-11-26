const STORAGE_KEY = 'anytime_visit_records_v1';
const HOME_STORE_KEY = 'anytime_home_store_v1';
const STORAGE_KEY_V2 = 'anytime_transfer_sim_v2';

const STORES = {
  nagamineminami: {
    id: 'nagamineminami',
    name: '長嶺南',
    shortName: '長嶺',
    color: '#7c3aed',
    dotClass: 'dot-nagamine'
  },
  kurokami: {
    id: 'kurokami',
    name: '黒髪',
    shortName: '黒髪',
    color: '#0891b2',
    dotClass: 'dot-kurokami'
  },
  higashimachi: {
    id: 'higashimachi',
    name: '東町',
    shortName: '東町',
    color: '#f59e0b',
    dotClass: 'dot-higashi'
  },
  hakata3: {
    id: 'hakata3',
    name: '博多三丁目',
    shortName: '博多',
    color: '#ec4899',
    dotClass: 'dot-hakata3'
  },
  shinoe: {
    id: 'shinoe',
    name: '新大江',
    shortName: '新大江',
    color: '#10b981',
    dotClass: 'dot-shinoe'
  }
};

const STORE_ORDER = ['nagamineminami', 'kurokami', 'higashimachi', 'hakata3', 'shinoe'];
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

// ==========================================
// Date Utilities
// ==========================================
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

function addDaysKey(dateStr, delta) {
  const d = parseDateKey(dateStr);
  d.setDate(d.getDate() + delta);
  return formatDateKey(d);
}

function formatJapaneseDate(dateStr) {
  const d = parseDateKey(dateStr);
  return `${d.getMonth() + 1}月${d.getDate()}日(${WEEKDAYS[d.getDay()]})`;
}

// ==========================================
// State & Persistence (Compatible with v1 & v2)
// ==========================================
const todayDate = new Date();
todayDate.setHours(0, 0, 0, 0);
const todayKey = formatDateKey(todayDate);

let selectedDateKey = todayKey;
let currentCalendarYear = todayDate.getFullYear();
let currentCalendarMonth = todayDate.getMonth();
let activeBlockIndex = 0; // 0: 0-29日前, 1: 30-59日前, 2: 60-89日前
let homeStoreId = loadHomeStore();
let records = loadRecords();
let toastTimer = null;

function loadHomeStore() {
  try {
    const saved = localStorage.getItem(HOME_STORE_KEY);
    if (saved && STORES[saved]) return saved;
    const rawV2 = localStorage.getItem(STORAGE_KEY_V2);
    if (rawV2) {
      const v2 = JSON.parse(rawV2);
      if (v2 && v2.homeStoreId && STORES[v2.homeStoreId]) {
        return v2.homeStoreId;
      }
    }
  } catch (e) {
    console.error(e);
  }
  return 'nagamineminami';
}

function saveHomeStore() {
  try {
    localStorage.setItem(HOME_STORE_KEY, homeStoreId);
  } catch (e) {
    console.error(e);
  }
}

function loadRecords() {
  try {
    const rawV1 = localStorage.getItem(STORAGE_KEY);
    const loaded = rawV1 ? JSON.parse(rawV1) : {};
    // Also merge non-dummy v2 records if present and v1 is empty
    if (Object.keys(loaded).length === 0) {
      const rawV2 = localStorage.getItem(STORAGE_KEY_V2);
      if (rawV2) {
        const v2 = JSON.parse(rawV2);
        if (v2 && !v2.dummyModeName && Array.isArray(v2.visits)) {
          v2.visits.forEach(v => {
            if (v && v.date && STORES[v.storeId]) {
              loaded[v.date] = v.storeId;
            }
          });
        }
      }
    }
    return loaded;
  } catch (e) {
    console.error('Failed to load records:', e);
    return {};
  }
}

function saveRecords() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch (e) {
    console.error('Failed to save records:', e);
  }
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 2000);
}

// ==========================================
// Rolling 30-Day Transfer Judgment Logic
// ==========================================
function evaluateBlocks() {
  const blockDefs = [
    { index: 0, title: '直近30日間の店舗割合', startOffset: 29, endOffset: 0 },
    { index: 1, title: '30〜59日前の店舗割合', startOffset: 59, endOffset: 30 },
    { index: 2, title: '60〜89日前の店舗割合', startOffset: 89, endOffset: 60 }
  ];

  const blocks = blockDefs.map(def => {
    const startKey = addDaysKey(todayKey, -def.startOffset);
    const endKey = addDaysKey(todayKey, -def.endOffset);
    const keys = [];
    for (let i = def.endOffset; i <= def.startOffset; i++) {
      keys.push(addDaysKey(todayKey, -i));
    }

    const counts = {};
    STORE_ORDER.forEach(id => { counts[id] = 0; });

    let total = 0;
    keys.forEach(k => {
      const stId = records[k];
      if (stId && STORES[stId]) {
        counts[stId]++;
        total++;
      }
    });

    const byStore = {};
    const stats = STORE_ORDER.map(id => {
      const count = counts[id];
      const exactPct = total > 0 ? (count / total) * 100 : 0;
      const pct = total > 0 ? Math.round(exactPct) : 0;
      const isHome = id === homeStoreId;
      // Exact integer comparison for >= 51%
      const over51 = !isHome && total > 0 && count * 100 >= 51 * total;
      const metA = !isHome && total >= 4 && over51;
      const metB = !isHome && total >= 1 && count === total;

      let visitsForA = 0;
      if (!isHome) {
        for (let m = 0; m <= 100; m++) {
          if (total + m >= 4 && (count + m) * 100 >= 51 * (total + m)) {
            visitsForA = m;
            break;
          }
        }
      }

      const item = {
        ...STORES[id],
        count,
        pct,
        exactPct,
        isHome,
        over51,
        metA,
        metB,
        visitsForA
      };
      byStore[id] = item;
      return item;
    });

    const hasAlertA = stats.some(s => s.metA);
    const hasAlertB = stats.some(s => s.metB);

    return {
      ...def,
      startKey,
      endKey,
      keys,
      total,
      stats,
      byStore,
      hasAlertA,
      hasAlertB
    };
  });

  // Evaluate each non-home store across blocks
  const others = STORE_ORDER.filter(id => id !== homeStoreId);
  const established = [];
  const reaches = [];

  others.forEach(id => {
    const b1 = blocks[0].byStore[id];
    const b2 = blocks[1].byStore[id];
    const b3 = blocks[2].byStore[id];
    const T1 = blocks[0].total;

    const condA = b1.metA && b2.metA;
    const condB = b1.metB && b2.metB && b3.metB;

    // Home visits needed in Block 1 to avoid both Cond A & Cond B in Block 1
    let homeToAvoid = 0;
    for (let k = 0; k <= 100; k++) {
      const simT = T1 + k;
      const simA = simT >= 4 && b1.count * 100 >= 51 * simT;
      const simB = simT >= 1 && b1.count === simT;
      if (!simA && !simB) {
        homeToAvoid = k;
        break;
      }
    }

    if (condA || condB) {
      established.push({
        store: STORES[id],
        condA,
        condB,
        homeToAvoid,
        b1
      });
    } else if (b2.metA) {
      reaches.push({
        priority: 1,
        store: STORES[id],
        text: `あと${b1.visitsForA}回で移籍成立`,
        pill: homeToAvoid > 0 ? `${STORES[homeStoreId].shortName}+${homeToAvoid}回で回避` : '要注意'
      });
    } else if (b2.metB && b3.metB && T1 === 0) {
      reaches.push({
        priority: 2,
        store: STORES[id],
        text: `あと1回で移籍成立`,
        pill: `${STORES[homeStoreId].shortName}+1回で回避`
      });
    } else if (b1.metA) {
      reaches.push({
        priority: 3,
        store: STORES[id],
        text: `直近30日 ${b1.pct}%（条件達成中）`,
        pill: `${STORES[homeStoreId].shortName}+${homeToAvoid}回で51%未満`
      });
    } else if (b1.metB && b2.metB) {
      reaches.push({
        priority: 4,
        store: STORES[id],
        text: `60日連続100%利用中`,
        pill: `${STORES[homeStoreId].shortName}+1回で回避`
      });
    } else if (b1.visitsForA === 1 && b1.count >= 2) {
      reaches.push({
        priority: 5,
        store: STORES[id],
        text: `直近30日あと1回で51%超`,
        pill: 'リーチ'
      });
    }
  });

  reaches.sort((a, b) => a.priority - b.priority);

  return { blocks, established, reaches };
}

// ==========================================
// Handlers
// ==========================================
function handleStoreTap(storeId) {
  const currentStore = records[selectedDateKey];
  const dateLabel = selectedDateKey === todayKey ? '今日' : formatJapaneseDate(selectedDateKey);

  if (currentStore === storeId) {
    delete records[selectedDateKey];
    showToast(`${dateLabel}の記録を取り消しました`);
  } else {
    records[selectedDateKey] = storeId;
    showToast(`${dateLabel}：「${STORES[storeId].name}」を記録`);
  }

  saveRecords();
  renderAll();
}

function selectDate(dateKey) {
  if (dateKey > todayKey) return;
  selectedDateKey = dateKey;
  renderAll();
}

// ==========================================
// Rendering
// ==========================================
function renderStatusBanner(evalResult) {
  const card = document.getElementById('transfer-status-card');
  const icon = document.getElementById('status-icon');
  const title = document.getElementById('status-title');
  const sub = document.getElementById('status-sub');
  const pill = document.getElementById('status-action-pill');
  const homeName = STORES[homeStoreId].name;

  card.classList.remove('status-safe', 'status-warning', 'status-danger');

  if (evalResult.established.length > 0) {
    const top = evalResult.established[0];
    card.classList.add('status-danger');
    icon.textContent = '🚨';
    title.textContent = `移籍条件成立（${top.store.name}）`;
    sub.textContent = top.condA ? '直近60日連続 51%以上' : '90日連続 100%利用';
    pill.textContent = `${STORES[homeStoreId].shortName}+${top.homeToAvoid}回で回避`;
    pill.classList.remove('hidden');
  } else if (evalResult.reaches.length > 0) {
    const top = evalResult.reaches[0];
    card.classList.add('status-warning');
    icon.textContent = '⚠️';
    title.textContent = `リーチ：${top.store.name}`;
    sub.textContent = top.text;
    pill.textContent = top.pill;
    pill.classList.remove('hidden');
  } else {
    card.classList.add('status-safe');
    icon.textContent = '✅';
    title.textContent = `安全（${homeName}を維持）`;
    sub.textContent = '移籍対象外';
    pill.classList.add('hidden');
  }
}

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
    btn.classList.toggle('active', storeId === activeStore);
    const homeTag = btn.querySelector('.home-mini-tag');
    if (homeTag) {
      homeTag.classList.toggle('hidden', storeId !== homeStoreId);
    }
  });
}

function renderStatsSection(evalResult) {
  // Update block tab indicator dots
  evalResult.blocks.forEach((b, idx) => {
    const dot = document.getElementById(`tab-dot-${idx}`);
    dot.className = 'block-tab-dot';
    if (b.hasAlertA) dot.classList.add('dot-alert');
    else if (b.hasAlertB) dot.classList.add('dot-warn');
  });

  document.querySelectorAll('.block-tab').forEach(tab => {
    tab.classList.toggle('active', Number(tab.getAttribute('data-block')) === activeBlockIndex);
  });

  const block = evalResult.blocks[activeBlockIndex];
  document.getElementById('stats-heading').textContent = block.title;
  document.getElementById('stats-period-label').textContent =
    `${formatJapaneseDate(block.startKey)} 〜 ${formatJapaneseDate(block.endKey)}`;
  document.getElementById('total-visits-count').textContent = block.total;

  // Donut Chart
  const donutChart = document.getElementById('donut-chart');
  const topStoreLabel = document.getElementById('top-store-label');
  const topStorePct = document.getElementById('top-store-pct');

  if (block.total === 0) {
    donutChart.style.background = `conic-gradient(var(--color-empty) 0% 100%)`;
    topStoreLabel.textContent = '記録なし';
    topStorePct.textContent = '0%';
  } else {
    let acc = 0;
    const segments = [];
    // Place non-home stores first in stacked order for clarity
    const orderedForChart = [...block.stats].sort((a, b) => {
      if (a.isHome !== b.isHome) return a.isHome ? 1 : -1;
      return b.count - a.count;
    });
    orderedForChart.forEach(s => {
      if (s.exactPct > 0) {
        const start = acc;
        const end = acc + s.exactPct;
        segments.push(`${s.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`);
        acc = end;
      }
    });
    donutChart.style.background = `conic-gradient(${segments.join(', ')})`;

    const sorted = [...block.stats].sort((a, b) => b.count - a.count);
    const top = sorted[0];
    topStoreLabel.textContent = top.name;
    topStorePct.textContent = `${top.pct}%`;
  }

  // Breakdown List
  const breakdownList = document.getElementById('breakdown-list');
  breakdownList.innerHTML = block.stats.map(s => `
    <div class="breakdown-item ${s.metA ? 'over-51' : ''}">
      <div class="breakdown-left">
        <span class="store-dot ${s.dotClass}"></span>
        <span class="breakdown-name">${s.name}</span>
        ${s.isHome ? '<span class="breakdown-home-tag">所属</span>' : ''}
      </div>
      <div class="breakdown-right">
        <span class="breakdown-count">${s.count}回</span>
        <span class="breakdown-pct" style="color: ${s.count > 0 ? s.color : 'var(--text-sub)'}">${s.pct}%</span>
      </div>
    </div>
  `).join('');

  // Stacked Horizontal Bar
  const stackedBar = document.getElementById('stacked-bar');
  if (block.total === 0) {
    stackedBar.innerHTML = `<div class="stacked-empty">記録なし</div>`;
  } else {
    const barOrder = [...block.stats]
      .filter(s => s.exactPct > 0)
      .sort((a, b) => {
        if (a.isHome !== b.isHome) return a.isHome ? 1 : -1;
        return b.count - a.count;
      });
    stackedBar.innerHTML = barOrder
      .map(s => `<div class="stacked-segment" style="width:${s.exactPct}%; background:${s.color};" title="${s.name}: ${s.pct}%"></div>`)
      .join('');
  }
}

function renderCalendarSection(evalResult) {
  document.getElementById('current-month-label').textContent =
    `${currentCalendarYear}年${currentCalendarMonth + 1}月`;

  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = '';

  const firstDay = new Date(currentCalendarYear, currentCalendarMonth, 1);
  const lastDay = new Date(currentCalendarYear, currentCalendarMonth + 1, 0);
  const startDayOfWeek = firstDay.getDay();
  const totalDays = lastDay.getDate();

  const activeWindowSet = new Set(evalResult.blocks[activeBlockIndex].keys);

  for (let i = 0; i < startDayOfWeek; i++) {
    const emptyCell = document.createElement('div');
    emptyCell.className = 'cal-day empty';
    grid.appendChild(emptyCell);
  }

  for (let day = 1; day <= totalDays; day++) {
    const cellDate = new Date(currentCalendarYear, currentCalendarMonth, day);
    const dateKey = formatDateKey(cellDate);
    const cell = document.createElement('div');
    cell.className = 'cal-day';

    const isFuture = dateKey > todayKey;
    if (isFuture) cell.classList.add('future');
    if (dateKey === todayKey) cell.classList.add('today');
    if (dateKey === selectedDateKey) cell.classList.add('selected');
    if (activeWindowSet.has(dateKey)) cell.classList.add('in-window');

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
  document.getElementById('home-store-select').value = homeStoreId;
  const evalResult = evaluateBlocks();
  renderStatusBanner(evalResult);
  renderCheckinSection();
  renderStatsSection(evalResult);
  renderCalendarSection(evalResult);
}

// ==========================================
// Init
// ==========================================
function init() {
  document.getElementById('home-store-select').addEventListener('change', e => {
    homeStoreId = e.target.value;
    saveHomeStore();
    renderAll();
    showToast(`所属店舗を「${STORES[homeStoreId].name}」に変更`);
  });

  document.querySelectorAll('.store-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      handleStoreTap(btn.getAttribute('data-store'));
    });
  });

  document.getElementById('back-to-today-btn').addEventListener('click', () => {
    selectedDateKey = todayKey;
    currentCalendarYear = todayDate.getFullYear();
    currentCalendarMonth = todayDate.getMonth();
    renderAll();
  });

  document.querySelectorAll('.block-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      activeBlockIndex = Number(tab.getAttribute('data-block'));
      renderAll();
    });
  });

  document.getElementById('prev-month-btn').addEventListener('click', () => {
    currentCalendarMonth--;
    if (currentCalendarMonth < 0) {
      currentCalendarMonth = 11;
      currentCalendarYear--;
    }
    renderAll();
  });

  document.getElementById('next-month-btn').addEventListener('click', () => {
    currentCalendarMonth++;
    if (currentCalendarMonth > 11) {
      currentCalendarMonth = 0;
      currentCalendarYear++;
    }
    renderAll();
  });

  renderAll();
}

document.addEventListener('DOMContentLoaded', init);
