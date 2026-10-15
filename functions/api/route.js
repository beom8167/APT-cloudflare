// GET /api/route?fromLat=...&fromLng=...&toLat=...&toLng=...
// Walk: Kakao Maps REST. Drive: Kakao Mobility Directions REST.
// Each upstream may fail independently; do not substitute guessed travel times.
function reply(status, data) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
function point(value, low, high) {
  const n = Number(value);
  return value !== null && value !== '' && Number.isFinite(n) && n >= low && n <= high ? n : null;
}
function validCoord(x, y) { return Number.isFinite(x) && Number.isFinite(y) && x >= 124 && x <= 132 && y >= 33 && y <= 39; }
function simplifyPath(path, max = 500) {
  if (!path.length) return [];
  const step = Math.max(1, Math.ceil(path.length / max));
  const subset = path.filter((_, i) => i % step === 0);
  if (subset[subset.length - 1] !== path[path.length - 1]) subset.push(path[path.length - 1]);
  return subset;
}
async function walking(key, a, b) {
  const url = new URL('https://dapi.kakao.com/v2/routing/walk');
  for (const [k, v] of Object.entries({start_x:a.lng,start_y:a.lat,end_x:b.lng,end_y:b.lat,input_coord:'WGS84',output_coord:'WGS84'})) url.searchParams.set(k, String(v));
  try {
    const res = await fetch(url, {headers:{Authorization:`KakaoAK ${key}`},signal:AbortSignal.timeout(14000)});
    if (!res.ok) return {available:false,reason:`도보 경로 API ${res.status} (권한·쿼터 확인)`};
    const data = await res.json();
    if (data.status !== 'OK') return {available:false,reason:`도보 경로 없음 (${data.status || '결과 없음'})`};
    const props = data.route?.properties;
    if (!props || !Number.isFinite(Number(props.totalTime)) || !Number.isFinite(Number(props.totalDistance))) return {available:false,reason:'도보 경로 요약 없음'};
    const points = [];
    for (const leg of data.route.legs || []) for (const step of leg.steps || []) for (const pair of step.path?.points || []) {
      const [lng, lat] = pair.map(Number);
      if (validCoord(lng, lat)) points.push([lat, lng]);
    }
    return {available:true,minutes:Math.max(1,Math.ceil(Number(props.totalTime)/60)),distanceMeters:Number(props.totalDistance),path:simplifyPath(points)};
  } catch { return {available:false,reason:'도보 API 시간 초과 또는 연결 실패'}; }
}
async function driving(key, a, b) {
  const url = new URL('https://apis-navi.kakaomobility.com/v1/directions');
  url.searchParams.set('origin', `${a.lng},${a.lat}`);
  url.searchParams.set('destination', `${b.lng},${b.lat}`);
  url.searchParams.set('priority', 'RECOMMEND');
  url.searchParams.set('summary', 'false');
  try {
    const res = await fetch(url, {headers:{Authorization:`KakaoAK ${key}`},signal:AbortSignal.timeout(14000)});
    if (!res.ok) return {available:false,reason:`차량 길찾기 API ${res.status} (서비스 권한·쿼터 확인)`};
    const data = await res.json();
    const route = data.routes?.[0]; const summary = route?.summary;
    if (!route || route.result_code !== 0 || !summary || !Number.isFinite(Number(summary.duration))) return {available:false,reason:`차량 경로 없음 (${route?.result_msg || '결과 없음'})`};
    const points = [];
    for (const section of route.sections || []) for (const road of section.roads || []) {
      const array = road.vertexes || [];
      for (let i=0;i+1<array.length;i+=2) {
        const lng = Number(array[i]),lat = Number(array[i+1]);
        if (validCoord(lng, lat)) points.push([lat,lng]);
      }
    }
    return {available:true,minutes:Math.max(1,Math.ceil(Number(summary.duration)/60)),distanceMeters:Number(summary.distance),path:simplifyPath(points)};
  } catch { return {available:false,reason:'자동차 길찾기 API 시간 초과 또는 연결 실패'}; }
}
export async function onRequestGet({ request, env }) {
  const p = new URL(request.url).searchParams;
  const a = {lat:point(p.get('fromLat'),33,39),lng:point(p.get('fromLng'),124,132)};
  const b = {lat:point(p.get('toLat'),33,39),lng:point(p.get('toLng'),124,132)};
  if (Object.values(a).some(v=>v===null) || Object.values(b).some(v=>v===null)) return reply(400,{error:'출발지·목적지 좌표가 올바르지 않습니다.'});
  const key = String(env.KAKAO_REST_API_KEY || '').trim();
  if (!key) return reply(503,{error:'KAKAO_REST_API_KEY Secret을 등록해 주세요.'});
  const [walk, drive] = await Promise.all([walking(key,a,b), driving(key,a,b)]);
  return reply(200, {walk, drive, source:'카카오맵 도보 경로 · 카카오모빌리티 자동차 길찾기', disclaimer:'소요시간은 경로 API의 조회 시점 기준 예상치입니다.'});
}
