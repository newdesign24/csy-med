/* ============================================================
   청심연한의원 — AI 진료 노트 (STT + SOAP)
   ----------------------------------------------------------------
   - Web Speech API (한국어, ko-KR)로 실시간 음성 인식
   - 의사/환자 발화자 수동 토글
   - 인식 결과는 메모리상에서만 보관 (페이지 새로고침 시 초기화)
   - Claude API (claude-sonnet-4-6)로 SOAP 노트 생성
   - API 키는 localStorage('csy_anthropic_key')에 저장
   ============================================================ */

(function () {
  'use strict';

  /* ── DOM ───────────────────────────────────────────────── */
  const $ = (id) => document.getElementById(id);

  const apiKeyInput   = $('apiKey');
  const saveKeyBtn    = $('saveKey');
  const clearKeyBtn   = $('clearKey');
  const apiStatus     = $('apiStatus');
  const apiToggle     = $('apiToggle');
  const apiPanel      = $('apiPanel');

  const speakerBtns   = document.querySelectorAll('.spk-btn');
  const recBtn        = $('recBtn');
  const recBtnLabel   = $('recBtnLabel');
  const clearBtn      = $('clearBtn');
  const recStatus     = $('recStatus');

  const transcriptEl  = $('transcript');
  const msgCountEl    = $('msgCount');

  const genBtn        = $('genBtn');
  const genBtnLabel   = $('genBtnLabel');
  const genHint       = $('genHint');
  const soapResult    = $('soapResult');
  const soapText      = $('soapText');
  const copyBtn       = $('copyBtn');

  const browserWarn   = $('browserWarn');

  /* ── State ─────────────────────────────────────────────── */
  const STORAGE_KEY = 'csy_anthropic_key';
  const MODEL       = 'claude-sonnet-4-6';

  // messages: [{ id, speaker: 'doctor'|'patient', text }]
  const messages = [];
  let currentSpeaker = 'doctor';
  let recognition    = null;
  let isRecording    = false;
  let interimNode    = null; // 현재 발화 중 표시되는 임시 노드
  let nextId         = 1;

  /* ── Helpers ───────────────────────────────────────────── */
  function setStatus(text, kind) {
    recStatus.textContent = text;
    recStatus.className = 'rec-status' + (kind ? ' ' + kind : '');
  }
  function setApiStatus(text, kind) {
    apiStatus.textContent = text;
    apiStatus.className = 'api-status' + (kind ? ' ' + kind : '');
  }
  function updateMsgCount() {
    msgCountEl.textContent = messages.length + ' 개';
    genBtn.disabled = messages.length === 0;
    if (messages.length === 0) {
      genHint.textContent = '대화가 1건 이상 있어야 생성할 수 있습니다.';
    } else {
      genHint.textContent = `${messages.length}건의 발화로 SOAP 노트를 생성합니다.`;
    }
  }
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  /* ── Render ────────────────────────────────────────────── */
  function renderMessages() {
    // interim 노드는 보존
    const keepInterim = interimNode;
    transcriptEl.innerHTML = '';
    messages.forEach((m) => {
      const node = document.createElement('div');
      node.className = 'msg ' + m.speaker;
      node.dataset.id = m.id;
      node.innerHTML = `
        <span class="who">${m.speaker === 'doctor' ? '의사' : '환자'}</span>
        <span class="text">${escapeHtml(m.text)}</span>
        <span class="del" title="삭제">×</span>
      `;
      node.querySelector('.del').addEventListener('click', () => {
        const idx = messages.findIndex((x) => x.id === m.id);
        if (idx >= 0) {
          messages.splice(idx, 1);
          renderMessages();
          updateMsgCount();
        }
      });
      transcriptEl.appendChild(node);
    });
    if (keepInterim) transcriptEl.appendChild(keepInterim);
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
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
        <span class="text"></span>
      `;
      transcriptEl.appendChild(interimNode);
    } else {
      // 발화자 변경 시 클래스/라벨 갱신
      interimNode.className = 'msg interim ' + currentSpeaker;
      interimNode.querySelector('.who').textContent = currentSpeaker === 'doctor' ? '의사' : '환자';
    }
    interimNode.querySelector('.text').textContent = text;
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }

  function commitMessage(text) {
    const t = (text || '').trim();
    if (!t) return;
    messages.push({ id: nextId++, speaker: currentSpeaker, text: t });
    if (interimNode) { interimNode.remove(); interimNode = null; }
    renderMessages();
    updateMsgCount();
  }

  /* ── API Key 저장/복원 ─────────────────────────────────── */
  function loadKey() {
    try {
      const k = localStorage.getItem(STORAGE_KEY);
      if (k) {
        apiKeyInput.value = k;
        setApiStatus('✓ 저장된 API 키를 불러왔습니다.', 'saved');
        return k;
      }
    } catch (e) {}
    return '';
  }
  function saveKey() {
    const k = (apiKeyInput.value || '').trim();
    if (!k) {
      setApiStatus('API 키를 입력하세요.', 'error');
      return;
    }
    if (!k.startsWith('sk-ant-')) {
      setApiStatus('형식이 올바르지 않습니다. (sk-ant-... 로 시작)', 'error');
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, k);
      setApiStatus('✓ API 키가 저장되었습니다.', 'saved');
    } catch (e) {
      setApiStatus('저장 실패: ' + e.message, 'error');
    }
  }
  function clearKey() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    apiKeyInput.value = '';
    setApiStatus('API 키를 삭제했습니다.');
  }

  saveKeyBtn.addEventListener('click', saveKey);
  clearKeyBtn.addEventListener('click', clearKey);
  apiToggle.addEventListener('click', () => {
    const collapsed = apiPanel.classList.toggle('collapsed');
    apiToggle.classList.toggle('collapsed', collapsed);
    apiToggle.textContent = collapsed ? '설정 펼치기' : '설정 접기';
  });
  // 기본: API 패널은 키가 있으면 접고, 없으면 펼친다
  const savedKey = loadKey();
  if (savedKey) {
    apiPanel.classList.add('collapsed');
    apiToggle.classList.add('collapsed');
    apiToggle.textContent = '설정 펼치기';
  } else {
    apiToggle.textContent = '설정 접기';
  }

  /* ── 발화자 토글 ───────────────────────────────────────── */
  speakerBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      speakerBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentSpeaker = btn.dataset.speaker;
      // 진행 중인 interim 노드가 있으면 화자만 즉시 반영
      if (interimNode) {
        interimNode.className = 'msg interim ' + currentSpeaker;
        interimNode.querySelector('.who').textContent =
          currentSpeaker === 'doctor' ? '의사' : '환자';
      }
    });
  });

  /* ── Speech Recognition 초기화 ─────────────────────────── */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    browserWarn.classList.add('show');
    browserWarn.innerHTML = '<strong>⚠️ 이 브라우저는 음성 인식을 지원하지 않습니다.</strong><br>' +
      '데스크톱 <strong>Chrome</strong> 또는 <strong>Edge</strong>에서 접속해 주세요.';
    recBtn.disabled = true;
    recBtn.style.opacity = 0.4;
    recBtn.style.cursor = 'not-allowed';
    setStatus('음성 인식 미지원', 'error');
  } else {
    // 일부 브라우저 경고 표시 (Safari/Firefox는 제한적)
    const ua = navigator.userAgent;
    const isChromeOrEdge = /Chrome|Edg/.test(ua) && !/OPR/.test(ua);
    if (!isChromeOrEdge) browserWarn.classList.add('show');

    function buildRecognizer() {
      const r = new SR();
      r.lang = 'ko-KR';
      r.continuous = true;
      r.interimResults = true;
      r.maxAlternatives = 1;

      r.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const result = e.results[i];
          const transcript = result[0].transcript;
          if (result.isFinal) {
            commitMessage(transcript);
          } else {
            interim += transcript;
          }
        }
        if (interim) showInterim(interim);
        else if (interimNode) { interimNode.remove(); interimNode = null; }
      };

      r.onerror = (e) => {
        if (e.error === 'no-speech') {
          setStatus('음성이 감지되지 않습니다…', 'live');
          return;
        }
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          setStatus('마이크 권한이 거부되었습니다.', 'error');
          stopRecording(true);
          return;
        }
        if (e.error === 'aborted') return;
        setStatus('오류: ' + e.error, 'error');
      };

      r.onend = () => {
        // continuous 모드에서도 일부 환경에서 자동 종료될 수 있어,
        // 사용자가 중단한 게 아니라면 재시작한다.
        if (isRecording) {
          try { r.start(); } catch (_) {}
        }
      };
      return r;
    }
    recognition = buildRecognizer();
  }

  /* ── 녹음 컨트롤 ──────────────────────────────────────── */
  function startRecording() {
    if (!recognition) return;
    try {
      recognition.start();
      isRecording = true;
      recBtn.classList.add('recording');
      recBtnLabel.textContent = '녹음 중지';
      setStatus('● 인식 중 — 자유롭게 말씀하세요', 'live');
    } catch (e) {
      // 이미 시작된 상태 등
      setStatus('시작 실패: ' + e.message, 'error');
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
    if (!silent) setStatus('대기 중');
  }
  recBtn.addEventListener('click', () => {
    if (isRecording) stopRecording();
    else startRecording();
  });
  clearBtn.addEventListener('click', () => {
    if (!messages.length) return;
    if (!confirm('대화 내용을 모두 비웁니다. 진행할까요?')) return;
    messages.length = 0;
    renderMessages();
    updateMsgCount();
    soapResult.classList.remove('show');
    soapText.textContent = '';
  });

  /* ── Claude API: SOAP 노트 생성 ────────────────────────── */
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

  async function generateSOAP() {
    const apiKey = (apiKeyInput.value || '').trim() || (() => {
      try { return localStorage.getItem(STORAGE_KEY) || ''; } catch (_) { return ''; }
    })();

    if (!apiKey) {
      setApiStatus('먼저 API 키를 입력하고 저장하세요.', 'error');
      apiPanel.classList.remove('collapsed');
      apiToggle.classList.remove('collapsed');
      apiToggle.textContent = '설정 접기';
      apiKeyInput.focus();
      return;
    }
    if (!messages.length) return;

    if (isRecording) stopRecording();

    genBtn.classList.add('loading');
    genBtn.disabled = true;
    genBtnLabel.textContent = 'SOAP 노트 생성 중…';
    soapResult.classList.remove('show');

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 2048,
          messages: [
            { role: 'user', content: buildPrompt(messages) }
          ]
        })
      });

      if (!res.ok) {
        let detail = '';
        try {
          const j = await res.json();
          detail = (j && j.error && j.error.message) ? j.error.message : '';
        } catch (_) {}
        throw new Error(`API 오류 (HTTP ${res.status})${detail ? ' — ' + detail : ''}`);
      }

      const data = await res.json();
      const text = (data.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();

      if (!text) throw new Error('빈 응답을 받았습니다.');

      soapText.textContent = text;
      soapResult.classList.add('show');
      soapResult.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      soapText.textContent = '⚠️ ' + err.message +
        '\n\n• API 키가 유효한지, 사용량 한도가 남아 있는지 확인하세요.' +
        '\n• 네트워크 또는 CORS 문제일 경우 브라우저 콘솔을 확인하세요.';
      soapResult.classList.add('show');
    } finally {
      genBtn.classList.remove('loading');
      genBtn.disabled = messages.length === 0;
      genBtnLabel.textContent = 'SOAP 노트 생성';
    }
  }
  genBtn.addEventListener('click', generateSOAP);

  /* ── 복사 ──────────────────────────────────────────────── */
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(soapText.textContent || '');
      const orig = copyBtn.textContent;
      copyBtn.textContent = '✓ 복사됨';
      setTimeout(() => { copyBtn.textContent = orig; }, 1600);
    } catch (e) {
      copyBtn.textContent = '복사 실패';
      setTimeout(() => { copyBtn.textContent = '📋 복사'; }, 1600);
    }
  });

  /* ── 초기 상태 ─────────────────────────────────────────── */
  updateMsgCount();
})();
