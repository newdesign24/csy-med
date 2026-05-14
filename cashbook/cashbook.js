/* ============================================================
   장부 (Cashbook) — Clinical Ledger App
   ----------------------------------------------------------------
   - 매출/매입 입력 (CRUD)
   - 월별 보기 + 일별 그룹핑/합계
   - localStorage 영구 저장
   - SheetJS 엑셀 내보내기 (매출/매입 2 시트)
   - 비밀번호 잠금 (SOAP_PASSWORD 재사용)
   ============================================================ */

(function () {
  'use strict';

  /* ── DOM ───────────────────────────────────────────────── */
  const $ = (id) => document.getElementById(id);

  // 상단
  const logoutBtn = $('logoutBtn');
  const excelBtn  = $('excelBtn');
  const driveBtn  = $('driveBtn');

  // 탭/월 네비
  const tabSales    = $('tabSales');
  const tabPurchase = $('tabPurchase');
  const monthPrev   = $('monthPrev');
  const monthNext   = $('monthNext');
  const monthToday  = $('monthToday');
  const monthLabel  = $('monthLabel');

  // 헤더 라벨
  const formTitle    = $('formTitle');
  const formSubtitle = $('formSubtitle');
  const listTitle    = $('listTitle');
  const listMonthSub = $('listMonthSub');
  const listCountSub = $('listCountSub');
  const sumSalesEl   = $('sumSales');
  const sumPurchaseEl= $('sumPurchase');
  const sumNetEl     = $('sumNet');

  // 폼 (매출)
  const salesForm    = $('salesForm');
  const sDate        = $('sDate');
  const sChart       = $('sChart');
  const sName        = $('sName');
  const sVisit       = $('sVisit');
  const sCategory    = $('sCategory');
  const sDetail      = $('sDetail');
  const sAmount      = $('sAmount');
  const sDiscount    = $('sDiscount');
  const sPayMethod   = $('sPayMethod');
  const sCardCompany = $('sCardCompany');
  const sCardCompanyField = $('sCardCompanyField');
  const sReset       = $('sReset');
  const sSubmit      = $('sSubmit');
  const sSubmitLabel = $('sSubmitLabel');

  // 폼 (매입)
  const purchaseForm = $('purchaseForm');
  const pDate        = $('pDate');
  const pVendor      = $('pVendor');
  const pPayMethod   = $('pPayMethod');
  const pCardCompany = $('pCardCompany');
  const pCardCompanyField = $('pCardCompanyField');
  const pAmount      = $('pAmount');
  const pReset       = $('pReset');
  const pSubmit      = $('pSubmit');
  const pSubmitLabel = $('pSubmitLabel');

  // 수정 배너
  const editBanner = $('editBanner');
  const cancelEdit = $('cancelEdit');

  // 목록
  const listScroll = $('listScroll');

  // 토스트
  const toastEl = $('toast');

  // 잠금
  const lockScreen     = $('lockScreen');
  const lockForm       = $('lockForm');
  const lockInput      = $('lockInput');
  const lockSubmit     = $('lockSubmit');
  const lockSubmitText = $('lockSubmitText');
  const lockError      = $('lockError');

  /* ── 설정 ──────────────────────────────────────────────── */
  const AUTH_URL    = '/api/cashbook-auth';   // CASHBOOK_PASSWORD 기반 (SOAP 와 분리)
  const CONFIG_URL  = '/api/cashbook-config'; // GOOGLE_CLIENT_ID 조회
  const TOKEN_KEY   = 'csy_cashbook_token';   // SOAP 와 다른 키 — 비밀번호 분리
  const STORAGE_KEY = 'csy_cashbook_v1';      // { sales: [...], purchases: [...] }

  // Google Drive 동기화 (선택)
  const DRIVE_SCOPES           = 'https://www.googleapis.com/auth/drive.appdata';
  const DRIVE_FILENAME         = 'cashbook_data.json';
  const DRIVE_TOKEN_KEY        = 'csy_cashbook_drive_token';
  const DRIVE_TOKEN_EXPIRY_KEY = 'csy_cashbook_drive_expiry';
  const DRIVE_FILE_ID_KEY      = 'csy_cashbook_drive_file_id';
  const DRIVE_SIGNED_IN_KEY    = 'csy_cashbook_drive_signed_in';

  /* ── 상태 ──────────────────────────────────────────────── */
  let activeTab    = 'sales';                 // 'sales' | 'purchase'
  let viewMonth    = ymOf(new Date());        // 'YYYY-MM'
  let editingId    = null;                    // 수정 중인 항목 id (null = 새 항목)
  /** @type {{ sales: SaleEntry[], purchases: PurchaseEntry[] }} */
  let data         = { sales: [], purchases: [] };

  // Google Drive 상태
  let googleClientId    = '';
  let driveAccessToken  = '';
  let driveFileId       = '';
  let driveTokenClient  = null;
  let driveSyncTimer    = null;
  let driveRefreshTimer = null;

  /* ── 인증 (SOAP_PASSWORD 토큰 재사용) ───────────────────── */
  let memToken = '';
  function getToken() {
    if (memToken) return memToken;
    try {
      const t = localStorage.getItem(TOKEN_KEY) || '';
      if (t) memToken = t;
      return t;
    } catch (_) { return ''; }
  }
  function applyAuthedUI() {
    document.documentElement.classList.add('authed');
    if (lockScreen) lockScreen.style.display = 'none';
  }
  function applyLockedUI() {
    document.documentElement.classList.remove('authed');
    if (lockScreen) lockScreen.style.display = '';
  }
  function setToken(t) {
    memToken = t || '';
    try { localStorage.setItem(TOKEN_KEY, t); } catch (_) {}
    applyAuthedUI();
  }
  function clearAuth() {
    memToken = '';
    try { localStorage.removeItem(TOKEN_KEY); } catch (_) {}
    applyLockedUI();
  }
  function showLockError(msg) { lockError.textContent = msg || ''; }
  function showLockLoading(on) {
    if (on) {
      lockSubmit.classList.add('loading');
      lockSubmitText.textContent = '확인 중…';
      lockInput.disabled = true;
      lockSubmit.disabled = true;
    } else {
      lockSubmit.classList.remove('loading');
      lockSubmitText.textContent = '접속하기';
      lockInput.disabled = false;
      lockSubmit.disabled = false;
    }
  }
  function lockOut(reason) {
    clearAuth();
    showLockError(reason || '');
    setTimeout(() => { try { lockInput.focus(); } catch (_) {} }, 50);
  }

  window.addEventListener('pageshow', () => {
    if (getToken()) applyAuthedUI(); else applyLockedUI();
  });

  lockInput.addEventListener('input', () => {
    if (lockError.textContent) showLockError('');
  });

  let isLoggingIn = false;
  async function performLogin() {
    if (isLoggingIn) return;
    isLoggingIn = true;
    const password = (lockInput.value || '').trim();
    if (!password) {
      showLockError('비밀번호를 입력하세요.');
      try { lockInput.focus(); } catch (_) {}
      isLoggingIn = false;
      return;
    }
    showLockError('');
    showLockLoading(true);
    try {
      const res = await fetch(AUTH_URL, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        mode: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ password })
      });
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      let dataResp = null;
      if (ct.includes('application/json')) {
        try { dataResp = await res.json(); } catch (_) { dataResp = null; }
      }
      if (!res.ok) {
        const msg = (dataResp && dataResp.error && dataResp.error.message)
          ? dataResp.error.message
          : `오류 (HTTP ${res.status})`;
        showLockError(msg);
        try { lockInput.select(); } catch (_) {}
        return;
      }
      if (!dataResp || !dataResp.token) {
        showLockError('서버 응답이 올바르지 않습니다.');
        return;
      }
      setToken(dataResp.token);
      lockInput.value = '';
      showLockError('');
      toast('접속되었습니다');
    } catch (err) {
      showLockError('네트워크 오류: ' + (err && err.message ? err.message : err));
    } finally {
      showLockLoading(false);
      isLoggingIn = false;
    }
  }
  lockForm.addEventListener('submit', (e) => {
    e.preventDefault(); e.stopPropagation();
    performLogin();
  });

  if (getToken()) applyAuthedUI();
  else setTimeout(() => { try { lockInput.focus(); } catch (_) {} }, 100);

  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      if (!confirm('로그아웃 하시겠습니까?')) return;
      lockOut('');
      try { lockInput.value = ''; } catch (_) {}
      toast('로그아웃 되었습니다');
    });
  }

  /* ── Toast ─────────────────────────────────────────────── */
  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  /* ── 날짜 유틸 ─────────────────────────────────────────── */
  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function ymdOf(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function ymOf(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }
  function todayYmd() { return ymdOf(new Date()); }
  function parseYmd(s) {
    if (!s || typeof s !== 'string') return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  }
  const DOW_KO = ['일','월','화','수','목','금','토'];
  function formatDayLabel(ymd) {
    const d = parseYmd(ymd);
    if (!d) return ymd;
    return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  }
  function formatDow(ymd) {
    const d = parseYmd(ymd);
    if (!d) return '';
    return '(' + DOW_KO[d.getDay()] + ')';
  }
  function formatMonthLabel(ym) {
    const m = /^(\d{4})-(\d{2})$/.exec(ym);
    if (!m) return ym;
    return `${m[1]}년 ${parseInt(m[2], 10)}월`;
  }
  function shiftMonth(ym, delta) {
    const m = /^(\d{4})-(\d{2})$/.exec(ym);
    if (!m) return ym;
    let y = parseInt(m[1], 10);
    let mo = parseInt(m[2], 10) + delta;
    while (mo > 12) { mo -= 12; y += 1; }
    while (mo < 1)  { mo += 12; y -= 1; }
    return y + '-' + pad2(mo);
  }

  /* ── 숫자 유틸 ─────────────────────────────────────────── */
  function digitsOnly(s) { return (s || '').toString().replace(/[^0-9]/g, ''); }
  function parseAmount(s) {
    const n = parseInt(digitsOnly(s), 10);
    return Number.isFinite(n) ? n : 0;
  }
  function formatThousands(n) {
    n = Math.round(Number(n) || 0);
    return n.toLocaleString('ko-KR');
  }
  function formatWon(n) {
    return formatThousands(n) + '원';
  }
  function attachThousandsFormatter(inputEl) {
    inputEl.addEventListener('input', () => {
      const cursorAtEnd = (inputEl.selectionStart === inputEl.value.length);
      const raw = digitsOnly(inputEl.value);
      inputEl.value = raw ? formatThousands(raw) : '';
      if (cursorAtEnd) {
        try { inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length); } catch (_) {}
      }
    });
    inputEl.addEventListener('blur', () => {
      const raw = digitsOnly(inputEl.value);
      inputEl.value = raw ? formatThousands(raw) : '';
    });
  }
  attachThousandsFormatter(sAmount);
  attachThousandsFormatter(sDiscount);
  attachThousandsFormatter(pAmount);

  /* ── 저장소 ────────────────────────────────────────────── */
  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { sales: [], purchases: [] };
      const obj = JSON.parse(raw);
      return {
        sales:     Array.isArray(obj.sales) ? obj.sales : [],
        purchases: Array.isArray(obj.purchases) ? obj.purchases : []
      };
    } catch (_) {
      return { sales: [], purchases: [] };
    }
  }
  function saveLocal() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
    catch (e) {
      toast('저장 실패: 브라우저 저장 공간을 확인하세요');
    }
  }
  // saveData = 로컬 저장 + (연결 시) Drive 자동 동기화
  function saveData() {
    saveLocal();
    scheduleDriveSync();
  }
  data = loadData();

  function nextId(arr) {
    let max = 0;
    for (const it of arr) {
      if (it && typeof it.id === 'number' && it.id > max) max = it.id;
    }
    return max + 1;
  }

  /* ── 탭 전환 ───────────────────────────────────────────── */
  function setTab(tab) {
    activeTab = tab;
    const isSales = tab === 'sales';
    tabSales.classList.toggle('active', isSales);
    tabSales.setAttribute('aria-selected', String(isSales));
    tabPurchase.classList.toggle('active', !isSales);
    tabPurchase.setAttribute('aria-selected', String(!isSales));

    salesForm.style.display    = isSales ? '' : 'none';
    purchaseForm.style.display = isSales ? 'none' : '';

    formTitle.textContent    = isSales ? '매출 입력' : '매입 입력';
    formSubtitle.textContent = isSales ? '환자/시술/결제 정보를 입력' : '거래처/결제 정보를 입력';
    listTitle.textContent    = isSales ? '매출 내역' : '매입 내역';

    cancelEditMode();
    renderList();
  }
  tabSales.addEventListener('click',    () => setTab('sales'));
  tabPurchase.addEventListener('click', () => setTab('purchase'));

  /* ── 월 네비 ───────────────────────────────────────────── */
  function setMonth(ym) {
    viewMonth = ym;
    monthLabel.textContent    = formatMonthLabel(ym);
    listMonthSub.textContent  = formatMonthLabel(ym);
    renderList();
  }
  monthPrev.addEventListener('click',  () => setMonth(shiftMonth(viewMonth, -1)));
  monthNext.addEventListener('click',  () => setMonth(shiftMonth(viewMonth,  1)));
  monthToday.addEventListener('click', () => setMonth(ymOf(new Date())));

  /* ── 결제방식 → 카드사 필드 토글 ──────────────────────── */
  function syncCardField(payMethodEl, cardFieldEl, cardSelectEl, isSales) {
    const v = payMethodEl.value;
    const need = (v === '카드');
    cardFieldEl.style.display = need ? '' : 'none';
    if (!need) cardSelectEl.value = '';
  }
  sPayMethod.addEventListener('change', () => syncCardField(sPayMethod, sCardCompanyField, sCardCompany, true));
  pPayMethod.addEventListener('change', () => syncCardField(pPayMethod, pCardCompanyField, pCardCompany, false));

  /* ── 폼 초기화/수정모드 ─────────────────────────────────── */
  function resetSalesForm(keepDate) {
    const keep = keepDate || sDate.value || todayYmd();
    sDate.value = keep;
    sChart.value = '';
    sName.value = '';
    sVisit.value = '재진';
    sCategory.value = '';
    sDetail.value = '';
    sAmount.value = '';
    sDiscount.value = '';
    sPayMethod.value = '순수현금';
    sCardCompany.value = '';
    syncCardField(sPayMethod, sCardCompanyField, sCardCompany, true);
  }
  function resetPurchaseForm(keepDate) {
    const keep = keepDate || pDate.value || todayYmd();
    pDate.value = keep;
    pVendor.value = '';
    pPayMethod.value = '현금';
    pCardCompany.value = '';
    pAmount.value = '';
    syncCardField(pPayMethod, pCardCompanyField, pCardCompany, false);
  }
  function enterEditMode() {
    editBanner.classList.add('show');
    if (activeTab === 'sales')    sSubmitLabel.textContent = '저장';
    else                          pSubmitLabel.textContent = '저장';
  }
  function cancelEditMode() {
    editingId = null;
    editBanner.classList.remove('show');
    sSubmitLabel.textContent = '추가';
    pSubmitLabel.textContent = '추가';
  }
  cancelEdit.addEventListener('click', () => {
    if (activeTab === 'sales') resetSalesForm();
    else                       resetPurchaseForm();
    cancelEditMode();
  });
  sReset.addEventListener('click', () => { resetSalesForm();    cancelEditMode(); });
  pReset.addEventListener('click', () => { resetPurchaseForm(); cancelEditMode(); });

  /* ── 폼 → 객체 ─────────────────────────────────────────── */
  function readSalesFromForm() {
    const date = sDate.value;
    const name = (sName.value || '').trim();
    if (!date)  { toast('일자를 입력하세요'); sDate.focus(); return null; }
    if (!name)  { toast('이름을 입력하세요'); sName.focus(); return null; }

    const amount = parseAmount(sAmount.value);
    if (amount <= 0) { toast('금액을 입력하세요'); sAmount.focus(); return null; }

    const payMethod = sPayMethod.value;
    let cardCompany = '';
    if (payMethod === '카드') {
      cardCompany = sCardCompany.value;
      if (!cardCompany) { toast('카드사를 선택하세요'); sCardCompany.focus(); return null; }
    }

    return {
      date,
      chartNo:     (sChart.value || '').trim(),
      name,
      visitType:   sVisit.value,
      category:    sCategory.value || '',
      detail:      (sDetail.value || '').trim(),
      amount,
      discount:    parseAmount(sDiscount.value),
      payMethod,
      cardCompany
    };
  }
  function readPurchaseFromForm() {
    const date   = pDate.value;
    const vendor = (pVendor.value || '').trim();
    if (!date)   { toast('일자를 입력하세요'); pDate.focus(); return null; }
    if (!vendor) { toast('상호명을 입력하세요'); pVendor.focus(); return null; }
    const amount = parseAmount(pAmount.value);
    if (amount <= 0) { toast('금액을 입력하세요'); pAmount.focus(); return null; }

    const payMethod = pPayMethod.value;
    let cardCompany = '';
    if (payMethod === '카드') {
      cardCompany = pCardCompany.value;
      if (!cardCompany) { toast('카드사를 선택하세요'); pCardCompany.focus(); return null; }
    }
    return { date, vendor, payMethod, cardCompany, amount };
  }

  /* ── 객체 → 폼 ─────────────────────────────────────────── */
  function fillSalesForm(it) {
    sDate.value       = it.date || todayYmd();
    sChart.value      = it.chartNo || '';
    sName.value       = it.name || '';
    sVisit.value      = it.visitType || '재진';
    sCategory.value   = it.category || '';
    sDetail.value     = it.detail || '';
    sAmount.value     = it.amount ? formatThousands(it.amount) : '';
    sDiscount.value   = it.discount ? formatThousands(it.discount) : '';
    sPayMethod.value  = it.payMethod || '순수현금';
    syncCardField(sPayMethod, sCardCompanyField, sCardCompany, true);
    sCardCompany.value= it.cardCompany || '';
  }
  function fillPurchaseForm(it) {
    pDate.value       = it.date || todayYmd();
    pVendor.value     = it.vendor || '';
    pPayMethod.value  = it.payMethod || '현금';
    syncCardField(pPayMethod, pCardCompanyField, pCardCompany, false);
    pCardCompany.value= it.cardCompany || '';
    pAmount.value     = it.amount ? formatThousands(it.amount) : '';
  }

  /* ── 제출 (추가 / 저장) ───────────────────────────────── */
  salesForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const payload = readSalesFromForm();
    if (!payload) return;

    if (editingId != null) {
      const i = data.sales.findIndex((x) => x.id === editingId);
      if (i >= 0) {
        data.sales[i] = Object.assign({}, data.sales[i], payload);
        saveData();
        toast('수정되었습니다');
      }
      cancelEditMode();
    } else {
      const it = Object.assign({ id: nextId(data.sales), createdAt: Date.now() }, payload);
      data.sales.push(it);
      saveData();
      toast('매출이 추가되었습니다');
    }
    // 다음 입력을 위해 일자만 유지, 환자정보 초기화
    const keepDate = sDate.value;
    resetSalesForm(keepDate);
    // 입력한 항목의 월로 자동 이동
    if (ymOf(parseYmd(payload.date)) !== viewMonth) {
      setMonth(ymOf(parseYmd(payload.date)));
    } else {
      renderList();
    }
    try { sName.focus(); } catch (_) {}
  });

  purchaseForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const payload = readPurchaseFromForm();
    if (!payload) return;

    if (editingId != null) {
      const i = data.purchases.findIndex((x) => x.id === editingId);
      if (i >= 0) {
        data.purchases[i] = Object.assign({}, data.purchases[i], payload);
        saveData();
        toast('수정되었습니다');
      }
      cancelEditMode();
    } else {
      const it = Object.assign({ id: nextId(data.purchases), createdAt: Date.now() }, payload);
      data.purchases.push(it);
      saveData();
      toast('매입이 추가되었습니다');
    }
    const keepDate = pDate.value;
    resetPurchaseForm(keepDate);
    if (ymOf(parseYmd(payload.date)) !== viewMonth) {
      setMonth(ymOf(parseYmd(payload.date)));
    } else {
      renderList();
    }
    try { pVendor.focus(); } catch (_) {}
  });

  /* ── 수정 시작 ─────────────────────────────────────────── */
  function startEdit(kind, id) {
    if (kind === 'sales') {
      if (activeTab !== 'sales') setTab('sales');
      const it = data.sales.find((x) => x.id === id);
      if (!it) return;
      editingId = id;
      fillSalesForm(it);
      enterEditMode();
    } else {
      if (activeTab !== 'purchase') setTab('purchase');
      const it = data.purchases.find((x) => x.id === id);
      if (!it) return;
      editingId = id;
      fillPurchaseForm(it);
      enterEditMode();
    }
    // 폼으로 스크롤
    try { document.querySelector('.form-body').scrollTop = 0; } catch (_) {}
  }

  /* ── 삭제 ──────────────────────────────────────────────── */
  function deleteEntry(kind, id) {
    if (!confirm('이 항목을 삭제할까요?')) return;
    if (kind === 'sales') {
      data.sales = data.sales.filter((x) => x.id !== id);
    } else {
      data.purchases = data.purchases.filter((x) => x.id !== id);
    }
    if (editingId === id) cancelEditMode();
    saveData();
    renderList();
    toast('삭제되었습니다');
  }

  /* ── 월별 필터링 + 일별 그룹핑 ─────────────────────────── */
  function filterByMonth(items, ym) {
    return items.filter((it) => (it.date || '').startsWith(ym));
  }
  function groupByDate(items) {
    const map = new Map();
    for (const it of items) {
      const k = it.date || '';
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(it);
    }
    // 최신 일자 먼저
    const keys = Array.from(map.keys()).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    return keys.map((k) => ({ date: k, items: map.get(k) }));
  }

  function totalSales(items) {
    let s = 0;
    for (const it of items) s += (it.amount || 0) - (it.discount || 0);
    return s;
  }
  function totalPurchases(items) {
    let s = 0;
    for (const it of items) s += (it.amount || 0);
    return s;
  }

  /* ── 렌더링 ────────────────────────────────────────────── */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function payTagClass(method) {
    if (method === '순수현금' || method === '현금') return 'cash';
    if (method === '현영발행') return 'cashreceipt';
    if (method === '카드') return 'card';
    return '';
  }
  function payLabel(it) {
    if (it.payMethod === '카드' && it.cardCompany) return `카드(${it.cardCompany})`;
    return it.payMethod || '';
  }

  function renderSalesRow(it) {
    const net = (it.amount || 0) - (it.discount || 0);
    const tagClass = payTagClass(it.payMethod);
    return `
      <tr data-id="${it.id}">
        <td>
          <div class="chart">${escapeHtml(it.chartNo || '—')}</div>
          <div class="name">${escapeHtml(it.name || '')}</div>
        </td>
        <td>
          <span class="tag visit-${escapeHtml(it.visitType || '재진')}">${escapeHtml(it.visitType || '재진')}</span>
        </td>
        <td>${escapeHtml(it.category || '—')}</td>
        <td class="detail">${escapeHtml(it.detail || '')}</td>
        <td><span class="tag pay ${tagClass}">${escapeHtml(payLabel(it))}</span></td>
        <td class="num">${formatThousands(it.amount || 0)}</td>
        <td class="num">${(it.discount || 0) > 0 ? '-' + formatThousands(it.discount) : '0'}</td>
        <td class="num"><b>${formatThousands(net)}</b></td>
        <td>
          <span class="row-actions">
            <button type="button" class="edit" data-act="edit" data-kind="sales" data-id="${it.id}" aria-label="수정" title="수정">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button type="button" class="del" data-act="del" data-kind="sales" data-id="${it.id}" aria-label="삭제" title="삭제">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6M14 11v6"/>
                <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          </span>
        </td>
      </tr>
    `;
  }
  function renderPurchaseRow(it) {
    const tagClass = payTagClass(it.payMethod);
    return `
      <tr data-id="${it.id}">
        <td><div class="name">${escapeHtml(it.vendor || '')}</div></td>
        <td><span class="tag pay ${tagClass}">${escapeHtml(payLabel(it))}</span></td>
        <td class="num"><b>${formatThousands(it.amount || 0)}</b></td>
        <td>
          <span class="row-actions">
            <button type="button" class="edit" data-act="edit" data-kind="purchase" data-id="${it.id}" aria-label="수정" title="수정">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button type="button" class="del" data-act="del" data-kind="purchase" data-id="${it.id}" aria-label="삭제" title="삭제">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6M14 11v6"/>
                <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          </span>
        </td>
      </tr>
    `;
  }

  function renderEmpty(kind) {
    const isSales = kind === 'sales';
    return `
      <div class="empty-state">
        <div class="empty-ic">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
        </div>
        <p>${formatMonthLabel(viewMonth)} ${isSales ? '매출' : '매입'} 내역이 없습니다.</p>
        <p class="hint">좌측 폼에서 새 ${isSales ? '매출을' : '매입을'} 입력하세요.</p>
      </div>
    `;
  }

  function renderList() {
    // 요약: 월 매출/매입은 항상 양쪽 모두 표시
    const monthSales     = filterByMonth(data.sales, viewMonth);
    const monthPurchases = filterByMonth(data.purchases, viewMonth);
    const sumS = totalSales(monthSales);
    const sumP = totalPurchases(monthPurchases);
    sumSalesEl.textContent    = formatWon(sumS);
    sumPurchaseEl.textContent = formatWon(sumP);
    sumNetEl.textContent      = formatWon(sumS - sumP);

    // 활성 탭의 목록
    const isSales = activeTab === 'sales';
    const items   = isSales ? monthSales : monthPurchases;
    listCountSub.textContent = items.length + '건';

    if (!items.length) {
      listScroll.innerHTML = renderEmpty(activeTab);
      return;
    }

    const groups = groupByDate(items);
    const parts = [];

    for (const g of groups) {
      const dayTotal = isSales ? totalSales(g.items) : totalPurchases(g.items);
      const headHtml = `
        <div class="day-head ${activeTab}">
          <div class="day-label">
            <span>${escapeHtml(formatDayLabel(g.date))} <span class="dow">${escapeHtml(formatDow(g.date))}</span></span>
            <span class="count">${g.items.length}</span>
          </div>
          <div class="day-total">${formatWon(dayTotal)}</div>
        </div>
      `;
      let tableHtml;
      if (isSales) {
        tableHtml = `
          <table class="entry-table">
            <thead>
              <tr>
                <th>차트/이름</th>
                <th>구분</th>
                <th>항목</th>
                <th>상세</th>
                <th>결제</th>
                <th class="num">금액</th>
                <th class="num">할인</th>
                <th class="num">합계</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${g.items.map(renderSalesRow).join('')}
            </tbody>
          </table>
        `;
      } else {
        tableHtml = `
          <table class="entry-table">
            <thead>
              <tr>
                <th>상호명</th>
                <th>결제</th>
                <th class="num">금액</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${g.items.map(renderPurchaseRow).join('')}
            </tbody>
          </table>
        `;
      }
      parts.push(`<div class="day-group">${headHtml}${tableHtml}</div>`);
    }

    listScroll.innerHTML = parts.join('');
  }

  // 위임: 수정/삭제 버튼 클릭
  listScroll.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act  = btn.dataset.act;
    const kind = btn.dataset.kind;
    const id   = parseInt(btn.dataset.id, 10);
    if (!Number.isFinite(id)) return;
    if (act === 'edit') startEdit(kind, id);
    else if (act === 'del') deleteEntry(kind, id);
  });

  /* ── 엑셀 내보내기 ─────────────────────────────────────── */
  function exportExcel() {
    if (typeof XLSX === 'undefined') {
      toast('엑셀 라이브러리 로딩 실패');
      return;
    }
    const ym = viewMonth;
    const monthSales     = filterByMonth(data.sales, ym);
    const monthPurchases = filterByMonth(data.purchases, ym);

    if (!monthSales.length && !monthPurchases.length) {
      toast('해당 월에 내보낼 데이터가 없습니다');
      return;
    }

    // 매출 시트
    const salesHeader = [
      '일자', '차트번호', '이름', '내원구분', '구분', '진료상세내역',
      '금액', '할인', '합계', '결제방식', '카드사'
    ];
    const salesRows = monthSales
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0)))
      .map((it) => [
        it.date || '',
        it.chartNo || '',
        it.name || '',
        it.visitType || '',
        it.category || '',
        it.detail || '',
        it.amount || 0,
        it.discount || 0,
        (it.amount || 0) - (it.discount || 0),
        it.payMethod || '',
        it.cardCompany || ''
      ]);
    // 합계 행
    const salesAmountSum   = salesRows.reduce((s, r) => s + (r[6] || 0), 0);
    const salesDiscountSum = salesRows.reduce((s, r) => s + (r[7] || 0), 0);
    const salesNetSum      = salesRows.reduce((s, r) => s + (r[8] || 0), 0);
    salesRows.push([]);
    salesRows.push(['합계', '', '', '', '', '', salesAmountSum, salesDiscountSum, salesNetSum, '', '']);

    const wsSales = XLSX.utils.aoa_to_sheet([salesHeader, ...salesRows]);
    wsSales['!cols'] = [
      { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 8 },
      { wch: 14 }, { wch: 30 }, { wch: 12 }, { wch: 10 },
      { wch: 12 }, { wch: 10 }, { wch: 10 }
    ];

    // 매입 시트
    const purchaseHeader = ['일자', '상호명', '결제방식', '카드사', '금액'];
    const purchaseRows = monthPurchases
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0)))
      .map((it) => [
        it.date || '',
        it.vendor || '',
        it.payMethod || '',
        it.cardCompany || '',
        it.amount || 0
      ]);
    const purchaseAmountSum = purchaseRows.reduce((s, r) => s + (r[4] || 0), 0);
    purchaseRows.push([]);
    purchaseRows.push(['합계', '', '', '', purchaseAmountSum]);

    const wsPurchase = XLSX.utils.aoa_to_sheet([purchaseHeader, ...purchaseRows]);
    wsPurchase['!cols'] = [
      { wch: 12 }, { wch: 22 }, { wch: 10 }, { wch: 10 }, { wch: 14 }
    ];

    // 숫자 셀 포맷 (천단위 표기는 엑셀에서 처리)
    function applyNumberFormat(ws, colIdxs) {
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
      for (let R = range.s.r + 1; R <= range.e.r; R++) {
        for (const C of colIdxs) {
          const addr = XLSX.utils.encode_cell({ r: R, c: C });
          const cell = ws[addr];
          if (cell && typeof cell.v === 'number') {
            cell.t = 'n';
            cell.z = '#,##0';
          }
        }
      }
    }
    applyNumberFormat(wsSales,    [6, 7, 8]);
    applyNumberFormat(wsPurchase, [4]);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsSales,    '매출');
    XLSX.utils.book_append_sheet(wb, wsPurchase, '매입');

    const fname = `cashbook_${ym.replace('-', '_')}.xlsx`;
    XLSX.writeFile(wb, fname);
    toast(`${fname} 저장됨`);
  }
  excelBtn.addEventListener('click', exportExcel);

  /* ============================================================
     Google Drive 동기화 (선택적)
     ----------------------------------------------------------------
     - GOOGLE_CLIENT_ID 환경변수가 설정돼 있어야 활성화됨
     - 미연결/미설정 시: localStorage 폴백 (기존 동작 그대로)
     - 연결 시: 페이지 로드 → Drive 에서 fetch (로컬 덮어쓰기)
                CRUD → 1.2초 debounce 후 Drive 로 push
     - 파일은 Drive 의 appDataFolder 에 저장 (앱 전용·숨김)
     ============================================================ */
  function setDriveUiState(state) {
    if (!driveBtn) return;
    driveBtn.classList.remove('connected', 'syncing', 'error');
    const label = driveBtn.querySelector('.drive-label');
    if (state === 'hidden') {
      driveBtn.style.display = 'none';
      return;
    }
    driveBtn.style.display = '';
    if (state === 'disconnected') {
      if (label) label.textContent = 'Drive 연결';
      driveBtn.title = 'Google Drive 와 동기화';
    } else if (state === 'connecting') {
      driveBtn.classList.add('syncing');
      if (label) label.textContent = '연결 중…';
      driveBtn.title = 'Google 인증 중';
    } else if (state === 'connected') {
      driveBtn.classList.add('connected');
      if (label) label.textContent = 'Drive 연결됨';
      driveBtn.title = 'Google Drive 연결됨 (클릭 시 해제)';
    } else if (state === 'syncing') {
      driveBtn.classList.add('connected', 'syncing');
      if (label) label.textContent = '동기화 중…';
    } else if (state === 'error') {
      driveBtn.classList.add('error');
      if (label) label.textContent = '동기화 오류';
      driveBtn.title = '동기화 오류 — 클릭 시 재연결';
    }
  }

  function saveCachedDriveToken(token, expiresInSec) {
    const expiryMs = Date.now() + (parseInt(expiresInSec, 10) || 3600) * 1000;
    try {
      sessionStorage.setItem(DRIVE_TOKEN_KEY, token);
      sessionStorage.setItem(DRIVE_TOKEN_EXPIRY_KEY, String(expiryMs));
      localStorage.setItem(DRIVE_SIGNED_IN_KEY, '1');
    } catch (_) {}
  }
  function loadCachedDriveToken() {
    try {
      const token  = sessionStorage.getItem(DRIVE_TOKEN_KEY);
      const expiry = parseInt(sessionStorage.getItem(DRIVE_TOKEN_EXPIRY_KEY), 10);
      const fileId = sessionStorage.getItem(DRIVE_FILE_ID_KEY) || '';
      if (token && expiry && Date.now() < expiry - 60_000) {
        driveAccessToken = token;
        if (fileId) driveFileId = fileId;
        return true;
      }
    } catch (_) {}
    return false;
  }
  function clearCachedDriveToken() {
    try {
      sessionStorage.removeItem(DRIVE_TOKEN_KEY);
      sessionStorage.removeItem(DRIVE_TOKEN_EXPIRY_KEY);
      sessionStorage.removeItem(DRIVE_FILE_ID_KEY);
    } catch (_) {}
  }
  function handleDriveAuthLoss(reason) {
    driveAccessToken = '';
    driveFileId      = '';
    clearCachedDriveToken();
    try { localStorage.removeItem(DRIVE_SIGNED_IN_KEY); } catch (_) {}
    if (driveRefreshTimer) { clearTimeout(driveRefreshTimer); driveRefreshTimer = null; }
    setDriveUiState(googleClientId ? 'disconnected' : 'hidden');
    if (reason) toast(reason);
  }

  async function fetchGoogleConfig() {
    try {
      const res = await fetch(CONFIG_URL, { cache: 'no-store' });
      if (!res.ok) return;
      const j = await res.json();
      googleClientId = (j && typeof j.googleClientId === 'string') ? j.googleClientId : '';
    } catch (_) {}
  }
  function waitForGIS(timeoutMs) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const ok = () => !!(window.google && window.google.accounts && window.google.accounts.oauth2);
      if (ok()) return resolve();
      const id = setInterval(() => {
        if (ok()) { clearInterval(id); resolve(); }
        else if (Date.now() - t0 > (timeoutMs || 8000)) {
          clearInterval(id);
          reject(new Error('Google Identity Services failed to load'));
        }
      }, 100);
    });
  }
  function initTokenClient() {
    if (!googleClientId || !window.google) return;
    driveTokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: googleClientId,
      scope:     DRIVE_SCOPES,
      callback:  async (resp) => {
        if (resp && resp.error) {
          setDriveUiState('disconnected');
          toast('Google 인증 실패: ' + (resp.error_description || resp.error));
          return;
        }
        if (!resp || !resp.access_token) {
          setDriveUiState('disconnected');
          return;
        }
        driveAccessToken = resp.access_token;
        saveCachedDriveToken(resp.access_token, resp.expires_in);
        setDriveUiState('connected');
        scheduleDriveTokenRefresh(parseInt(resp.expires_in, 10) || 3600);
        // 첫 연결: 로컬에 데이터가 있으면 confirm, 그 외 자연스러운 동기화
        const isFirstSignIn = !sessionStorage.getItem(DRIVE_TOKEN_EXPIRY_KEY + '_last');
        try { sessionStorage.setItem(DRIVE_TOKEN_EXPIRY_KEY + '_last', '1'); } catch (_) {}
        try { await initialDriveSync(isFirstSignIn); } catch (_) {}
      },
      error_callback: (err) => {
        setDriveUiState('disconnected');
        if (err && err.type !== 'popup_closed') {
          toast('Google 인증 오류');
        }
      }
    });
  }
  function scheduleDriveTokenRefresh(expiresInSec) {
    if (driveRefreshTimer) clearTimeout(driveRefreshTimer);
    const refreshMs = Math.max(60_000, ((expiresInSec || 3600) - 120) * 1000);
    driveRefreshTimer = setTimeout(() => {
      if (driveTokenClient) driveTokenClient.requestAccessToken({ prompt: '' });
    }, refreshMs);
  }

  function driveSignInClick() {
    if (!googleClientId) {
      toast('GOOGLE_CLIENT_ID 가 서버에 설정되지 않았습니다');
      return;
    }
    if (!driveTokenClient) {
      toast('Google 클라이언트 초기화 중입니다. 잠시 후 다시 시도하세요.');
      return;
    }
    if (driveAccessToken) {
      // 이미 연결됨 → 해제 옵션
      if (confirm('Google Drive 연결을 해제할까요?\n(이후 변경사항은 Drive 에 저장되지 않습니다)')) {
        const t = driveAccessToken;
        if (window.google && google.accounts.oauth2) {
          try { google.accounts.oauth2.revoke(t, () => {}); } catch (_) {}
        }
        handleDriveAuthLoss('Google Drive 연결 해제됨');
      }
      return;
    }
    setDriveUiState('connecting');
    // prompt 비워두면 이미 동의했던 경우 silent, 아니면 동의 UI
    driveTokenClient.requestAccessToken({ prompt: '' });
  }

  /* ── Drive REST helpers ─────────────────────────────── */
  async function driveListFile() {
    if (!driveAccessToken) return null;
    const q   = encodeURIComponent("name='" + DRIVE_FILENAME + "'");
    const url = 'https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=' + q + '&fields=files(id,modifiedTime)';
    const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + driveAccessToken } });
    if (res.status === 401) { handleDriveAuthLoss('Drive 인증이 만료되었습니다. 다시 연결하세요.'); return null; }
    if (!res.ok) throw new Error('Drive list 실패 (' + res.status + ')');
    const j = await res.json();
    return (j && j.files && j.files[0]) || null;
  }
  async function driveReadFile(fileId) {
    if (!driveAccessToken || !fileId) return null;
    const res = await fetch('https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media', {
      headers: { 'Authorization': 'Bearer ' + driveAccessToken }
    });
    if (res.status === 401) { handleDriveAuthLoss('Drive 인증이 만료되었습니다.'); return null; }
    if (!res.ok) throw new Error('Drive read 실패 (' + res.status + ')');
    try { return await res.json(); } catch (_) { return null; }
  }
  async function driveWriteFile(content) {
    if (!driveAccessToken) return false;
    const body = JSON.stringify(content);
    let res;
    if (driveFileId) {
      res = await fetch('https://www.googleapis.com/upload/drive/v3/files/' + driveFileId + '?uploadType=media', {
        method:  'PATCH',
        headers: { 'Authorization': 'Bearer ' + driveAccessToken, 'Content-Type': 'application/json' },
        body
      });
    } else {
      const metadata = { name: DRIVE_FILENAME, parents: ['appDataFolder'] };
      const boundary = '----cashbook' + Date.now();
      const delim    = '\r\n--' + boundary + '\r\n';
      const close    = '\r\n--' + boundary + '--';
      const multi    =
        delim + 'Content-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata) +
        delim + 'Content-Type: application/json\r\n\r\n' + body + close;
      res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
        method:  'POST',
        headers: { 'Authorization': 'Bearer ' + driveAccessToken, 'Content-Type': 'multipart/related; boundary=' + boundary },
        body:    multi
      });
    }
    if (res.status === 401) { handleDriveAuthLoss('Drive 인증이 만료되었습니다.'); return false; }
    if (!res.ok) throw new Error('Drive write 실패 (' + res.status + ')');
    if (!driveFileId) {
      const j = await res.json();
      driveFileId = (j && j.id) || '';
      try { if (driveFileId) sessionStorage.setItem(DRIVE_FILE_ID_KEY, driveFileId); } catch (_) {}
    }
    return true;
  }

  async function initialDriveSync(isFirstSignIn) {
    if (!driveAccessToken) return;
    setDriveUiState('syncing');
    try {
      const meta = await driveListFile();
      if (meta && meta.id) {
        driveFileId = meta.id;
        try { sessionStorage.setItem(DRIVE_FILE_ID_KEY, driveFileId); } catch (_) {}

        // 사용자 첫 연결이고 로컬 데이터가 있으면 충돌 조정
        const hasLocal = (data.sales && data.sales.length) || (data.purchases && data.purchases.length);
        if (isFirstSignIn && hasLocal) {
          const remote    = await driveReadFile(meta.id);
          const remoteCnt =
            ((remote && Array.isArray(remote.sales))     ? remote.sales.length     : 0) +
            ((remote && Array.isArray(remote.purchases)) ? remote.purchases.length : 0);
          const localCnt  = data.sales.length + data.purchases.length;
          const useDrive  = confirm(
            'Drive 에 저장된 데이터가 있습니다.\n\n' +
            '  Drive: ' + remoteCnt + '건\n' +
            '  현재 기기: ' + localCnt + '건\n\n' +
            '[확인] Drive 데이터 불러오기 (현재 기기 데이터 덮어쓰기)\n' +
            '[취소] 현재 기기 데이터를 Drive 에 업로드 (Drive 데이터 덮어쓰기)'
          );
          if (useDrive) {
            if (remote && typeof remote === 'object') {
              applyRemoteData(remote);
              toast('Drive 데이터 불러옴');
            }
          } else {
            const ok = await driveWriteFile(data);
            if (ok) toast('현재 기기 데이터를 Drive 에 업로드');
          }
          setDriveUiState('connected');
          return;
        }

        // 일반 경로: Drive → 로컬 (페이지 로드 시 최신 데이터)
        const remote = await driveReadFile(meta.id);
        if (remote && typeof remote === 'object') {
          applyRemoteData(remote);
          if (isFirstSignIn) toast('Drive 데이터 불러옴');
        }
      } else {
        // 원격에 파일 없음 → 로컬을 Drive 로
        const ok = await driveWriteFile(data);
        if (ok && isFirstSignIn) toast('Drive 에 초기 데이터 업로드');
      }
      setDriveUiState('connected');
    } catch (e) {
      console.error('initialDriveSync failed:', e);
      setDriveUiState('error');
      toast('Drive 동기화 실패');
    }
  }

  function applyRemoteData(remote) {
    data = {
      sales:     Array.isArray(remote.sales)     ? remote.sales     : [],
      purchases: Array.isArray(remote.purchases) ? remote.purchases : []
    };
    // 진행 중이던 수정모드는 안전을 위해 취소
    if (editingId != null) {
      editingId = null;
      editBanner.classList.remove('show');
      sSubmitLabel.textContent = '추가';
      pSubmitLabel.textContent = '추가';
    }
    saveLocal();
    renderList();
  }

  function scheduleDriveSync() {
    if (!driveAccessToken) return;
    if (driveSyncTimer) clearTimeout(driveSyncTimer);
    setDriveUiState('syncing');
    driveSyncTimer = setTimeout(async () => {
      try {
        const ok = await driveWriteFile(data);
        setDriveUiState(ok ? 'connected' : 'error');
      } catch (e) {
        console.error('drive sync failed:', e);
        setDriveUiState('error');
      }
    }, 1200);
  }

  async function initGoogleDrive() {
    if (!driveBtn) return;
    await fetchGoogleConfig();
    if (!googleClientId) {
      setDriveUiState('hidden');
      return;
    }
    try {
      await waitForGIS();
      initTokenClient();
      setDriveUiState('disconnected');
      // 캐시 토큰이 있으면 자동 사용
      if (loadCachedDriveToken()) {
        setDriveUiState('connected');
        try { sessionStorage.setItem(DRIVE_TOKEN_EXPIRY_KEY + '_last', '1'); } catch (_) {}
        try { await initialDriveSync(false); } catch (_) {}
      }
    } catch (e) {
      console.error('initGoogleDrive failed:', e);
      setDriveUiState('hidden');
    }
  }

  if (driveBtn) driveBtn.addEventListener('click', driveSignInClick);

  /* ── 초기 ──────────────────────────────────────────────── */
  // 일자 디폴트 = 오늘
  sDate.value = todayYmd();
  pDate.value = todayYmd();
  syncCardField(sPayMethod, sCardCompanyField, sCardCompany, true);
  syncCardField(pPayMethod, pCardCompanyField, pCardCompany, false);
  setMonth(viewMonth);
  initGoogleDrive();
})();
