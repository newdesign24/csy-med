/* ============================================================
   Vercel Serverless Function — Claude API Proxy
   ----------------------------------------------------------------
   POST /api/claude
     Headers: { x-soap-token }  ← /api/auth 에서 발급된 토큰 (필수)
     Body: { model, max_tokens?, messages, system? }
     - 서버에 저장된 ANTHROPIC_API_KEY 환경변수로 Claude API를 호출
     - SOAP_PASSWORD 기반 토큰 검증 통과한 요청만 허용
     - 브라우저에는 API 키가 절대 노출되지 않음
   ============================================================ */

const crypto = require('crypto');

// 허용 모델 화이트리스트 (오용 방지)
const ALLOWED_MODELS = new Set([
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001'
]);

// 입력 제한
const MAX_TOKENS_CAP   = 4096;   // 응답 토큰 상한
const MAX_INPUT_CHARS  = 60000;  // 요청 전체 문자열 길이 상한
const MAX_MESSAGES     = 50;

// 인증 토큰 파생 (api/auth.js와 동일 로직)
const TOKEN_SALT = 'csy-soap-v1';
function deriveToken(password) {
  return crypto.createHmac('sha256', password).update(TOKEN_SALT).digest('hex');
}
function constantTimeEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function readJsonBody(req) {
  // Vercel은 Content-Type: application/json 이면 req.body를 이미 파싱해줌
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);

  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > MAX_INPUT_CHARS * 2) {
        reject(new Error('Request too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(new Error('Invalid JSON: ' + e.message)); }
    });
    req.on('error', reject);
  });
}

function fail(res, status, message) {
  res.status(status).json({ error: { type: 'proxy_error', message } });
}

module.exports = async (req, res) => {
  // 메서드 제한
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(res, 405, 'POST 메서드만 허용됩니다.');
  }

  // 키 확인
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return fail(res, 500, 'ANTHROPIC_API_KEY 환경변수가 서버에 설정되어 있지 않습니다.');
  }

  // 인증 토큰 검증 (SOAP_PASSWORD 기반)
  const soapPwd = process.env.SOAP_PASSWORD;
  if (!soapPwd) {
    return fail(res, 500, 'SOAP_PASSWORD 환경변수가 서버에 설정되어 있지 않습니다.');
  }
  const submittedToken = req.headers['x-soap-token'];
  if (!constantTimeEq(submittedToken, deriveToken(soapPwd))) {
    return fail(res, 401, '인증되지 않은 요청입니다. 비밀번호로 다시 로그인하세요.');
  }

  // 바디 파싱
  let body;
  try { body = await readJsonBody(req); }
  catch (e) { return fail(res, 400, e.message); }

  const { model, max_tokens, messages, system } = body || {};

  // 유효성 검사
  if (!model || typeof model !== 'string') {
    return fail(res, 400, 'model 필드가 필요합니다.');
  }
  if (!ALLOWED_MODELS.has(model)) {
    return fail(res, 400, `허용되지 않은 모델입니다. (${Array.from(ALLOWED_MODELS).join(', ')})`);
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return fail(res, 400, 'messages 배열이 필요합니다.');
  }
  if (messages.length > MAX_MESSAGES) {
    return fail(res, 400, `메시지 수는 ${MAX_MESSAGES}개를 초과할 수 없습니다.`);
  }

  // 메시지 형식 검사 + 크기 합계 검사
  let totalChars = 0;
  for (const m of messages) {
    if (!m || typeof m !== 'object') {
      return fail(res, 400, '메시지 형식이 올바르지 않습니다.');
    }
    if (m.role !== 'user' && m.role !== 'assistant') {
      return fail(res, 400, 'role은 user 또는 assistant여야 합니다.');
    }
    if (typeof m.content === 'string') {
      totalChars += m.content.length;
    } else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part && typeof part.text === 'string') totalChars += part.text.length;
      }
    } else {
      return fail(res, 400, 'content는 문자열 또는 배열이어야 합니다.');
    }
  }
  if (typeof system === 'string') totalChars += system.length;
  if (totalChars > MAX_INPUT_CHARS) {
    return fail(res, 413, `입력 크기가 너무 큽니다. (${totalChars} > ${MAX_INPUT_CHARS} 문자)`);
  }

  // max_tokens 정리
  let mt = parseInt(max_tokens, 10);
  if (!Number.isFinite(mt) || mt <= 0) mt = 2048;
  if (mt > MAX_TOKENS_CAP) mt = MAX_TOKENS_CAP;

  // 업스트림 호출 페이로드
  const upstreamBody = { model, max_tokens: mt, messages };
  if (typeof system === 'string' && system.trim()) upstreamBody.system = system;

  // 업스트림 요청
  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(upstreamBody)
    });

    // 응답 본문(JSON 우선, 실패 시 텍스트)
    const ct = upstream.headers.get('content-type') || '';
    let payload;
    if (ct.includes('application/json')) {
      payload = await upstream.json();
    } else {
      const text = await upstream.text();
      payload = { error: { type: 'upstream_non_json', message: text.slice(0, 500) } };
    }

    // 캐시 금지
    res.setHeader('Cache-Control', 'no-store');
    return res.status(upstream.status).json(payload);
  } catch (err) {
    return fail(res, 502, '업스트림 호출 실패: ' + (err && err.message ? err.message : String(err)));
  }
};
