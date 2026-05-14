/* ============================================================
   Vercel Serverless Function — Cashbook Client Config
   ----------------------------------------------------------------
   GET /api/cashbook-config
     Response 200: { googleClientId: string }
   ----------------------------------------------------------------
   - GOOGLE_CLIENT_ID 는 Google OAuth Web Application 의 Client ID 입니다.
     이 값은 브라우저에 노출되는 것이 정상입니다 (시크릿이 아닙니다).
     GIS implicit/PKCE flow 는 redirect URI / authorized origins 화이트
     리스트로 보호됩니다.
   - 환경변수가 비어 있으면 빈 문자열을 돌려주고, 클라이언트는 Drive
     연결 버튼을 숨깁니다.
   ============================================================ */

module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({
      error: { type: 'method_not_allowed', message: 'GET 메서드만 허용됩니다.' }
    });
  }

  return res.status(200).json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || ''
  });
};
