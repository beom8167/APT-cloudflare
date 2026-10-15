// Public client-side Maps SDK key; never expose KAKAO_REST_API_KEY here.
export function onRequestGet({ env }) {
  const key = String(env.KAKAO_MAP_JS_KEY || '').trim();
  return Response.json({ mapKey: key, mapAvailable: Boolean(key) }, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
