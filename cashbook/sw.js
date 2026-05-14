// /cashbook/sw.js — Cache-disabling Service Worker
//
// 동작:
//   - 캐시 저장소(Cache Storage)를 전혀 사용하지 않습니다.
//   - 모든 동일 출처 GET 요청을 HTTP 캐시 우회(no-store) 로 네트워크에서 가져옵니다.
//   - 활성화될 때마다 남아 있을 수 있는 모든 캐시를 삭제합니다.
//   - 새 SW가 빠르게 페이지를 장악하도록 skipWaiting + clients.claim 을 사용합니다.
//
// 강제 갱신이 필요할 때:
//   - 아래 CACHE_VERSION 문자열을 바꿔서 커밋·배포하면, 브라우저가 새 SW를 감지하고
//     activate 단계에서 모든 캐시를 비웁니다. controllerchange 핸들러가 페이지를
//     한 번 리로드해 최신 코드로 갈아엎습니다.

const CACHE_VERSION = 'v1-2026-05-14';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      return await fetch(req, { cache: 'no-store' });
    } catch (_) {
      return fetch(req);
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
