/* ============================================================
   Vercel Serverless Function — Auth (Password gate)
   ----------------------------------------------------------------
   POST /api/auth
     Body: { password: string }
     Response 200: { token }  ← localStorage에 저장, 이후 /api/claude 호출 시
                                 x-soap-token 헤더로 전송
     Response 401: { error }
   ----------------------------------------------------------------
   - 비밀번호는 서버 환경변수 SOAP_PASSWORD로만 관리됩니다.
   - 발급 토큰 = HMAC-SHA256(SOAP_PASSWORD, fixed-salt)
     같은 비밀번호로는 항상 같은 토큰이 나오지만, 비밀번호 없이는
     절대 생성할 수 없습니다. 비밀번호를 바꾸면 모든 기존 토큰 무효화.
   ============================================================ */

const crypto = require('crypto');

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
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 4096) { reject(new Error('Request too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(new Error('Invalid JSON: ' + e.message)); }
    });
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  // 명시적 Content-Type. Safari 는 charset 누락 시 응답 본문 디코딩이 흔들리는 경우가 있음.
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  // 방어적 CORS 헤더. 본 페이지/API 는 동일 출처로 동작하므로 사실상 preflight 가
  // 발생할 일이 없으나, Safari 의 일부 ITP/캐시 우회 경로에서 same-origin 요청을
  // cross-origin 처럼 다루는 사례가 보고된 적이 있어 origin 을 반사해 둔다.
  const origin = req.headers && req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }

  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
    res.setHeader('Access-Control-Max-Age', '600');
    return res.status(204).end();
  }

  const expected = process.env.SOAP_PASSWORD;
  if (!expected) {
    return res.status(500).json({
      error: { type: 'config_error', message: 'SOAP_PASSWORD 환경변수가 서버에 설정되어 있지 않습니다.' }
    });
  }

  if (req.method === 'POST') {
    let body;
    try { body = await readJsonBody(req); }
    catch (e) {
      return res.status(400).json({ error: { type: 'bad_request', message: e.message } });
    }

    const submitted = body && typeof body.password === 'string' ? body.password : '';

    // 빈 비밀번호 즉시 거부
    if (!submitted) {
      return res.status(400).json({
        error: { type: 'missing_password', message: '비밀번호를 입력하세요.' }
      });
    }

    // 상수시간 비교
    if (!constantTimeEq(submitted, expected)) {
      // 무차별 대입 완화용 인위적 지연
      await new Promise((r) => setTimeout(r, 600));
      return res.status(401).json({
        error: { type: 'invalid_password', message: '비밀번호가 올바르지 않습니다.' }
      });
    }

    return res.status(200).json({ token: deriveToken(expected) });
  }

  res.setHeader('Allow', 'POST');
  return res.status(405).json({
    error: { type: 'method_not_allowed', message: 'POST 메서드만 허용됩니다.' }
  });
};
