// GET /api/geocode?address=...&mode=address|apt
// REST key remains private on Cloudflare; coordinates verified before display.
function reply(status, data) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const address = (url.searchParams.get('address') || '').trim();
  const mode = url.searchParams.get('mode') || 'address';
  if (!address || address.length > 140 || !['address', 'apt'].includes(mode)) return reply(400, { error: '검색 주소는 1~140자로 입력해 주세요.' });
  const key = String(env.KAKAO_REST_API_KEY || '').trim();
  if (!key) return reply(503, { error: 'Cloudflare에 KAKAO_REST_API_KEY를 Secret으로 등록해 주세요.' });
  const headers = { Authorization: `KakaoAK ${key}`, Accept: 'application/json' };
  const searches = [
    ['address', 'https://dapi.kakao.com/v2/local/search/address.json', 'query'],
    ...(mode === 'apt' ? [['keyword', 'https://dapi.kakao.com/v2/local/search/keyword.json', 'query']] : []),
  ];
  for (const [source, endpoint, field] of searches) {
    const endpointUrl = new URL(endpoint);
    endpointUrl.searchParams.set(field, address);
    endpointUrl.searchParams.set('size', '5');
    let res; let json;
    try {
      res = await fetch(endpointUrl, { headers, signal: AbortSignal.timeout(10000) });
      json = await res.json();
    } catch {
      return reply(502, { error: '카카오 주소 검색 API 연결 또는 응답 오류입니다.' });
    }
    if (!res.ok) return reply(502, { error: `카카오 주소 검색 오류 (${res.status}). 카카오맵 API 활성화·REST API 키·사용량을 확인하세요.` });
    const first = json.documents?.[0];
    if (!first) continue;
    const lng = Number(first.x), lat = Number(first.y);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || lat < 33 || lat > 39 || lng < 124 || lng > 132) {
      return reply(422, { error: '검색 좌표가 유효하지 않습니다. 주소를 확인하세요.' });
    }
    return reply(200, {
      lat, lng, source,
      label: first.place_name || first.road_address?.address_name || first.address?.address_name || first.address_name || address,
      address: first.road_address_name || first.road_address?.address_name || first.address_name || first.address?.address_name || address,
      precise: source === 'address',
    });
  }
  return reply(404, { error: '검색 결과가 없습니다. 도로명/지번 주소 또는 아파트명을 확인하세요.' });
}
