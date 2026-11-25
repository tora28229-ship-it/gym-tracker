const STORAGE_KEY_V2 = 'anytime_transfer_sim_v2';
const LEGACY_KEY_V1 = 'anytime_visit_records_v1';
const REAL_BACKUP_KEY = 'anytime_transfer_sim_real_backup_v2';

const DEFAULT_STORES = [
  { id: 'nagamineminami', name: '長嶺南', shortName: '長嶺南', color: '#6d28d9' },
  { id: 'kurokami', name: '黒髪', shortName: '黒髪', color: '#0891b2' },
  { id: 'higashimachi', name: '東町', shortName: '東町', color: '#d97706' },
  { id: 'shinoe', name: '新大江', shortName: '新大江', color: '#059669' },
  { id: 'hakata3', name: '博多三丁目', shortName: '博多三', color: '#db2777' }
];

const EXTRA_COLORS = [
  '#2563eb', '#ea580c', '#4f46e5', '#0d9488', '#dc2626', '#9333ea', '#65a30d'
];

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

// ==========================================
// Date Utilities (Local Time YYYY-MM-DD)
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

function addDaysKey(dateStr, deltaDays) {
  const d = parseDateKey(dateStr);
  d.setDate(d.getDate() + deltaDays);
  return formatDateKey(d);
}

