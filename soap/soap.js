/* ============================================================
   AI 진료 노트 — Clinical App
   ----------------------------------------------------------------
   - Web Speech API (한국어 ko-KR)로 실시간 음성 인식
   - 의사/환자 발화자 수동 토글
   - 인식 결과는 메모리에서만 유지 (새로고침 시 초기화)
   - SOAP 노트 생성: 서버리스 프록시(/api/claude) 호출
     (Claude API 키는 서버 측 ANTHROPIC_API_KEY 환경변수로만 관리)
   ============================================================ */

(function () {
  'use strict';

  /* ── DOM ───────────────────────────────────────────────── */
  const $ = (id) => document.getElementById(id);

  // 상단
  const topStatus      = $('topStatus');
  const topStatusLabel = topStatus.querySelector('.status-label');
  const settingsBtn    = $('settingsBtn');
  const logoutBtn      = $('logoutBtn');

  // 모달
  const modal       = $('modal');
  const modalClose  = $('modalClose');
  const modalDone   = $('modalDone');

  // 패널 좌 (대화)
  const browserWarn     = $('browserWarn');
  const speakerBtns     = document.querySelectorAll('.spk');
  const transcriptEl    = $('transcript');
  const transcriptEmpty = $('transcriptEmpty');
  const msgCountEl      = $('msgCount');
  const recBtn          = $('recBtn');
  const recBtnLabel     = $('recBtnLabel');
  const clearBtn        = $('clearBtn');

  // 패널 우 (SOAP)
  const genBtn       = $('genBtn');
  const genBtnLabel  = $('genBtnLabel');
  const soapView     = $('soapView');
  const soapEmpty    = $('soapEmpty');
  const soapText     = $('soapText');
  const copyBtn      = $('copyBtn');

  // 토스트
  const toastEl      = $('toast');

  // 잠금 화면
  const lockScreen     = $('lockScreen');
  const lockForm       = $('lockForm');
  const lockInput      = $('lockInput');
  const lockSubmit     = $('lockSubmit');
  const lockSubmitText = $('lockSubmitText');
  const lockError      = $('lockError');

  /* ── 설정 ──────────────────────────────────────────────── */
  const AUTH_URL    = '/api/auth';
  const PROXY_URL   = '/api/claude';
  const MODEL       = 'claude-sonnet-4-6';
  const MAX_TOKENS  = 2048;
  const TOKEN_KEY   = 'csy_soap_token';

  /* ── 상태 ──────────────────────────────────────────────── */
  /** @type {{id:number, speaker:'doctor'|'patient', text:string}[]} */
  const messages = [];
  let currentSpeaker = 'doctor';
  let recognition    = null;
  let isRecording    = false;
  let interimNode    = null;
  let nextId         = 1;

  /* ── 이전 버전 호환: 로컬스토리지에 저장돼 있던 키 제거 ─ */
  try { localStorage.removeItem('csy_anthropic_key'); } catch (_) {}

  /* ── 인증 (비밀번호 잠금) ─────────────────────────────── */
  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (_) { return ''; }
  }
  function setToken(t) {
    try { localStorage.setItem(TOKEN_KEY, t); } catch (_) {}
    document.documentElement.classList.add('authed');
  }
  function clearAuth() {
    try { localStorage.removeItem(TOKEN_KEY); } catch (_) {}
    document.documentElement.classList.remove('authed');
  }
  function showLockError(msg) {
    lockError.textContent = msg || '';
  }
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
    setTimeout(() => {
      try { lockInput.focus(); } catch (_) {}
    }, 50);
  }

  lockInput.addEventListener('input', () => {
    if (lockError.textContent) showLockError('');
  });

  lockForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = (lockInput.value || '').trim();
    if (!password) {
      showLockError('비밀번호를 입력하세요.');
      lockInput.focus();
      return;
    }
    showLockError('');
    showLockLoading(true);
    try {
      const res = await fetch(AUTH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const ct = res.headers.get('content-type') || '';
      const data = ct.includes('application/json') ? await res.json() : null;

      if (!res.ok) {
        const msg = (data && data.error && data.error.message)
          ? data.error.message
          : `오류 (HTTP ${res.status})`;
        showLockError(msg);
        lockInput.select();
        return;
      }
      if (!data || !data.token) {
        showLockError('서버 응답이 올바르지 않습니다.');
        return;
      }
      setToken(data.token);
      lockInput.value = '';
      showLockError('');
      toast('접속되었습니다');
    } catch (err) {
      showLockError('네트워크 오류: ' + (err && err.message ? err.message : err));
    } finally {
      showLockLoading(false);
    }
  });

  // 페이지 진입 시 토큰 없으면 입력란 포커스
  if (!getToken()) {
    setTimeout(() => { try { lockInput.focus(); } catch (_) {} }, 100);
  }

  /* ── Toast ─────────────────────────────────────────────── */
  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  /* ── 상단 상태 표시 ───────────────────────────────────── */
  function setTopStatus(label, kind) {
    topStatusLabel.textContent = label;
    topStatus.classList.remove('live', 'success');
    if (kind) topStatus.classList.add(kind);
  }

  /* ── 메시지 카운트 + 버튼 가용성 ───────────────────────── */
  function updateMsgCount() {
    msgCountEl.textContent = String(messages.length);
    const hasMsg = messages.length > 0;
    genBtn.disabled = !hasMsg;
    transcriptEmpty.style.display = hasMsg ? 'none' : '';
  }

  /* ── Escape ────────────────────────────────────────────── */
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  /* ── 렌더링 ────────────────────────────────────────────── */
  function clearRendered() {
    transcriptEl.querySelectorAll('.msg').forEach((el) => el.remove());
  }
  function renderMessages() {
    const keepInterim = interimNode;
    clearRendered();
    messages.forEach((m) => transcriptEl.appendChild(buildMsgNode(m)));
    if (keepInterim) transcriptEl.appendChild(keepInterim);
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }
  function buildMsgNode(m) {
    const node = document.createElement('div');
    node.className = 'msg ' + m.speaker;
    node.dataset.id = String(m.id);
    node.innerHTML = `
      <span class="who">${m.speaker === 'doctor' ? '의사' : '환자'}</span>
      <div class="bubble">${escapeHtml(m.text)}</div>
      <button class="del" type="button" aria-label="삭제" title="삭제">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    `;
    node.querySelector('.del').addEventListener('click', () => {
      const i = messages.findIndex((x) => x.id === m.id);
      if (i >= 0) {
        messages.splice(i, 1);
        renderMessages();
        updateMsgCount();
      }
    });
    return node;
  }

  function showInterim(text) {
    if (!text) {
      if (interimNode) { interimNode.remove(); interimNode = null; }
      return;
    }
    if (!interimNode) {
      interimNode = document.createElement('div');
      interimNode.className = 'msg interim ' + currentSpeaker;
      interimNode.innerHTML = `
        <span class="who">${currentSpeaker === 'doctor' ? '의사' : '환자'}</span>
        <div class="bubble"></div>
      `;
      transcriptEl.appendChild(interimNode);
    } else {
      interimNode.className = 'msg interim ' + currentSpeaker;
      interimNode.querySelector('.who').textContent =
        currentSpeaker === 'doctor' ? '의사' : '환자';
    }
    interimNode.querySelector('.bubble').textContent = text;
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }

  function commitMessage(text) {
    const t = (text || '').trim();
    if (!t) return;
    const m = { id: nextId++, speaker: currentSpeaker, text: t };
    messages.push(m);
    if (interimNode) { interimNode.remove(); interimNode = null; }
    transcriptEmpty.style.display = 'none';
    transcriptEl.appendChild(buildMsgNode(m));
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
    updateMsgCount();
  }

  /* ── 모달 ──────────────────────────────────────────────── */
  function openModal()  { modal.classList.add('open'); }
  function closeModal() { modal.classList.remove('open'); }
  settingsBtn.addEventListener('click', openModal);

  // 로그아웃: 토큰 삭제 후 잠금 화면으로 복귀
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      if (!confirm('로그아웃 하시겠습니까?')) return;
      if (isRecording) stopRecording(true);
      lockOut('');
      // 다음 진입을 위해 입력 필드 초기화
      try { lockInput.value = ''; } catch (_) {}
      toast('로그아웃 되었습니다');
    });
  }
  modalClose.addEventListener('click', closeModal);
  modalDone.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) closeModal();
  });

  /* ── 발화자 토글 ───────────────────────────────────────── */
  speakerBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      speakerBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentSpeaker = btn.dataset.speaker;
      if (interimNode) {
        interimNode.className = 'msg interim ' + currentSpeaker;
        interimNode.querySelector('.who').textContent =
          currentSpeaker === 'doctor' ? '의사' : '환자';
      }
    });
  });

  /* ── Speech Recognition ────────────────────────────────── */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SR) {
    browserWarn.classList.add('show');
    browserWarn.innerHTML =
      '<strong>⚠️ 이 브라우저는 음성 인식을 지원하지 않습니다.</strong><br>' +
      '데스크톱/iPadOS의 <strong>Chrome</strong> 또는 <strong>Safari</strong>를 사용해 주세요.';
    recBtn.disabled = true;
    setTopStatus('미지원');
  } else {
    const ua = navigator.userAgent;
    const isChromeOrEdge = /Chrome|Edg/.test(ua) && !/OPR/.test(ua);
    const isSafari       = /Safari/.test(ua) && !/Chrome|Edg|CriOS|FxiOS/.test(ua);
    if (!isChromeOrEdge && !isSafari) browserWarn.classList.add('show');

    recognition = new SR();
    recognition.lang = 'ko-KR';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const transcript = result[0].transcript;
        if (result.isFinal) commitMessage(transcript);
        else interim += transcript;
      }
      if (interim) showInterim(interim);
      else if (interimNode) { interimNode.remove(); interimNode = null; }
    };
    recognition.onerror = (e) => {
      if (e.error === 'no-speech') return;
      if (e.error === 'aborted')   return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setTopStatus('마이크 권한 거부');
        toast('마이크 권한이 필요합니다');
        stopRecording(true);
        return;
      }
      toast('음성 인식 오류: ' + e.error);
    };
    recognition.onend = () => {
      // continuous 모드에서도 일부 환경에서 자동 종료되므로,
      // 사용자가 중단한 게 아니면 자동 재시작
      if (isRecording) {
        try { recognition.start(); } catch (_) {}
      }
    };
  }

  /* ── 녹음 컨트롤 ──────────────────────────────────────── */
  function startRecording() {
    if (!recognition) return;
    try {
      recognition.start();
      isRecording = true;
      recBtn.classList.add('recording');
      recBtnLabel.textContent = '녹음 중지';
      setTopStatus('녹음 중', 'live');
    } catch (e) {
      toast('녹음 시작 실패: ' + e.message);
    }
  }
  function stopRecording(silent) {
    isRecording = false;
    if (recognition) {
      try { recognition.stop(); } catch (_) {}
    }
    recBtn.classList.remove('recording');
    recBtnLabel.textContent = '녹음 시작';
    if (interimNode) { interimNode.remove(); interimNode = null; }
    if (!silent) setTopStatus('대기');
  }
  recBtn.addEventListener('click', () => {
    if (isRecording) stopRecording();
    else startRecording();
  });

  clearBtn.addEventListener('click', () => {
    if (!messages.length && !(soapText.dataset.raw || soapText.textContent)) return;
    if (!confirm('대화 내용과 SOAP 노트를 모두 비웁니다. 진행할까요?')) return;
    messages.length = 0;
    clearRendered();
    soapText.textContent = '';
    soapText.classList.add('is-empty');
    delete soapText.dataset.raw;
    soapEmpty.style.display = '';
    copyBtn.disabled = true;
    updateMsgCount();
    toast('비워졌습니다');
  });

  /* ── SOAP 렌더링 (섹션 분할) ───────────────────────────── */
  function renderSoap(raw) {
    soapText.innerHTML = '';
    soapText.classList.remove('is-empty');

    const lines = raw.split('\n');
    const sections = [];
    let current = null;

    const headerRe = /^\s*\[\s*([SOAP])\s*[·\-:]\s*(.+?)\s*\]\s*$/i;
    const altRe    = /^\s*([SOAP])\s*[·\-:]\s*(.+?)\s*$/;

    for (const line of lines) {
      const m = line.match(headerRe) || line.match(altRe);
      if (m) {
        if (current) sections.push(current);
        current = { letter: m[1].toUpperCase(), title: m[2], body: [] };
      } else if (current) {
        current.body.push(line);
      } else {
        if (!sections.length || sections[sections.length - 1].letter !== '_pre') {
          sections.push({ letter: '_pre', title: '', body: [line] });
        } else {
          sections[sections.length - 1].body.push(line);
        }
      }
    }
    if (current) sections.push(current);

    const hasReal = sections.some((s) => s.letter !== '_pre');
    if (!hasReal) {
      soapText.textContent = raw.trim();
      return;
    }

    sections.forEach((s) => {
      const body = s.body.join('\n').replace(/^\n+|\n+$/g, '');
      if (s.letter === '_pre') {
        if (!body.trim()) return;
        const div = document.createElement('div');
        div.className = 'soap-section';
        div.textContent = body;
        soapText.appendChild(div);
        return;
      }
      const sec = document.createElement('div');
      sec.className = 'soap-section';
      const h = document.createElement('h3');
      h.textContent = `${s.letter} · ${s.title}`;
      const p = document.createElement('div');
      p.style.whiteSpace = 'pre-wrap';
      p.textContent = body;
      sec.appendChild(h);
      sec.appendChild(p);
      soapText.appendChild(sec);
    });
  }

  /* ── 프롬프트 ──────────────────────────────────────────── */
  function buildPrompt(msgs) {
    const dialog = msgs.map((m) =>
      `[${m.speaker === 'doctor' ? '의사' : '환자'}] ${m.text}`
    ).join('\n');

    return `당신은 한의원에서 사용하는 진료 기록 보조 AI입니다. 아래 의사-환자 대화를 기반으로, 한의학적 임상 관점에서 SOAP 형식의 진료 노트를 한국어로 작성해 주세요.

대화 내용:
"""
${dialog}
"""

작성 지침:
1) 아래 정확한 형식과 헤더를 그대로 사용하세요.
2) 대화에 명시되지 않은 내용은 추측하지 말고 "대화에서 언급되지 않음"으로 표기하세요.
3) 환자 본인이 직접 말한 표현은 가능하면 큰따옴표로 인용하세요.
4) 의학 용어는 한국어 진료 기록에서 통용되는 표현을 사용하세요.
5) 마크다운/별표(**) 없이 일반 텍스트로만 출력하세요.

[ S · Subjective (주관적 정보) ]
- 주소(Chief Complaint):
- 현병력(HPI): 발생 시점, 부위, 양상, 악화/완화 요인, 동반 증상
- 과거력/복용 약물/알레르기:
- 사회력·생활습관 (필요시):

[ O · Objective (객관적 정보) ]
- 관찰/문진에서 확인된 객관적 소견:
- 활력징후·이학적 검사 (대화에서 확인된 경우만):
- 한의학적 진단 소견 (설진/맥진/촉진 등 언급된 경우만):

[ A · Assessment (평가) ]
- 추정 진단:
- 한의학적 변증(辨證) 또는 임상적 인상 (가능한 경우):
- 감별 진단/추가 고려사항:

[ P · Plan (계획) ]
- 치료 계획 (침구·추나·약침·한약 등 대화에서 논의된 항목):
- 환자 교육·생활지도:
- 재방문/경과 관찰:

위 형식만 출력하고 다른 설명은 덧붙이지 마세요.`;
  }

  /* ── SOAP 생성 (서버리스 프록시 호출) ─────────────────── */
  async function generateSOAP() {
    if (!messages.length) return;
    if (isRecording) stopRecording();

    genBtn.classList.add('loading');
    genBtn.disabled = true;
    genBtnLabel.textContent = '생성 중…';
    copyBtn.disabled = true;
    soapText.classList.add('is-empty');
    soapEmpty.style.display = '';
    setTopStatus('생성 중…');

    try {
      const token = getToken();
      if (!token) {
        lockOut('인증이 필요합니다.');
        throw new Error('인증되지 않은 상태입니다. 다시 로그인해 주세요.');
      }

      const res = await fetch(PROXY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-soap-token': token
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content: buildPrompt(messages) }]
        })
      });

      // 401이면 즉시 잠금 화면으로 복귀
      if (res.status === 401) {
        lockOut('세션이 만료되었습니다. 다시 로그인하세요.');
        throw new Error('인증이 만료되었습니다. 비밀번호로 다시 로그인하세요.');
      }

      // 응답이 JSON인지 확인
      const ct = res.headers.get('content-type') || '';
      const data = ct.includes('application/json')
        ? await res.json()
        : { error: { message: '서버에서 JSON이 아닌 응답을 받았습니다. (' + res.status + ')' } };

      if (!res.ok) {
        const msg = (data && data.error && data.error.message) || ('HTTP ' + res.status);
        throw new Error(msg);
      }

      const text = (data.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();

      if (!text) throw new Error('빈 응답을 받았습니다.');

      soapEmpty.style.display = 'none';
      renderSoap(text);
      soapText.dataset.raw = text;
      copyBtn.disabled = false;
      setTopStatus('생성 완료', 'success');
      soapView.scrollTop = 0;
      toast('SOAP 노트 생성 완료');
    } catch (err) {
      soapEmpty.style.display = 'none';
      soapText.classList.remove('is-empty');
      soapText.innerHTML = '';
      const errDiv = document.createElement('div');
      errDiv.style.color = 'var(--danger)';
      errDiv.style.lineHeight = '1.85';
      errDiv.style.whiteSpace = 'pre-wrap';
      errDiv.textContent =
        '⚠ SOAP 노트 생성 실패\n\n' + err.message +
        '\n\n• 서버에 ANTHROPIC_API_KEY와 SOAP_PASSWORD가 설정돼 있는지 확인하세요.' +
        '\n• Vercel 배포 도메인에서 접근 중인지 확인하세요. (GitHub Pages에서는 /api 경로가 동작하지 않습니다)' +
        '\n• 인증이 만료된 경우 잠금 화면에서 비밀번호를 다시 입력하세요.';
      soapText.appendChild(errDiv);
      setTopStatus('오류');
      toast('생성 실패');
    } finally {
      genBtn.classList.remove('loading');
      genBtn.disabled = messages.length === 0;
      genBtnLabel.textContent = '생성';
      if (!isRecording) {
        setTimeout(() => {
          if (!isRecording) setTopStatus('대기');
        }, 1800);
      }
    }
  }
  genBtn.addEventListener('click', generateSOAP);

  /* ── 복사 ──────────────────────────────────────────────── */
  copyBtn.addEventListener('click', async () => {
    const raw = soapText.dataset.raw || soapText.innerText || '';
    if (!raw.trim()) return;
    try {
      await navigator.clipboard.writeText(raw);
      toast('SOAP 노트가 복사되었습니다');
    } catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = raw;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        toast('복사되었습니다');
      } catch (_) {
        toast('복사 실패');
      }
    }
  });

  /* ── 초기 상태 ─────────────────────────────────────────── */
  updateMsgCount();
  setTopStatus('대기');
})();