function diffDays(dateStrA, dateStrB) {
  const a = parseDateKey(dateStrA);
  const b = parseDateKey(dateStrB);
  return Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

function formatJpShort(dateStr) {
  const d = parseDateKey(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}

function formatJpFull(dateStr) {
  const d = parseDateKey(dateStr);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${WEEKDAYS[d.getDay()]})`;
}

function makeShortName(name) {
  const trimmed = name.trim();
  return trimmed.length <= 4 ? trimmed : trimmed.slice(0, 3);
}

function uid() {
  return 'v_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ==========================================
// App State & Migration from v1
// ==========================================
const todayObj = new Date();
todayObj.setHours(0, 0, 0, 0);
const todayKey = formatDateKey(todayObj);

let appState = loadInitialState();

// UI transient state
let refDateKey = todayKey;
let visitInputDateKey = todayKey;
let calYear = todayObj.getFullYear();
let calMonth = todayObj.getMonth();
let activeHistoryTab = 'calendar';
let selectedTargetStoreId = null;
let toastTimer = null;

function loadInitialState() {
  try {
    const rawV2 = localStorage.getItem(STORAGE_KEY_V2);
    if (rawV2) {
      const parsed = JSON.parse(rawV2);
      if (parsed && Array.isArray(parsed.stores) && Array.isArray(parsed.visits)) {
        return {
          homeStoreId: parsed.homeStoreId || parsed.stores[0]?.id || 'nagamineminami',
          stores: parsed.stores.length > 0 ? parsed.stores : [...DEFAULT_STORES],
          visits: parsed.visits,
          overwriteSameDay: parsed.overwriteSameDay !== undefined ? parsed.overwriteSameDay : true,
          dummyModeName: parsed.dummyModeName || null
        };
      }
    }

    // Migrate from v1 if present
    const migratedVisits = [];
    const rawV1 = localStorage.getItem(LEGACY_KEY_V1);
    if (rawV1) {
      const v1Obj = JSON.parse(rawV1);
      if (v1Obj && typeof v1Obj === 'object') {
        Object.entries(v1Obj).forEach(([dateKey, storeId]) => {
          if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey) && typeof storeId === 'string') {
            migratedVisits.push({
              id: 'mig_' + dateKey,
              date: dateKey,
              storeId
            });
          }
        });
      }
    }

    const initial = {
      homeStoreId: 'nagamineminami',
      stores: [...DEFAULT_STORES],
      visits: migratedVisits,
      overwriteSameDay: true,
      dummyModeName: null
    };
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(initial));
    return initial;
  } catch (err) {
    console.error('Failed to initialize state:', err);
    return {
      homeStoreId: 'nagamineminami',
      stores: [...DEFAULT_STORES],
      visits: [],
      overwriteSameDay: true,
      dummyModeName: null
    };
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(appState));
  } catch (err) {
    console.error('Failed to save state:', err);
  }
}

function getStoreById(storeId, storesList = appState.stores) {
  return storesList.find(s => s.id === storeId) || null;
}

// ==========================================
// Core Rolling Transfer Judgment Engine
// ==========================================
function evaluateTransfer(evalRefDateKey, state = appState) {
  const { homeStoreId, stores, visits } = state;
  const validStoreIds = new Set(stores.map(s => s.id));

  // Define 3 rolling 30-day blocks backwards from evalRefDateKey
  const blockDefs = [
    {
      index: 0,
      id: 'b1',
      tag: 'BLOCK 1',
      title: '直近30日間（0〜29日前）',
      shortTitle: '直近30日間',
      startKey: addDaysKey(evalRefDateKey, -29),
      endKey: evalRefDateKey
    },
    {
      index: 1,
      id: 'b2',
      tag: 'BLOCK 2',
      title: '30〜59日前（前ブロック）',
      shortTitle: '30〜59日前',
      startKey: addDaysKey(evalRefDateKey, -59),
      endKey: addDaysKey(evalRefDateKey, -30)
    },
    {
      index: 2,
      id: 'b3',
      tag: 'BLOCK 3',
      title: '60〜89日前（前々ブロック）',
      shortTitle: '60〜89日前',
      startKey: addDaysKey(evalRefDateKey, -89),
      endKey: addDaysKey(evalRefDateKey, -60)
    }
  ];

  const blocks = blockDefs.map(def => {
    const inBlockVisits = visits.filter(
      v => v.date >= def.startKey && v.date <= def.endKey && validStoreIds.has(v.storeId)
    );
    const total = inBlockVisits.length;
    const counts = {};
    stores.forEach(s => { counts[s.id] = 0; });
    inBlockVisits.forEach(v => {
      counts[v.storeId] = (counts[v.storeId] || 0) + 1;
    });

    const byStore = {};
    const storeList = stores.map(s => {
      const count = counts[s.id] || 0;
      const pct = total > 0 ? (count / total) * 100 : 0;
      const isHome = s.id === homeStoreId;
      // Exact integer comparison for >= 51%
      const over51 = !isHome && total > 0 && (count * 100 >= 51 * total);
      const metCondABlock = !isHome && total >= 4 && over51;
      const metCondBBlock = !isHome && total >= 1 && count === total;

      // Minimum extra visits to this store X in this block to satisfy Cond A in this block
      let visitsNeededForCondAInBlock = 0;
      if (!isHome) {
        for (let m = 0; m <= 200; m++) {
          const newTotal = total + m;
          const newCount = count + m;
          if (newTotal >= 4 && newCount * 100 >= 51 * newTotal) {
            visitsNeededForCondAInBlock = m;
            break;
          }
        }
      }

      const info = {
        store: s,
        count,
        pct,
        diffFrom51Pt: pct - 51,
        isHome,
        over51,
        metCondABlock,
        metCondBBlock,
        visitsNeededForCondAInBlock
      };
      byStore[s.id] = info;
      return info;
    });

    const condAMetStores = storeList.filter(x => x.metCondABlock);
    const condBMetStores = storeList.filter(x => x.metCondBBlock);

    return {
      ...def,
      total,
      byStore,
      storeList,
      condAMetStores,
      condBMetStores
    };
  });

  // Evaluate each non-home store across blocks
  const otherStores = stores.filter(s => s.id !== homeStoreId);
  const storeEvaluations = otherStores.map(s => {
    const b1 = blocks[0].byStore[s.id];
    const b2 = blocks[1].byStore[s.id];
    const b3 = blocks[2].byStore[s.id];
    const T1 = blocks[0].total;

    const establishedA = b1.metCondABlock && b2.metCondABlock;
    const establishedB = b1.metCondBBlock && b2.metCondBBlock && b3.metCondBBlock;
    const established = establishedA || establishedB;

    // How many home-store visits in Block 1 needed so store s neither triggers CondA Block1 nor CondB Block1
    let homeVisitsToSafeBlock1 = 0;
    for (let k = 0; k <= 300; k++) {
      const simT1 = T1 + k;
      const simCondA1 = simT1 >= 4 && (b1.count * 100 >= 51 * simT1);
      const simCondB1 = simT1 >= 1 && (b1.count === simT1);
      if (!simCondA1 && !simCondB1) {
        homeVisitsToSafeBlock1 = k;
        break;
      }
    }

    // How many visits to store s in Block 1 to immediately establish transfer (if B2 allows)
    let immediateVisitsToEstablish = null;
    let immediateVia = null;
    for (let m = 0; m <= 200; m++) {
      const simT1 = T1 + m;
      const simC1 = b1.count + m;
      const simA1 = simT1 >= 4 && simC1 * 100 >= 51 * simT1;
      const simB1 = simT1 >= 1 && simC1 === simT1;
      if (simA1 && b2.metCondABlock) {
        immediateVisitsToEstablish = m;
        immediateVia = 'A';
        break;
      }
      if (simB1 && b2.metCondBBlock && b3.metCondBBlock) {
        immediateVisitsToEstablish = m;
        immediateVia = 'B';
        break;
      }
    }

    // Safe margin: max additional visits to store s in Block 1 BEFORE hitting Block 1 Cond A or immediate transfer
    let safeExtraVisitsInBlock1 = 0;
    for (let m = 1; m <= 100; m++) {
      const simT1 = T1 + m;
      const simC1 = b1.count + m;
      const hitsBlock1A = simT1 >= 4 && simC1 * 100 >= 51 * simT1;
      const hitsImmB = (simT1 >= 1 && simC1 === simT1) && b2.metCondBBlock && b3.metCondBBlock;
      if (hitsBlock1A || hitsImmB) {
        safeExtraVisitsInBlock1 = m - 1;
        break;
      }
      safeExtraVisitsInBlock1 = m;
    }

    // Determine Reach status (if not already established)
    let isReach = false;
    let reachPriority = 99;
    let reachHeadline = '';
    let reachDetail = '';

    if (!established) {
      if (b2.metCondABlock) {
        const m = b1.visitsNeededForCondAInBlock;
        isReach = true;
        reachPriority = 1;
        reachHeadline = `あと${m}回の利用で移籍成立（前ブロック達成済）`;
        reachDetail = `30〜59日前ブロックで既に条件Aを達成しています。直近30日間であと${m}回「${s.name}」を利用すると2ブロック連続となり移籍条件Aが成立します。`;
      } else if (b2.metCondBBlock && b3.metCondBBlock && T1 === 0) {
        isReach = true;
        reachPriority = 2;
        reachHeadline = `あと1回の単独利用で条件B移籍成立`;
        reachDetail = `過去2ブロック（30〜89日前）が「${s.name}」100%利用です。直近30日で「${s.name}」のみを1回でも利用すると90日連続条件Bが成立します。`;
      } else if (b1.metCondABlock) {
        isReach = true;
        reachPriority = 3;
        reachHeadline = `直近30日間は条件A達成中（${b1.pct.toFixed(1)}%・${b1.count}回）`;
        reachDetail = `直近30日間が「4回以上 かつ 51%以上」に達しています。次の30日間も同じ利用ペースが続くと2ブロック連続で移籍成立となります。`;
      } else if (b1.metCondBBlock && b2.metCondBBlock) {
        isReach = true;
        reachPriority = 4;
        reachHeadline = `直近2ブロック連続で100%単独利用中（条件Bリーチ）`;
        reachDetail = `直近60日間（2ブロック連続）の利用がすべて「${s.name}」です。もう1ブロック（計90日）続くと低頻度条件Bで移籍成立となります。`;
      } else if (b1.visitsNeededForCondAInBlock === 1 && b1.count >= 2) {
        isReach = true;
        reachPriority = 5;
        reachHeadline = `直近30日の条件Aラインまであと1回`;
        reachDetail = `直近30日間で「${s.name}」にあと1回通うと、直近ブロックが条件Aライン（4回以上＆51%以上）に到達します。`;
      }
    }

    const total90Count = b1.count + b2.count + b3.count;

    return {
      store: s,
      b1,
      b2,
      b3,
      total90Count,
      established,
      establishedA,
      establishedB,
      isReach,
      reachPriority,
      reachHeadline,
      reachDetail,
      homeVisitsToSafeBlock1,
      immediateVisitsToEstablish,
      immediateVia,
      safeExtraVisitsInBlock1
    };
  });

  const establishedStores = storeEvaluations.filter(e => e.established);
  const reachStores = storeEvaluations
    .filter(e => e.isReach)
    .sort((a, b) => a.reachPriority - b.reachPriority || b.b1.pct - a.b1.pct);

  let overallLevel = 'safe'; // 'safe' | 'warning' | 'danger'
  if (establishedStores.length > 0) {
    overallLevel = 'danger';
  } else if (reachStores.length > 0) {
    overallLevel = 'warning';
  }

  return {
    refDateKey: evalRefDateKey,
    homeStore: getStoreById(homeStoreId, stores),
    blocks,
    storeEvaluations,
    establishedStores,
    reachStores,
    overallLevel
  };
}

// Simulate future days (assuming 0 future visits) to find when history pushes out
function simulatePushOutDays(startRefDateKey) {
  let resolveDangerDay = null;
  let fullSafeDay = null;

  for (let d = 1; d <= 91; d++) {
    const futureKey = addDaysKey(startRefDateKey, d);
    const sim = evaluateTransfer(futureKey, appState);
    if (resolveDangerDay === null && sim.overallLevel !== 'danger') {
      resolveDangerDay = { days: d, dateKey: futureKey };
    }
    if (fullSafeDay === null && sim.overallLevel === 'safe') {
      fullSafeDay = { days: d, dateKey: futureKey };
      break;
    }
  }
  return { resolveDangerDay, fullSafeDay };
}

// ==========================================
// UI Rendering Functions
// ==========================================
function showToast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
  }, 2400);
}

function renderHeaderAndBanner(evalResult) {
  document.getElementById('header-home-name').textContent =
    evalResult.homeStore ? `${evalResult.homeStore.name}店` : '未設定';
  document.getElementById('header-ref-date').textContent = formatJpShort(refDateKey);

  // Reference date input & diff badge
  const refInput = document.getElementById('ref-date-input');
  refInput.value = refDateKey;

  const diff = diffDays(refDateKey, todayKey);
  const diffBadge = document.getElementById('ref-date-diff-badge');
  if (diff === 0) {
    diffBadge.textContent = '今日（デフォルト）';
    diffBadge.classList.remove('hidden');
  } else if (diff > 0) {
    diffBadge.textContent = `未来シミュレート中：+${diff}日後`;
    diffBadge.classList.remove('hidden');
  } else {
    diffBadge.textContent = `過去日基準：${Math.abs(diff)}日前`;
    diffBadge.classList.remove('hidden');
  }

  // Dummy banner
  const dummyBanner = document.getElementById('dummy-active-banner');
  const dummyLabel = document.getElementById('dummy-mode-label');
  if (appState.dummyModeName) {
    dummyLabel.textContent = `お試しダミーデータ表示中：「${appState.dummyModeName}」`;
    dummyBanner.classList.remove('hidden');
  } else {
    dummyBanner.classList.add('hidden');
  }
}

function renderOverallStatusHero(evalResult) {
  const card = document.getElementById('overall-status-card');
  const icon = document.getElementById('status-icon-wrap');
  const badge = document.getElementById('status-level-badge');
  const windowLabel = document.getElementById('status-window-label');
  const title = document.getElementById('status-main-title');
  const desc = document.getElementById('status-description');
  const pillsWrap = document.getElementById('status-store-pills');

  const b3Start = evalResult.blocks[2].startKey;
  windowLabel.textContent = `集計対象(最大90日)：${formatJpShort(b3Start)} 〜 ${formatJpShort(refDateKey)}`;

  card.classList.remove('status-safe', 'status-warning', 'status-danger');

  if (evalResult.overallLevel === 'danger') {
    card.classList.add('status-danger');
    icon.textContent = '🚨';
    badge.textContent = '移籍条件成立';

    const names = evalResult.establishedStores.map(e => `${e.store.name}店`).join('・');
    title.textContent = `移籍条件成立（${names}へ移籍の可能性大）`;

    const reasons = evalResult.establishedStores.map(e => {
      const conds = [];
      if (e.establishedA) {
        conds.push(`条件A［直近30日 ${e.b1.pct.toFixed(1)}%(${e.b1.count}回) ＆ 30〜59日前 ${e.b2.pct.toFixed(1)}%(${e.b2.count}回)］`);
      }
      if (e.establishedB) {
        conds.push(`条件B［3ブロック90日間連続で${e.store.name}店を100%単独利用］`);
      }
      return `${e.store.name}店：${conds.join(' / ')}`;
    });
    desc.textContent = reasons.join(' ｜ ');

    pillsWrap.innerHTML = evalResult.establishedStores.map(e => `
      <div class="status-store-chip chip-danger">
        <span class="store-dot" style="background:${e.store.color}"></span>
        <span>${e.store.name}店：${e.establishedA ? '条件A(60日)成立' : ''}${e.establishedA && e.establishedB ? '・' : ''}${e.establishedB ? '条件B(90日)成立' : ''}</span>
      </div>
    `).join('');
  } else if (evalResult.overallLevel === 'warning') {
    card.classList.add('status-warning');
    icon.textContent = '⚠️';
    badge.textContent = 'リーチ状態（要注意）';

    const topReach = evalResult.reachStores[0];
    title.textContent = `リーチ状態（${topReach.store.name}店：${topReach.reachHeadline}）`;
    desc.textContent = topReach.reachDetail;

    pillsWrap.innerHTML = evalResult.reachStores.map(e => `
      <div class="status-store-chip chip-warning">
        <span class="store-dot" style="background:${e.store.color}"></span>
        <span>${e.store.name}店：${e.reachHeadline}</span>
      </div>
    `).join('');
  } else {
    card.classList.add('status-safe');
    icon.textContent = '✅';
    badge.textContent = '移籍対象外（安全）';
    const homeName = evalResult.homeStore ? `${evalResult.homeStore.name}店` : '現在の所属店舗';
    title.textContent = `移籍対象外（安全：${homeName}を維持）`;
    desc.textContent = '基準日時点のローリング判定において、条件A（60日）・条件B（90日）ともに自動移籍の対象外です。';

    const activeOthers = evalResult.storeEvaluations.filter(e => e.b1.count > 0 || e.b2.count > 0);
    if (activeOthers.length > 0) {
      pillsWrap.innerHTML = activeOthers.map(e => `
        <div class="status-store-chip">
          <span class="store-dot" style="background:${e.store.color}"></span>
          <span>${e.store.name}店：直近30日 ${e.b1.pct.toFixed(1)}%（${e.b1.count}回）</span>
        </div>
      `).join('');
    } else {
      pillsWrap.innerHTML = '';
    }
  }
}

function renderActionAdvice(evalResult) {
  const avoidBody = document.getElementById('advice-avoid-body');
  const targetBody = document.getElementById('advice-target-body');
  const targetSelect = document.getElementById('target-store-select');
  const homeName = evalResult.homeStore ? `${evalResult.homeStore.name}店` : '所属店舗';

  // --- 1. Avoid Transfer Advice ---
  const avoidBlocksHtml = [];

  if (evalResult.overallLevel === 'danger') {
    evalResult.establishedStores.forEach(e => {
      const k = e.homeVisitsToSafeBlock1;
      const newTotal = evalResult.blocks[0].total + k;
      const newPct = newTotal > 0 ? ((e.b1.count / newTotal) * 100).toFixed(1) : '0.0';
      avoidBlocksHtml.push(`
        <div class="advice-callout highlight-warn">
          <div>
            基準日までに あと <span class="advice-big-num">${k}回</span> 所属の<strong>${homeName}</strong>に通えば、
            直近30日の「${e.store.name}店」の割合が <strong>${newPct}%（${e.b1.count}/${newTotal}回）</strong> に下がり、移籍成立を回避できます。
          </div>
        </div>
      `);
    });

    const pushSim = simulatePushOutDays(refDateKey);
    if (pushSim.resolveDangerDay) {
      avoidBlocksHtml.push(`
        <div class="advice-callout">
          <div>
            ⏱️ <strong>日数経過による押し出し予測：</strong><br>
            今後他店を利用しない場合、あと <strong>${pushSim.resolveDangerDay.days}日後（${formatJpShort(pushSim.resolveDangerDay.dateKey)}）</strong> に過去履歴がブロック外へ押し出され「移籍成立」から外れます。
          </div>
          <button type="button" class="jump-date-btn" data-jump-date="${pushSim.resolveDangerDay.dateKey}">
            📅 ${formatJpShort(pushSim.resolveDangerDay.dateKey)} を基準日にセットして確認
          </button>
        </div>
      `);
    }
  } else if (evalResult.overallLevel === 'warning') {
    const topReach = evalResult.reachStores[0];
    if (topReach.homeVisitsToSafeBlock1 > 0) {
      const k = topReach.homeVisitsToSafeBlock1;
      const newTotal = evalResult.blocks[0].total + k;
      const newPct = ((topReach.b1.count / newTotal) * 100).toFixed(1);
      avoidBlocksHtml.push(`
        <div class="advice-callout highlight-warn">
          <div>
            直近30日以内に あと <span class="advice-big-num">${k}回</span> 所属の<strong>${homeName}</strong>に通えば、
            直近30日の「${topReach.store.name}店」の割合が <strong>${newPct}%（${topReach.b1.count}/${newTotal}回）</strong> となり51%未満（または単独100%未満）の安全圏に入ります。
          </div>
        </div>
      `);
    } else if (topReach.b2.metCondBBlock && topReach.b3.metCondBBlock && evalResult.blocks[0].total === 0) {
      avoidBlocksHtml.push(`
        <div class="advice-callout highlight-warn">
          <div>
            直近30日のうちに <strong>1回でも所属の${homeName}を利用</strong>しておけば、「${topReach.store.name}店」の90日連続100%利用（条件B）を確実にブロックできます。
          </div>
        </div>
      `);
    } else if (topReach.b2.metCondABlock) {
      avoidBlocksHtml.push(`
        <div class="advice-callout highlight-safe">
          <div>
            現在、直近30日の「${topReach.store.name}店」は51%未満（${topReach.b1.pct.toFixed(1)}%）に抑えられています。あと <strong>${topReach.safeExtraVisitsInBlock1}回</strong> までの利用なら移籍成立しません。
          </div>
        </div>
      `);
    }

    const pushSim = simulatePushOutDays(refDateKey);
    if (pushSim.fullSafeDay) {
      avoidBlocksHtml.push(`
        <div class="advice-callout">
          <div>
            ⏱️ <strong>押し出し予測：</strong>このまま他店へ行かなければ、あと <strong>${pushSim.fullSafeDay.days}日後（${formatJpShort(pushSim.fullSafeDay.dateKey)}）</strong> にリーチ状態が完全解消されます。
          </div>
          <button type="button" class="jump-date-btn" data-jump-date="${pushSim.fullSafeDay.dateKey}">
            📅 ${formatJpShort(pushSim.fullSafeDay.dateKey)} を基準日にセットして確認
          </button>
        </div>
      `);
    }
  } else {
    // Currently Safe
    const sortedByB1 = [...evalResult.storeEvaluations].sort((a, b) => b.b1.count - a.b1.count);
    const mainOther = sortedByB1[0];
    if (mainOther) {
      avoidBlocksHtml.push(`
        <div class="advice-callout highlight-safe">
          <div>
            現在 <strong>安全圏</strong> です（追加の所属店舗来店は不要です）。<br>
            <span class="advice-note">
              目安：直近30日間において「${mainOther.store.name}店」はあと <strong>${mainOther.safeExtraVisitsInBlock1}回</strong> 利用しても直近ブロックの51%条件（4回以上＆51%以上）には達しません。
            </span>
          </div>
        </div>
      `);
    } else {
      avoidBlocksHtml.push(`
        <div class="advice-callout highlight-safe">
          <div>他店舗が未登録、または他店舗の利用履歴がないため安全です。</div>
        </div>
      `);
    }
  }

  avoidBody.innerHTML = avoidBlocksHtml.join('');

  // --- 2. Achieve Transfer Advice (Target Store Selector) ---
  const otherEvals = evalResult.storeEvaluations;
  if (otherEvals.length === 0) {
    targetSelect.innerHTML = `<option value="">他店舗なし</option>`;
    targetBody.innerHTML = `<div class="advice-callout">基本設定エリアから移籍先の候補となる他店舗を追加してください。</div>`;
    return;
  }

  // Pick default target store (established > reach > highest count > first)
  if (!selectedTargetStoreId || !otherEvals.some(e => e.store.id === selectedTargetStoreId)) {
    const autoTarget =
      evalResult.establishedStores[0] ||
      evalResult.reachStores[0] ||
      [...otherEvals].sort((a, b) => b.total90Count - a.total90Count)[0];
    selectedTargetStoreId = autoTarget.store.id;
  }

  targetSelect.innerHTML = otherEvals.map(e => `
    <option value="${e.store.id}" ${e.store.id === selectedTargetStoreId ? 'selected' : ''}>
      ${e.store.name}店
    </option>
  `).join('');

  const targetEval = otherEvals.find(e => e.store.id === selectedTargetStoreId) || otherEvals[0];
  const tName = `${targetEval.store.name}店`;
  const targetHtml = [];

  if (targetEval.established) {
    targetHtml.push(`
      <div class="advice-callout highlight-purple">
        <div>
          🎉 <strong>${tName}への移籍条件はすでに成立しています！</strong><br>
          <span class="advice-note">
            ${targetEval.establishedA ? '条件A（60日連続：4回以上＆51%以上）を達成中。' : ''}
            ${targetEval.establishedB ? '条件B（90日連続：100%単独利用）を達成中。' : ''}
          </span>
        </div>
      </div>
    `);
  } else if (targetEval.immediateVisitsToEstablish !== null) {
    const m = targetEval.immediateVisitsToEstablish;
    const simT1 = evalResult.blocks[0].total + m;
    const simC1 = targetEval.b1.count + m;
    const simPct = ((simC1 / simT1) * 100).toFixed(1);
    targetHtml.push(`
      <div class="advice-callout highlight-purple">
        <div>
          直近30日以内に あと <span class="advice-big-num">${m}回</span> <strong>${tName}</strong>に通えば、
          <strong>条件${targetEval.immediateVia}</strong>（直近30日 ${simPct}%・計${simT1}回）を満たし、ただちに<strong>移籍条件成立</strong>となります！
        </div>
      </div>
    `);
  } else {
    // Past block(s) did not meet condition yet, so explain 2-step roadmap
    const m1 = targetEval.b1.visitsNeededForCondAInBlock;
    if (m1 === 0) {
      targetHtml.push(`
        <div class="advice-callout highlight-purple">
          <div>
            ✅ <strong>第1ステップ達成済：</strong>直近30日間は既に条件A（${targetEval.b1.pct.toFixed(1)}%・${targetEval.b1.count}回）をクリアしています！<br>
            <span class="advice-note">
              前ブロック（30〜59日前）が未達のため今すぐ成立にはなりませんが、<strong>次の30日間も合計4回以上＆${tName}51%以上</strong>を継続すれば2ブロック連続で移籍成立します。
            </span>
          </div>
        </div>
      `);
    } else {
      const simT1 = evalResult.blocks[0].total + m1;
      const simC1 = targetEval.b1.count + m1;
      const simPct = ((simC1 / simT1) * 100).toFixed(1);
      targetHtml.push(`
        <div class="advice-callout highlight-purple">
          <div>
            まずは直近30日間で あと <span class="advice-big-num">${m1}回</span> <strong>${tName}</strong>に通うと、直近ブロックの条件A（${simPct}%・${simC1}/${simT1}回）を達成できます。<br>
            <span class="advice-note">
              ※ 30〜59日前ブロックが未達のため、直近ブロック達成後、<strong>続く次の30日間も4回以上＆51%以上を維持</strong>すると移籍成立となります。
            </span>
          </div>
        </div>
      `);
    }
  }

  targetBody.innerHTML = targetHtml.join('');

  // Bind jump date buttons inside advice
  avoidBody.querySelectorAll('[data-jump-date]').forEach(btn => {
    btn.addEventListener('click', () => {
      refDateKey = btn.getAttribute('data-jump-date');
      const d = parseDateKey(refDateKey);
      calYear = d.getFullYear();
      calMonth = d.getMonth();
      renderAll();
      showToast(`基準日を ${formatJpShort(refDateKey)} に変更しました`);
    });
  });
}

function renderBlocksBreakdown(evalResult) {
  const container = document.getElementById('blocks-container');

  container.innerHTML = evalResult.blocks.map(block => {
    const hasCondA = block.condAMetStores.length > 0;
    const hasCondB = block.condBMetStores.length > 0;
    const alertClass = hasCondA ? 'block-alert-a' : (hasCondB ? 'block-alert-b' : '');

    // Condition pills
    const condAPill = hasCondA
      ? `<span class="cond-pill met-a">条件A対象: ${block.condAMetStores.map(x => x.store.name).join('・')} (≥4回&51%)</span>`
      : `<span class="cond-pill">条件A: ${block.total >= 4 ? '51%超の他店なし' : `あと${4 - block.total}回で総数4回`}</span>`;

    const condBPill = hasCondB
      ? `<span class="cond-pill met-b">条件B対象: ${block.condBMetStores[0].store.name}100%単独</span>`
      : `<span class="cond-pill">条件B(他店100%): 未達</span>`;

    // Stacked bar segments (non-home stores first sorted by count desc so 51% line comparison is intuitive, home store last)
    const activeStores = block.storeList
      .filter(x => x.count > 0)
      .sort((a, b) => {
        if (a.isHome !== b.isHome) return a.isHome ? 1 : -1;
        return b.count - a.count;
      });

    const stackedSegmentsHtml = block.total === 0
      ? ''
      : activeStores.map(x => `
          <div
            class="stacked-seg"
            style="width:${x.pct.toFixed(2)}%; background:${x.store.color};"
            title="${x.store.name}: ${x.pct.toFixed(1)}% (${x.count}回)"
          ></div>
        `).join('');

    // Store breakdown rows: show stores with count > 0, plus home store & top target if total > 0
    const rowsToShow = block.storeList.filter(x => x.count > 0 || x.isHome || x.store.id === selectedTargetStoreId);

    const storeRowsHtml = block.total === 0
      ? `<div class="block-empty-msg">この30日間の来店記録はありません（0回）</div>`
      : rowsToShow.map(x => {
          let diffHtml = '';
          if (x.isHome) {
            diffHtml = `<span class="diff-safe">現在の所属店舗（移籍判定の対象外）</span>`;
          } else if (x.over51) {
            const extraPt = (x.pct - 51).toFixed(1);
            if (block.total >= 4) {
              diffHtml = `<span class="diff-over">⚠️ 51%ラインを +${extraPt}pt 超過（ブロック条件A達成）</span>`;
            } else {
              diffHtml = `<span class="diff-over">51%超（+${extraPt}pt）※総回数あと${4 - block.total}回で条件A</span>`;
            }
          } else {
            const lackPt = (51 - x.pct).toFixed(1);
            diffHtml = `<span class="diff-safe">51%まで残り ${lackPt}pt（条件Aまであと${x.visitsNeededForCondAInBlock}回）</span>`;
          }

          return `
            <div class="b-store-item ${x.metCondABlock ? 'over-51' : ''}">
              <div class="b-store-top">
                <div class="b-store-name-wrap">
                  <span class="store-dot" style="background:${x.store.color}"></span>
                  <span>${x.store.name}</span>
                  ${x.isHome ? '<span class="home-tag">所属</span>' : ''}
                </div>
                <div class="b-store-stats">
                  <span class="b-store-count">${x.count}回</span>
                  <span class="b-store-pct ${x.over51 ? 'pct-danger' : ''}">${x.pct.toFixed(1)}%</span>
                </div>
              </div>
              <div class="mini-bar-track">
                <div class="mini-bar-fill" style="width:${Math.min(100, x.pct).toFixed(1)}%; background:${x.store.color}"></div>
                ${!x.isHome ? '<div class="mini-bar-tick51" title="51%ライン"></div>' : ''}
              </div>
              <div class="b-store-diff">${diffHtml}</div>
            </div>
          `;
        }).join('');

    return `
      <article class="block-card ${alertClass}">
        <div class="block-top">
          <div>
            <span class="block-tag ${block.id}">${block.tag}</span>
            <h3 class="block-title">${block.title}</h3>
            <p class="block-dates">${formatJpShort(block.startKey)} 〜 ${formatJpShort(block.endKey)}</p>
          </div>
          <div class="block-total-box">
            <span class="block-total-label">総利用</span>
            <span class="block-total-num">${block.total}<small>回</small></span>
          </div>
        </div>

        <div class="block-cond-row">
          ${condAPill}
          ${condBPill}
        </div>

        <div class="threshold-bar-wrap">
          <div class="threshold-marker">
            <span class="threshold-label">51%ライン</span>
          </div>
          <div class="stacked-bar">
            ${stackedSegmentsHtml}
          </div>
        </div>

        <div class="block-store-list">
          ${storeRowsHtml}
        </div>
      </article>
    `;
  }).join('');
}

function renderCheckinSection() {
  const dateInput = document.getElementById('visit-date-input');
  dateInput.value = visitInputDateKey;

  const yesterdayKey = addDaysKey(todayKey, -1);
  document.getElementById('visit-today-btn').classList.toggle('active', visitInputDateKey === todayKey);
  document.getElementById('visit-yesterday-btn').classList.toggle('active', visitInputDateKey === yesterdayKey);

  const overwriteToggle = document.getElementById('overwrite-same-day-toggle');
  overwriteToggle.checked = appState.overwriteSameDay;

  const dayVisits = appState.visits.filter(v => v.date === visitInputDateKey);
  const dayCounts = {};
  dayVisits.forEach(v => {
    dayCounts[v.storeId] = (dayCounts[v.storeId] || 0) + 1;
  });

  const btnGrid = document.getElementById('checkin-store-buttons');
  btnGrid.innerHTML = appState.stores.map(s => {
    const isHome = s.id === appState.homeStoreId;
    const countOnDay = dayCounts[s.id] || 0;
    return `
      <button type="button" class="store-tap-btn ${countOnDay > 0 ? 'recorded' : ''}" data-tap-store="${s.id}">
        ${countOnDay > 0 ? `<span class="tap-count-badge">${appState.overwriteSameDay ? '✓' : countOnDay + '回'}</span>` : ''}
        <span class="store-dot" style="background:${s.color}; width:12px; height:12px;"></span>
        <span class="tap-store-name">${s.name}</span>
        <span class="tap-role-badge ${isHome ? 'is-home' : ''}">${isHome ? '所属店舗' : '他店舗'}</span>
      </button>
    `;
  }).join('');

  btnGrid.querySelectorAll('[data-tap-store]').forEach(btn => {
    btn.addEventListener('click', () => {
      handleAddOrToggleVisit(visitInputDateKey, btn.getAttribute('data-tap-store'));
    });
  });

  // Selected day existing records preview with delete buttons
  const dayRecContainer = document.getElementById('selected-date-records');
  if (dayVisits.length === 0) {
    dayRecContainer.innerHTML = `
      <span class="day-rec-header">${formatJpFull(visitInputDateKey)} の記録：なし（上のボタンをタップして追加）</span>
    `;
  } else {
    dayRecContainer.innerHTML = `
      <span class="day-rec-header">${formatJpFull(visitInputDateKey)} の記録（${dayVisits.length}件）：</span>
      <div class="day-rec-chips">
        ${dayVisits.map(v => {
          const st = getStoreById(v.storeId);
          if (!st) return '';
          return `
            <span class="day-rec-chip">
              <span class="store-dot" style="background:${st.color}"></span>
              <span>${st.name}</span>
              <button type="button" class="chip-del-btn" data-del-visit="${v.id}" title="この記録を削除">×</button>
            </span>
          `;
        }).join('')}
      </div>
    `;
    dayRecContainer.querySelectorAll('[data-del-visit]').forEach(btn => {
      btn.addEventListener('click', () => {
        deleteVisitById(btn.getAttribute('data-del-visit'));
      });
    });
  }
}

function renderSettingsSection() {
  const homeSelect = document.getElementById('home-store-select');
  homeSelect.innerHTML = appState.stores.map(s => `
    <option value="${s.id}" ${s.id === appState.homeStoreId ? 'selected' : ''}>
      ${s.name}店 ${s.id === appState.homeStoreId ? '（現在の所属）' : ''}
    </option>
  `).join('');

  const presetList = document.getElementById('preset-stores-list');
  presetList.innerHTML = appState.stores.map(s => {
    const isHome = s.id === appState.homeStoreId;
    return `
      <span class="preset-pill">
        <span class="store-dot" style="background:${s.color}"></span>
        <span>${s.name}</span>
        ${isHome
          ? '<span class="home-tag">所属</span>'
          : `<button type="button" class="chip-del-btn" data-del-store="${s.id}" title="${s.name}を削除">×</button>`
        }
      </span>
    `;
  }).join('');

  presetList.querySelectorAll('[data-del-store]').forEach(btn => {
    btn.addEventListener('click', () => {
      handleDeleteStore(btn.getAttribute('data-del-store'));
    });
  });
}

function renderCalendarAndHistory(evalResult) {
  document.getElementById('total-records-badge').textContent = appState.visits.length;

  // Toggle tab panels
  document.getElementById('tab-panel-calendar').classList.toggle('hidden', activeHistoryTab !== 'calendar');
  document.getElementById('tab-panel-list').classList.toggle('hidden', activeHistoryTab !== 'list');
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === activeHistoryTab);
  });

  // --- Render Calendar ---
  document.getElementById('cal-month-title').textContent = `${calYear}年${calMonth + 1}月`;
  const calGrid = document.getElementById('calendar-grid');
  calGrid.innerHTML = '';

  const firstDay = new Date(calYear, calMonth, 1);
  const lastDay = new Date(calYear, calMonth + 1, 0);
  const startWeekday = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  const b1 = evalResult.blocks[0];
  const b2 = evalResult.blocks[1];
  const b3 = evalResult.blocks[2];

  // Group visits by date
  const visitsByDate = {};
  appState.visits.forEach(v => {
    if (!visitsByDate[v.date]) visitsByDate[v.date] = [];
    visitsByDate[v.date].push(v);
  });

  for (let i = 0; i < startWeekday; i++) {
    const empty = document.createElement('div');
    empty.className = 'cal-cell empty';
    calGrid.appendChild(empty);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dKey = formatDateKey(new Date(calYear, calMonth, day));
    const cell = document.createElement('div');
    cell.className = 'cal-cell';

    if (dKey >= b1.startKey && dKey <= b1.endKey) cell.classList.add('in-b1');
    else if (dKey >= b2.startKey && dKey <= b2.endKey) cell.classList.add('in-b2');
    else if (dKey >= b3.startKey && dKey <= b3.endKey) cell.classList.add('in-b3');

    if (dKey === visitInputDateKey) cell.classList.add('is-selected');
    if (dKey === refDateKey) cell.classList.add('is-ref-date');

    const numEl = document.createElement('span');
    numEl.className = 'cal-day-num';
    numEl.textContent = day;
    cell.appendChild(numEl);

    const dayVisits = visitsByDate[dKey] || [];
    if (dayVisits.length > 0) {
      const stack = document.createElement('div');
      stack.className = 'cal-badges-stack';
      dayVisits.slice(0, 2).forEach(v => {
        const st = getStoreById(v.storeId);
        if (!st) return;
        const pill = document.createElement('span');
        pill.className = 'cal-visit-pill';
        pill.style.background = st.color;
        pill.textContent = st.shortName;
        stack.appendChild(pill);
      });
      if (dayVisits.length > 2) {
        const more = document.createElement('span');
        more.style.fontSize = '0.58rem';
        more.style.fontWeight = '800';
        more.textContent = `+${dayVisits.length - 2}件`;
        stack.appendChild(more);
      }
      cell.appendChild(stack);
    }

    cell.addEventListener('click', () => {
      visitInputDateKey = dKey;
      renderCheckinSection();
      renderCalendarAndHistory(evalResult);
    });

    calGrid.appendChild(cell);
  }

  // Store legend under calendar
  document.getElementById('cal-store-legend').innerHTML = appState.stores.map(s => `
    <span class="legend-item">
      <i class="store-dot" style="background:${s.color}"></i>
      <span>${s.name}${s.id === appState.homeStoreId ? '(所属)' : ''}</span>
    </span>
  `).join('');

  // --- Render History List ---
  const filterSelect = document.getElementById('history-store-filter');
  const currentFilter = filterSelect.value || 'all';
  filterSelect.innerHTML = `
    <option value="all">すべての店舗</option>
    ${appState.stores.map(s => `
      <option value="${s.id}" ${s.id === currentFilter ? 'selected' : ''}>${s.name}店</option>
    `).join('')}
  `;

  const sortDir = document.getElementById('history-sort-select').value;
  let filtered = appState.visits.filter(v =>
    currentFilter === 'all' ? true : v.storeId === currentFilter
  );

  filtered.sort((a, b) => {
    if (a.date !== b.date) {
      return sortDir === 'desc' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date);
    }
    return b.id.localeCompare(a.id);
  });

  const listContainer = document.getElementById('history-list-container');
  if (filtered.length === 0) {
    listContainer.innerHTML = `<div class="block-empty-msg">該当する来店履歴がありません</div>`;
  } else {
    listContainer.innerHTML = filtered.map(v => {
      const st = getStoreById(v.storeId);
      const stName = st ? st.name : '不明な店舗';
      const stColor = st ? st.color : '#94a3b8';

      let blockBadge = `<span class="history-block-tag" style="background:#f1f5f9;color:#64748b;">判定期間外</span>`;
      if (v.date >= b1.startKey && v.date <= b1.endKey) {
        blockBadge = `<span class="history-block-tag block-tag b1">直近30日(B1)</span>`;
      } else if (v.date >= b2.startKey && v.date <= b2.endKey) {
        blockBadge = `<span class="history-block-tag block-tag b2">30〜59日前(B2)</span>`;
      } else if (v.date >= b3.startKey && v.date <= b3.endKey) {
        blockBadge = `<span class="history-block-tag block-tag b3">60〜89日前(B3)</span>`;
      } else if (v.date > refDateKey) {
        blockBadge = `<span class="history-block-tag" style="background:#fef3c7;color:#b45309;">基準日より未来</span>`;
      }

      return `
        <div class="history-row">
          <div class="history-row-left">
            <span class="history-date">${formatJpFull(v.date)}</span>
            <span class="history-store-badge">
              <span class="store-dot" style="background:${stColor}"></span>
              <span>${stName}</span>
            </span>
            ${blockBadge}
          </div>
          <button type="button" class="row-del-btn" data-row-del="${v.id}">削除</button>
        </div>
      `;
    }).join('');

    listContainer.querySelectorAll('[data-row-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        deleteVisitById(btn.getAttribute('data-row-del'));
      });
    });
  }
}

function renderAll() {
  const evalResult = evaluateTransfer(refDateKey, appState);
  renderHeaderAndBanner(evalResult);
  renderOverallStatusHero(evalResult);
  renderActionAdvice(evalResult);
  renderBlocksBreakdown(evalResult);
  renderCheckinSection();
  renderSettingsSection();
  renderCalendarAndHistory(evalResult);
}

// ==========================================
// User Actions & Event Handlers
// ==========================================
function handleAddOrToggleVisit(dateKey, storeId) {
  const store = getStoreById(storeId);
  if (!store) return;

  if (appState.overwriteSameDay) {
    const existingSameDay = appState.visits.filter(v => v.date === dateKey);
    const alreadySameStore = existingSameDay.length === 1 && existingSameDay[0].storeId === storeId;

    // Remove existing records on that date
    appState.visits = appState.visits.filter(v => v.date !== dateKey);

    if (alreadySameStore) {
      saveState();
      renderAll();
      showToast(`${formatJpShort(dateKey)} の記録を取り消しました`);
      return;
    }

    appState.visits.push({ id: uid(), date: dateKey, storeId });
    saveState();
    renderAll();
    showToast(`${formatJpShort(dateKey)} に「${store.name}」を記録しました`);
  } else {
    appState.visits.push({ id: uid(), date: dateKey, storeId });
    saveState();
    renderAll();
    const countNow = appState.visits.filter(v => v.date === dateKey).length;
    showToast(`${formatJpShort(dateKey)} に「${store.name}」を追加しました（同日${countNow}件目）`);
  }
}

function deleteVisitById(visitId) {
  const target = appState.visits.find(v => v.id === visitId);
  if (!target) return;
  appState.visits = appState.visits.filter(v => v.id !== visitId);
  saveState();
  renderAll();
  showToast(`${formatJpShort(target.date)} の記録を削除しました`);
}

function handleAddStore(nameRaw) {
  const name = nameRaw.replace(/[<>]/g, '').trim();
  if (!name) return;
  if (appState.stores.some(s => s.name === name)) {
    showToast(`「${name}」は既に登録されています`);
    return;
  }

  const usedColors = new Set(appState.stores.map(s => s.color));
  const color = EXTRA_COLORS.find(c => !usedColors.has(c)) || EXTRA_COLORS[appState.stores.length % EXTRA_COLORS.length];
  const newStore = {
    id: 'st_' + Date.now().toString(36),
    name,
    shortName: makeShortName(name),
    color
  };

  appState.stores.push(newStore);
  saveState();
  renderAll();
  showToast(`店舗「${name}」をプリセットに追加しました`);
}

function handleDeleteStore(storeId) {
  if (storeId === appState.homeStoreId) {
    showToast('現在の所属店舗は削除できません');
    return;
  }
  const store = getStoreById(storeId);
  if (!store) return;

  const usedCount = appState.visits.filter(v => v.storeId === storeId).length;
  if (usedCount > 0) {
    const ok = window.confirm(`「${store.name}」には ${usedCount} 件の来店履歴があります。店舗と関連履歴を削除しますか？`);
    if (!ok) return;
    appState.visits = appState.visits.filter(v => v.storeId !== storeId);
  }

  appState.stores = appState.stores.filter(s => s.id !== storeId);
  if (selectedTargetStoreId === storeId) selectedTargetStoreId = null;
  saveState();
  renderAll();
  showToast(`「${store.name}」を削除しました`);
}

// ==========================================
// Dummy Data Generator (Test Presets)
// ==========================================
function ensureDefaultStoresPresent() {
  DEFAULT_STORES.forEach(def => {
    if (!appState.stores.some(s => s.id === def.id)) {
      appState.stores.push({ ...def });
    }
  });
}

function loadDummyPreset(presetKey) {
  // Backup real user data before entering dummy mode
  if (!appState.dummyModeName) {
    try {
      localStorage.setItem(REAL_BACKUP_KEY, JSON.stringify(appState));
    } catch (e) {
      console.error('Backup failed:', e);
    }
  }

  ensureDefaultStoresPresent();
  appState.homeStoreId = 'nagamineminami';
  refDateKey = todayKey;
  visitInputDateKey = todayKey;
  calYear = todayObj.getFullYear();
  calMonth = todayObj.getMonth();

  const makeVisits = (pairs) =>
    pairs.map(([daysAgo, storeId], idx) => ({
      id: `dummy_${presetKey}_${idx}`,
      date: addDaysKey(todayKey, -daysAgo),
      storeId
    }));

  if (presetKey === 'condA') {
    appState.dummyModeName = '移籍成立パターン（条件A：60日メイン条件）';
    selectedTargetStoreId = 'kurokami';
    // Block 1 (0-29): 黒髪 4回, 長嶺南 2回 -> 計6回, 黒髪 66.7% (>=51%)
    // Block 2 (30-59): 黒髪 4回, 長嶺南 2回 -> 計6回, 黒髪 66.7% (>=51%)
    // Block 3 (60-89): 長嶺南 4回
    appState.visits = makeVisits([
      [2, 'kurokami'], [6, 'kurokami'], [9, 'nagamineminami'],
      [13, 'kurokami'], [18, 'kurokami'], [23, 'nagamineminami'],
      [33, 'kurokami'], [38, 'kurokami'], [42, 'nagamineminami'],
      [47, 'kurokami'], [52, 'kurokami'], [56, 'nagamineminami'],
      [65, 'nagamineminami'], [72, 'nagamineminami'], [79, 'nagamineminami'], [85, 'nagamineminami']
    ]);
  } else if (presetKey === 'condB') {
    appState.dummyModeName = '移籍成立パターン（条件B：90日100%低頻度）';
    selectedTargetStoreId = 'higashimachi';
    // Block 1: 東町 2回 (100%), Block 2: 東町 1回 (100%), Block 3: 東町 2回 (100%)
    appState.visits = makeVisits([
      [5, 'higashimachi'], [19, 'higashimachi'],
      [41, 'higashimachi'],
      [67, 'higashimachi'], [81, 'higashimachi']
    ]);
  } else if (presetKey === 'reachUrgent') {
    appState.dummyModeName = 'リーチ状態（前ブロック達成済・あと1回で成立）';
    selectedTargetStoreId = 'kurokami';
    // Block 2: 黒髪 4回, 長嶺南 2回 -> 66.7% (達成済)
    // Block 1: 黒髪 2回, 長嶺南 2回 -> 計4回, 黒髪 50.0% (あと1回黒髪へ行くと 3/5 = 60.0% で即成立！)
    appState.visits = makeVisits([
      [3, 'kurokami'], [8, 'nagamineminami'], [14, 'kurokami'], [21, 'nagamineminami'],
      [34, 'kurokami'], [39, 'kurokami'], [44, 'nagamineminami'],
      [49, 'kurokami'], [54, 'kurokami'], [58, 'nagamineminami']
    ]);
  } else if (presetKey === 'reachBlock1') {
    appState.dummyModeName = 'リーチ状態（直近30日間が条件A達成中）';
    selectedTargetStoreId = 'shinoe';
    // Block 1: 新大江 4回, 長嶺南 1回 -> 計5回, 新大江 80.0% (条件A達成中)
    // Block 2: 長嶺南 4回, 新大江 1回 -> 計5回, 新大江 20.0% (未達)
    appState.visits = makeVisits([
      [2, 'shinoe'], [7, 'shinoe'], [12, 'nagamineminami'], [17, 'shinoe'], [24, 'shinoe'],
      [35, 'nagamineminami'], [41, 'nagamineminami'], [46, 'shinoe'], [51, 'nagamineminami'], [57, 'nagamineminami']
    ]);
  } else if (presetKey === 'safe') {
    appState.dummyModeName = '安全パターン（所属店舗メイン利用）';
    selectedTargetStoreId = 'kurokami';
    appState.visits = makeVisits([
      [2, 'nagamineminami'], [5, 'kurokami'], [9, 'nagamineminami'], [12, 'hakata3'],
      [16, 'nagamineminami'], [20, 'kurokami'], [25, 'nagamineminami'],
      [33, 'nagamineminami'], [39, 'higashimachi'], [45, 'nagamineminami'], [52, 'nagamineminami']
    ]);
  }

  saveState();
  renderAll();
  showToast(`🧪「${appState.dummyModeName}」を読み込みました`);
}

function restoreRealData() {
  try {
    const backupRaw = localStorage.getItem(REAL_BACKUP_KEY);
    if (backupRaw) {
      const restored = JSON.parse(backupRaw);
      restored.dummyModeName = null;
      appState = restored;
      localStorage.removeItem(REAL_BACKUP_KEY);
    } else {
      appState.dummyModeName = null;
      appState.visits = [];
    }
    refDateKey = todayKey;
    selectedTargetStoreId = null;
    saveState();
    renderAll();
    showToast('元の自分のデータに戻しました');
  } catch (err) {
    console.error('Restore failed:', err);
  }
}

// ==========================================
// Initialization & Event Wiring
// ==========================================
function init() {
  // Reference date input & steppers
  document.getElementById('ref-date-input').addEventListener('change', e => {
    if (e.target.value) {
      refDateKey = e.target.value;
      const d = parseDateKey(refDateKey);
      calYear = d.getFullYear();
      calMonth = d.getMonth();
      renderAll();
    }
  });

  document.querySelectorAll('.step-btn[data-step]').forEach(btn => {
    btn.addEventListener('click', () => {
      const step = Number(btn.getAttribute('data-step'));
      refDateKey = addDaysKey(refDateKey, step);
      const d = parseDateKey(refDateKey);
      calYear = d.getFullYear();
      calMonth = d.getMonth();
      renderAll();
    });
  });

  document.getElementById('reset-ref-today-btn').addEventListener('click', () => {
    refDateKey = todayKey;
    calYear = todayObj.getFullYear();
    calMonth = todayObj.getMonth();
    renderAll();
    showToast('判定基準日を「今日」に戻しました');
  });

  // Dummy data preset buttons & restore button
  document.querySelectorAll('.dummy-btn[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      loadDummyPreset(btn.getAttribute('data-preset'));
    });
  });

  document.getElementById('restore-real-data-btn').addEventListener('click', restoreRealData);

  // Target store selector in advice card
  document.getElementById('target-store-select').addEventListener('change', e => {
    selectedTargetStoreId = e.target.value;
    renderAll();
  });

  // Visit date picker & quick chips
  document.getElementById('visit-date-input').addEventListener('change', e => {
    if (e.target.value) {
      visitInputDateKey = e.target.value;
      const d = parseDateKey(visitInputDateKey);
      calYear = d.getFullYear();
      calMonth = d.getMonth();
      renderAll();
    }
  });

  document.getElementById('visit-today-btn').addEventListener('click', () => {
    visitInputDateKey = todayKey;
    calYear = todayObj.getFullYear();
    calMonth = todayObj.getMonth();
    renderAll();
  });

  document.getElementById('visit-yesterday-btn').addEventListener('click', () => {
    visitInputDateKey = addDaysKey(todayKey, -1);
    const d = parseDateKey(visitInputDateKey);
    calYear = d.getFullYear();
    calMonth = d.getMonth();
    renderAll();
  });

  document.getElementById('overwrite-same-day-toggle').addEventListener('change', e => {
    appState.overwriteSameDay = e.target.checked;
    saveState();
    renderCheckinSection();
  });

  // Settings: Home store & Add store
  document.getElementById('home-store-select').addEventListener('change', e => {
    appState.homeStoreId = e.target.value;
    if (selectedTargetStoreId === appState.homeStoreId) {
      selectedTargetStoreId = null;
    }
    saveState();
    renderAll();
    const home = getStoreById(appState.homeStoreId);
    if (home) showToast(`現在の所属店舗を「${home.name}店」に変更しました`);
  });

  document.getElementById('add-store-form').addEventListener('submit', e => {
    e.preventDefault();
    const input = document.getElementById('new-store-name-input');
    handleAddStore(input.value);
    input.value = '';
  });

  // History Tabs & Filters & Clear All
  document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeHistoryTab = btn.getAttribute('data-tab');
      renderAll();
    });
  });

  document.getElementById('cal-prev-btn').addEventListener('click', () => {
    calMonth--;
    if (calMonth < 0) {
      calMonth = 11;
      calYear--;
    }
    renderAll();
  });

  document.getElementById('cal-next-btn').addEventListener('click', () => {
    calMonth++;
    if (calMonth > 11) {
      calMonth = 0;
      calYear++;
    }
    renderAll();
  });

  document.getElementById('history-store-filter').addEventListener('change', () => renderAll());
  document.getElementById('history-sort-select').addEventListener('change', () => renderAll());

  document.getElementById('clear-all-records-btn').addEventListener('click', () => {
    if (appState.visits.length === 0) {
      showToast('削除する履歴がありません');
      return;
    }
    if (window.confirm(`すべての来店履歴（${appState.visits.length}件）を削除しますか？`)) {
      appState.visits = [];
      appState.dummyModeName = null;
      saveState();
      renderAll();
      showToast('すべての来店履歴を削除しました');
    }
  });

  renderAll();
}

document.addEventListener('DOMContentLoaded', init);
