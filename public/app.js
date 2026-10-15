'use strict';

const $ = (id) => document.getElementById(id);
const MONTH_LIMIT = 12;
const PAGE_LENGTH = 50;
const API_PATH = '/api/apt-rent';
const nf = new Intl.NumberFormat('ko-KR');
const state = { rows: [], filtered: [], page: 1, loading: false, abort: null, failed: [], complete: false };

// 시군구 법정동코드 5자리. 주요 지역을 지역명으로 선택하고, 기타 지역은 코드 직접 입력 가능.
// 지역코드는 행정표준코드관리시스템(code.go.kr)에서 변경 여부를 확인하세요.
const REGION_CODES = Object.freeze({
  '서울특별시': [
    ['종로구','11110'], ['중구','11140'], ['용산구','11170'], ['성동구','11200'],
    ['광진구','11215'], ['동대문구','11230'], ['중랑구','11260'], ['성북구','11290'],
    ['강북구','11305'], ['도봉구','11320'], ['노원구','11350'], ['은평구','11380'],
    ['서대문구','11410'], ['마포구','11440'], ['양천구','11470'], ['강서구','11500'],
    ['구로구','11530'], ['금천구','11545'], ['영등포구','11560'], ['동작구','11590'],
    ['관악구','11620'], ['서초구','11650'], ['강남구','11680'], ['송파구','11710'], ['강동구','11740'],
  ],
  '경기도': [
    ['수원시 장안구','41111'], ['수원시 권선구','41113'], ['수원시 팔달구','41115'], ['수원시 영통구','41117'],
    ['성남시 수정구','41131'], ['성남시 중원구','41133'], ['성남시 분당구','41135'],
    ['고양시 덕양구','41281'], ['고양시 일산동구','41285'], ['고양시 일산서구','41287'],
    ['용인시 처인구','41461'], ['용인시 기흥구','41463'], ['용인시 수지구','41465'],
    ['안양시 동안구','41173'], ['부천시 원미구','41192'], ['하남시','41450'], ['김포시','41570'],
  ],
  '인천광역시': [
    ['미추홀구','28177'], ['연수구','28185'], ['남동구','28200'],
    ['부평구','28237'], ['계양구','28245'], ['강화군','28710'],
  ],
  '대전광역시': [
    ['동구','30110'], ['중구','30140'], ['서구','30170'], ['유성구','30200'], ['대덕구','30230'],
  ],
  '세종특별자치시': [['세종특별자치시 전체','36110']],
  '부산광역시': [
    ['중구','26110'], ['서구','26140'], ['동구','26170'], ['영도구','26200'],
    ['부산진구','26230'], ['동래구','26260'], ['남구','26290'], ['북구','26320'],
    ['해운대구','26350'], ['사하구','26380'], ['금정구','26410'], ['강서구','26440'],
    ['연제구','26470'], ['수영구','26500'], ['사상구','26530'], ['기장군','26710'],
  ],
  '대구광역시': [
    ['중구','27110'], ['동구','27140'], ['서구','27170'], ['남구','27200'],
    ['북구','27230'], ['수성구','27260'], ['달서구','27290'], ['달성군','27710'], ['군위군','27720'],
  ],
  '충청북도': [
    ['청주시 상당구','43111'], ['청주시 서원구','43112'],
    ['청주시 흥덕구','43113'], ['청주시 청원구','43114'],
    ['충주시','43130'], ['제천시','43150'],
  ],
});

function selectedDistrictName() {
  const opt = $('sigungu').selectedOptions[0];
  return opt ? opt.textContent : '';
}
function selectedLawdCode() {
  return $('sido').value === '__manual__' ? $('lawd-cd').value.trim() : $('sigungu').value;
}
function renderDistricts(preferred) {
  const city = $('sido').value;
  const isManual = city === '__manual__';
  $('manual-code-area').hidden = !isManual;
  $('sigungu').disabled = isManual;
  $('sigungu').required = !isManual;
  $('lawd-cd').required = isManual;
  if (isManual) {
    $('sigungu').replaceChildren(new Option('지역코드 직접 입력', ''));
    $('lawd-cd').value = '';
  } else {
    const districts = REGION_CODES[city] || [];
    $('sigungu').replaceChildren(...districts.map(([name, code]) => new Option(name, code)));
    $('sigungu').value = districts.some(([, code]) => code === preferred) ? preferred : (districts[0]?.[1] || '');
  }
  updateCriteriaSummary();
}
function updateCriteriaSummary() {
  const region = $('sido').value === '__manual__'
    ? `지역코드 ${$('lawd-cd').value.trim() || '미입력'}`
    : `${$('sido').value} ${selectedDistrictName()}`;
  const period = $('period').value === 'custom'
    ? `${$('start-month').value || '시작월'} ~ ${$('end-month').value || '종료월'}`
    : `최근 ${$('period').value}개월`;
  const apt = $('apt-name').value.trim() || '아파트 전체';
  $('criteria-summary').textContent = `${region} · ${period} · ${apt}`;
}
function applyPeriod() {
  const now = currentSeoulYm();
  const value = $('period').value;
  $('custom-period-area').hidden = value !== 'custom';
  if (value !== 'custom') {
    const count = Number(value);
    $('end-month').value = now;
    $('start-month').value = offsetYm(now, -(count - 1));
  }
  $('start-month').max = now;
  $('end-month').max = now;
  updateCriteriaSummary();
}

function currentSeoulYm() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  return `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}`;
}
function offsetYm(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function monthsBetween(start, end) {
  let cur = start; const arr = [];
  while (cur <= end && arr.length <= MONTH_LIMIT) { arr.push(cur.replace('-', '')); cur = offsetYm(cur, 1); }
  return arr;
}
function formatMoney(num) { return nf.format(num); }
function mediumMoney(num) { return num ? `${nf.format(num)}` : '0'; }
function esc(text) { return String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function notify(message, type = '') {
  const el = $('notification');
  el.textContent = message;
  el.className = 'notification' + (type ? ` ${type}` : '');
  el.hidden = !message;
}

function initDefaults() {
  $('sido').value = '서울특별시';
  $('period').value = '6';
  $('lawd-cd').value = '';
  renderDistricts('11680');
  applyPeriod();
}

function updateFilters() {
  const kw = $('apt-name').value.trim().toLocaleLowerCase('ko-KR').replace(/\s+/g, '');
  const areaStr = $('area').value;
  const target = areaStr === '' ? null : Number(areaStr);
  const tol = Number($('tolerance').value);
  const deal = $('deal-type').value;
  state.filtered = state.rows.filter(r => {
    if (kw && !r.aptName.toLocaleLowerCase('ko-KR').replace(/\s+/g, '').includes(kw)) return false;
    if (target !== null && (!Number.isFinite(target) || Math.abs(r.area - target) > tol)) return false;
    if (deal === 'jeonse' && r.monthlyRent !== 0) return false;
    if (deal === 'wolse' && r.monthlyRent <= 0) return false;
    return true;
  });
  state.filtered.sort((a,b) => b.dealDate.localeCompare(a.dealDate) || a.aptName.localeCompare(b.aptName, 'ko'));
  state.page = 1;
  updateStats();
  renderRows();
  mapModule.invalidate();
  $('download-button').disabled = !state.filtered.length || state.loading;
}
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b) => a-b);
  const mid = Math.floor(sorted.length/2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2;
}
function updateStats() {
  const jeonse = state.filtered.filter(r => r.monthlyRent === 0);
  $('stat-all').textContent = nf.format(state.filtered.length);
  $('stat-jeonse').textContent = nf.format(jeonse.length);
  $('stat-wolse').textContent = nf.format(state.filtered.length-jeonse.length);
  const med = median(jeonse.map(r => r.deposit));
  $('stat-median').innerHTML = med === null ? '—' : `${nf.format(Number(med.toFixed(1)))}<small>만원</small>`;
}
function rowHtml(r) {
  const type = r.monthlyRent > 0 ? '월세' : '전세';
  const cls = r.monthlyRent > 0 ? 'wolse' : '';
  return `<tr><td>${esc(r.dealDate)}</td><td><div class="apt-title">${esc(r.aptName)}</div><div class="apt-dong">${esc(r.dong)}${r.jibun ? ` · ${esc(r.jibun)}` : ''}</div></td><td class="numeric">${r.area.toFixed(2)}㎡</td><td class="numeric">${formatMoney(r.floor)}</td><td><span class="type-tag ${cls}">${type}</span></td><td class="numeric"><strong>${formatMoney(r.deposit)}</strong></td><td class="numeric">${formatMoney(r.monthlyRent)}</td><td>${esc(r.contractType || '—')}</td><td>${r.buildYear || '—'}</td></tr>`;
}
function emptyRow(title, hint) {
  return `<tr class="empty-row"><td colspan="9"><div class="empty-icon">⌕</div><strong>${esc(title)}</strong><p>${esc(hint)}</p></td></tr>`;
}
function renderRows() {
  const total = state.filtered.length;
  const max = Math.max(1, Math.ceil(total/PAGE_LENGTH));
  state.page = Math.min(state.page, max);
  const first = (state.page-1)*PAGE_LENGTH;
  const part = state.filtered.slice(first, first+PAGE_LENGTH);
  $('results-body').innerHTML = part.length ? part.map(rowHtml).join('') : emptyRow('일치하는 거래가 없습니다', '검색 조건을 완화하거나 다른 계약기간을 선택해 보세요.');
  $('page-info').textContent = total ? `${nf.format(total)}건 중 ${nf.format(first+1)}~${nf.format(Math.min(first+PAGE_LENGTH,total))}건 표시` : (state.complete ? '조회 결과 0건' : '조회 전');
  $('page-number').textContent = total ? `${state.page} / ${max}` : '—';
  $('previous-page').disabled = state.page <= 1 || !total;
  $('next-page').disabled = state.page >= max || !total;
  $('results-subtitle').textContent = state.complete ? `총 ${nf.format(state.rows.length)}건 수집 · 조건에 맞는 거래 ${nf.format(total)}건${state.failed.length ? ` · ${state.failed.length}개월 오류` : ''}` : '조건을 선택하고 조회 버튼을 눌러주세요.';
}
async function fetchPage(lawdCd, ym, pageNo, signal) {
  const url = new URL(API_PATH, location.href);
  url.searchParams.set('lawdCd', lawdCd);
  url.searchParams.set('ymd', ym);
  url.searchParams.set('pageNo', String(pageNo));
  const response = await fetch(url, { signal });
  let data;
  try { data = await response.json(); } catch { throw new Error('서버가 올바른 JSON을 반환하지 않았습니다. Cloudflare Pages Functions 배포 상태를 확인하세요.'); }
  if (!response.ok) throw new Error(data?.error || `조회 오류 (${response.status})`);
  if (!Array.isArray(data.items)) throw new Error('서버의 거래자료 형식이 올바르지 않습니다.');
  return data;
}
async function fetchMonth(lawdCd, ym, signal) {
  const first = await fetchPage(lawdCd, ym, 1, signal);
  const rows = [...first.items];
  const pages = Math.ceil(first.totalCount / first.pageSize);
  if (!Number.isFinite(pages) || pages > 100) throw new Error('이 지역의 응답이 너무 큽니다. 조회 범위를 조정하세요.');
  for (let page = 2; page <= pages; page++) {
    const next = await fetchPage(lawdCd, ym, page, signal);
    if (!next.items.length) throw new Error(`${ym} 거래자료 페이지 ${page}가 비어 있어 전체 자료를 확인할 수 없습니다.`);
    rows.push(...next.items);
  }
  if (rows.length < first.totalCount) throw new Error(`${ym}의 일부 거래가 누락되었습니다. 다시 조회하세요.`);
  return rows;
}
async function runSearch(event) {
  event.preventDefault();
  const lawdCd = selectedLawdCode();
  const start = $('start-month').value;
  const end = $('end-month').value;
  const now = currentSeoulYm();
  if (!/^\d{5}$/.test(lawdCd)) return notify('조회 지역을 선택하거나 시군구 법정동코드 5자리를 입력하세요.', 'error');
  if (!start || !end || start > end || end > now) return notify('조회 시작월과 종료월을 확인하세요. 미래의 계약월은 조회할 수 없습니다.', 'error');
  const months = monthsBetween(start, end);
  if (!months.length || months.length > MONTH_LIMIT || offsetYm(start, months.length - 1) !== end) {
    return notify('한 번에 최대 12개월까지 검색할 수 있습니다.', 'error');
  }
  if (state.abort) state.abort.abort();
  const controller = new AbortController();
  state.abort = controller;
  state.loading = true;
  state.complete = false;
  state.rows = []; state.filtered = []; state.failed = [];
  $('search-button').disabled = true;
  $('search-button').textContent = '조회 중…';
  $('download-button').disabled = true;
  $('progress-area').hidden = false;
  $('progress-caption').textContent = '국토교통부 API에서 자료를 가져오고 있습니다…';
  $('progress-fill').style.width = '0%';
  $('progress-count').textContent = `0 / ${months.length}개월`;
  notify('조회 월별 자료를 수집 중입니다. 완료되는 대로 결과를 표시합니다.');
  let index = 0, done = 0;
  const monthResults = new Array(months.length);
  async function worker() {
    while (index < months.length && !controller.signal.aborted) {
      const idx = index++;
      try { monthResults[idx] = await fetchMonth(lawdCd, months[idx], controller.signal); }
      catch (e) {
        if (controller.signal.aborted) return;
        state.failed.push(`${months[idx]}: ${e.message}`);
        monthResults[idx] = [];
      }
      done++;
      $('progress-fill').style.width = `${Math.round(done / months.length * 100)}%`;
      $('progress-count').textContent = `${done} / ${months.length}개월`;
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, months.length) }, worker));
  if (controller.signal.aborted) return;
  state.rows = monthResults.flat().filter(Boolean);
  state.loading = false;
  state.complete = true;
  $('search-button').disabled = false;
  $('search-button').innerHTML = '<span class="button-icon">⌕</span> 실거래가 조회';
  $('progress-area').hidden = true;
  updateFilters();
  if (state.failed.length) {
    notify(`${months.length-state.failed.length}개월 조회 성공, ${state.failed.length}개월 실패. 불완전한 자료입니다. 실패 월: ${state.failed.join(' / ')}`, 'warning');
  } else if (!state.rows.length) {
    notify('해당 기간의 공개 거래자료가 없습니다. 다른 지역이나 계약월로 검색해 보세요.');
  } else {
    notify(`${months.length}개월 자료를 정상 조회했습니다. 총 ${nf.format(state.rows.length)}건 수집 · ${nf.format(state.filtered.length)}건 표시`);
  }
}
function csvCell(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  const string = String(value ?? '');
  // Excel CSV 수식 삽입 방지. 사용자가 만든 아파트명도 안전하게 텍스트로 취급한다.
  const escapedFormula = /^[\s]*[=+@\-\t\r]/.test(string) ? `'${string}` : string;
  return `"${escapedFormula.replace(/"/g,'""')}"`;
}
function exportCsv() {
  if (!state.filtered.length || state.loading) return;
  const headers = ['계약일','아파트명','법정동','지번','전용면적(㎡)','층','유형','보증금(만원)','월세(만원)','건축년도','계약구분','계약기간','갱신요구권','종전보증금(만원)','종전월세(만원)'];
  const rows = state.filtered.map(r => [r.dealDate,r.aptName,r.dong,r.jibun,r.area,r.floor,r.monthlyRent?'월세':'전세',r.deposit,r.monthlyRent,r.buildYear||'',r.contractType,r.contractTerm,r.renewalRight,r.previousDeposit,r.previousMonthlyRent]);
  const content = '\uFEFF' + [headers,...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([content], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url;
  a.download = `아파트_전월세_실거래가_${selectedLawdCode()}_${$('start-month').value}_${$('end-month').value}.csv`;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Optional map extension: map features never change the official transaction data.
const mapModule = (() => {
  const RADIUS_METERS = 10_000; // 기준 주소와 아파트 사이의 직선거리 10km
  const m = { origin:null, properties:[], map:null, originMarker:null, markers:[], routeLine:null,
    selected:null, route:null, token:0, sdkPromise:null, radiusCircle:null, geocodeCache:new Map(), routeCache:new Map() };
  const setInfo = (message, error=false) => {
    $('map-feedback').textContent = message;
    $('map-feedback').classList.toggle('error',error);
  };
  async function getJson(path) {
    const response = await fetch(path);
    let data;
    try { data = await response.json(); } catch { throw new Error(`서버 응답이 JSON이 아닙니다 (${response.status}).`); }
    if (!response.ok) throw new Error(data.error || `API 오류 ${response.status}`);
    return data;
  }
  function distance(a,b) {
    const rad = n=>n*Math.PI/180;
    const R = 6371000;
    const deltaLat = rad(b.lat-a.lat), deltaLng = rad(b.lng-a.lng);
    const h = Math.sin(deltaLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(deltaLng/2)**2;
    return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));
  }
  const formatDist = meters => Number.isFinite(meters) ? (meters < 1000 ? `${nf.format(Math.round(meters))}m` : `${(meters/1000).toFixed(2)}km`) : '—';
  function coord(lat,lng) { return new window.kakao.maps.LatLng(lat,lng); }
  function clearMapPoints() {
    for (const marker of m.markers) marker.setMap(null);
    m.markers=[];
    if (m.routeLine) m.routeLine.setMap(null);
    m.routeLine=null;
  }
  function imageFor(kind) {
    const fill = kind === 'origin' ? '#1158bd' : '#ed8a32';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42"><path d="M16 2C7.7 2 1 8.6 1 16.8 1 28 16 40 31 28 31 16.8 31 16.8 31 8.6 24.3 2 16 2Z" fill="${fill}" stroke="white" stroke-width="2"/><circle cx="16" cy="16" r="6.3" fill="white"/></svg>`;
    return new window.kakao.maps.MarkerImage('data:image/svg+xml;charset=UTF-8,'+encodeURIComponent(svg),new window.kakao.maps.Size(32,42),{offset:new window.kakao.maps.Point(16,40)});
  }
  async function initMap() {
    if (m.map) return m.map;
    if (m.sdkPromise) return m.sdkPromise;
    m.sdkPromise = (async()=>{
      const config = await getJson('/api/map-config');
      if (!config.mapKey) throw new Error('지도 표시를 위해 KAKAO_MAP_JS_KEY 변수를 등록해 주세요. 거리 목록은 계속 사용할 수 있습니다.');
      if (!window.kakao?.maps) {
        await new Promise((resolve,reject)=>{
          const script = document.createElement('script');
          script.src='https://dapi.kakao.com/v2/maps/sdk.js?autoload=false&appkey='+encodeURIComponent(config.mapKey);
          script.async=true;script.onload=resolve;script.onerror=()=>reject(new Error('카카오 지도 SDK 로드 실패. JavaScript 키에 웹사이트 도메인을 등록했는지 확인하세요.'));
          document.head.appendChild(script);
        });
      }
      await new Promise((resolve,reject)=>{
        try {window.kakao.maps.load(resolve);}catch {reject(new Error('카카오 지도 초기화에 실패했습니다. JS 키와 사이트 도메인을 확인하세요.'));}
      });
      const el=$('apt-map');
      el.replaceChildren();
      m.map = new window.kakao.maps.Map(el,{center:coord(m.origin.lat,m.origin.lng),level:6});
      m.originMarker = new window.kakao.maps.Marker({map:m.map,position:coord(m.origin.lat,m.origin.lng),image:imageFor('origin'),title:'기준 위치'});
      setTimeout(()=>m.map.relayout(),0);
      return m.map;
    })().catch(error=>{m.sdkPromise=null;throw error;});
    return m.sdkPromise;
  }
  function drawPoints() {
    if (!m.map || !m.origin) return;
    clearMapPoints();
    m.originMarker?.setMap(null);
    m.originMarker = new window.kakao.maps.Marker({map:m.map,position:coord(m.origin.lat,m.origin.lng),image:imageFor('origin'),title:'기준 위치'});
    // 기준 위치의 10km 검색 반경 원을 그립니다. 직선거리이며 실제 이동거리가 아닙니다.
    if (m.radiusCircle) m.radiusCircle.setMap(null);
    m.radiusCircle = new window.kakao.maps.Circle({
      map:m.map, center:coord(m.origin.lat,m.origin.lng), radius:RADIUS_METERS,
      strokeWeight:2, strokeColor:'#2779cf', strokeOpacity:0.85,
      strokeStyle:'solid', fillColor:'#4e9de6', fillOpacity:0.08,
    });
    const bounds = new window.kakao.maps.LatLngBounds();
    const latDelta=RADIUS_METERS/111320;
    const lngDelta=RADIUS_METERS/(111320*Math.max(0.15,Math.cos(m.origin.lat*Math.PI/180)));
    bounds.extend(coord(m.origin.lat-latDelta,m.origin.lng-lngDelta));
    bounds.extend(coord(m.origin.lat+latDelta,m.origin.lng+lngDelta));
    m.properties.forEach((apt,i)=>{
      const marker = new window.kakao.maps.Marker({map:m.map,position:coord(apt.lat,apt.lng),image:imageFor('apt'),title:apt.name});
      window.kakao.maps.event.addListener(marker,'click',()=>choose(i));
      m.markers.push(marker); bounds.extend(coord(apt.lat,apt.lng));
    });
    m.map.setBounds(bounds,38,38,38,38);
  }
  async function locate() {
    const addr=$('base-address').value.trim();
    if (!addr) return setInfo('기준 주소를 입력해 주세요.',true);
    $('locate-button').disabled=true;
    setInfo('입력한 주소를 좌표로 변환하고 있습니다…');
    try {
      const geo=await getJson('/api/geocode?'+new URLSearchParams({address:addr}));
      m.origin={lat:geo.lat,lng:geo.lng,address:geo.address,inputAddress:addr};
      m.token++;
      m.properties=[]; m.selected=null; m.route=null;
      $('route-detail').hidden=true;
      $('map-apt-list').innerHTML='<div class="list-empty">기준 위치가 설정됐습니다.<br />거래 자료를 조회한 후 아파트 지도를 표시하세요.</div>';
      $('map-result-count').textContent='0개 단지';
      $('map-apts-button').disabled = !state.complete || !state.filtered.length;
      let mapWarning='';
      try { await initMap();drawPoints(); } catch(err) {mapWarning=' 지도 표시: '+err.message;}
      setInfo(`기준 위치 확인: ${geo.address}. 실거래 조회 후 [아파트 지도 표시]를 눌러주세요.${mapWarning}`,Boolean(mapWarning));
    } catch(err){setInfo(err.message,true);} finally {$('locate-button').disabled=false;}
  }
  function invalidate() {
    m.token++;
    m.properties=[];m.selected=null;m.route=null;
    clearMapPoints();
    $('route-detail').hidden=true;
    $('map-result-count').textContent='0개 단지';
    $('map-apt-list').innerHTML='<div class="list-empty">조회된 아파트를 표시하려면<br />[아파트 지도 표시]를 눌러주세요.</div>';
    $('map-apts-button').disabled=!m.origin||!state.complete||!state.filtered.length;
    if (m.map) drawPoints();
  }
  function groupsForSearch() {
    const seen=new Set(); const output=[];
    for (const r of state.filtered) {
      // 아파트 거래 건수가 아닌 고유 단지 기준으로 위치를 한 번씩 조회합니다.
      const key=`${r.dong}|${r.jibun}|${r.aptName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      output.push({key, name:r.aptName, dong:r.dong, jibun:r.jibun, sample:r});
    }
    return output;
  }
  async function findApt(item) {
    let prefix = $('sido').value === '__manual__' ? '' : `${$('sido').value} ${selectedDistrictName()} `;
    // Prefer an exact lot-address lookup to prevent same-name apartments being mixed.
    const hasLot = Boolean(item.jibun && /^\d/.test(item.jibun));
    const input = hasLot ? `${prefix}${item.dong} ${item.jibun}` : `${prefix}${item.dong} ${item.name}`;
    const params = new URLSearchParams({address:input, mode:'apt'});
    const cacheKey=`${input}|apt`;
    if (!m.geocodeCache.has(cacheKey)) m.geocodeCache.set(cacheKey,getJson('/api/geocode?'+params));
    try {
      const geo=await m.geocodeCache.get(cacheKey);
      return {...item,lat:geo.lat,lng:geo.lng,address:geo.address,quality:geo.precise?'지번 주소':'단지명 추정',meters:distance(m.origin,geo)};
    } catch {m.geocodeCache.delete(cacheKey); return null;}
  }
  function renderAptList() {
    $('map-result-count').textContent=`${m.properties.length}개 단지`;
    if(!m.properties.length) {
      $('map-apt-list').innerHTML='<div class="list-empty">조회된 거래 단지 중 직선거리 10km 이내로 확인된 아파트가 없습니다.<br />기준 주소와 조회 지역을 확인하세요.</div>';
      return;
    }
    $('map-apt-list').innerHTML=m.properties.map((r,i)=>`<button type="button" class="map-apt-item ${m.selected===i?'active':''}" data-apt-index="${i}"><span class="apt-rank">${i+1}</span><span class="apt-result-main"><span class="apt-result-name">${esc(r.name)}</span><span class="apt-result-sub">${esc(r.dong)} ${esc(r.jibun)} · ${r.quality==='지번 주소'?'지번 검색':'위치 확인 필요'}</span></span><span class="apt-result-distance">${formatDist(r.meters)}</span></button>`).join('');
    for (const btn of $('map-apt-list').querySelectorAll('[data-apt-index]')) btn.addEventListener('click',()=>choose(Number(btn.dataset.aptIndex)));
  }
  async function displayApartments() {
    if (!m.origin) return setInfo('먼저 기준 주소를 입력해 주세요.',true);
    if ($('base-address').value.trim() !== m.origin.inputAddress) return setInfo('기준 주소가 변경됐습니다. [기준 주소 표시]를 다시 눌러주세요.',true);
    if (!state.complete || !state.filtered.length) return setInfo('실거래가 조회 결과가 없습니다. 먼저 실거래가를 조회하세요.',true);
    const token=++m.token;
    $('map-apts-button').disabled=true;
    m.properties=[];m.selected=null;m.route=null;
    $('route-detail').hidden=true;
    clearMapPoints();
    const candidates=groupsForSearch();
    let next=0,processed=0,geocodeFailed=0,outsideCount=0;
    const results=[];
    setInfo(`조회된 고유 단지 ${candidates.length}개의 위치를 확인하고 있습니다. 직선거리 10km 이내만 지도에 표시합니다…`);
    async function worker() {
      while(next<candidates.length && token===m.token) {
        const item=candidates[next++];
        const geo=await findApt(item);
        if(token!==m.token) return;
        if (!geo) geocodeFailed++;
        else if (geo.meters <= RADIUS_METERS) results.push(geo); // 10km 경계 포함
        else outsideCount++;
        processed++;
        setInfo(`단지 위치 확인 ${processed}/${candidates.length} · 10km 이내 ${results.length}개 · 범위 밖 ${outsideCount}개 · 위치 미확인 ${geocodeFailed}개`);
      }
    }
    try {
      // 모든 고유 단지를 검사합니다. 단, REST API 호출 폭주를 막기 위해 최대 3건씩 처리합니다.
      await Promise.all(Array.from({length:Math.min(3,candidates.length)},worker));
      if(token!==m.token) return;
      m.properties=results.sort((a,b)=>a.meters-b.meters);
      m.selected=null;renderAptList();drawPoints();
      const partial=Boolean(state.failed.length || geocodeFailed);
      setInfo(`기준 주소 직선거리 10km 이내 ${m.properties.length}개 단지를 가까운 순으로 표시했습니다. 검사 ${processed}개 / 범위 밖 ${outsideCount}개 / 위치 미확인 ${geocodeFailed}개${state.failed.length?` / 거래 조회 실패 ${state.failed.length}개월`:''}. ${partial?'일부 단지는 제외 여부를 확정할 수 없습니다.':'단지를 선택하면 차량·도보 이동시간을 조회합니다.'}`,partial);
    } finally { if(token===m.token) $('map-apts-button').disabled=false; }
  }
  function routeValue(id,metric) {$(id).textContent=metric?.available ? `${metric.minutes}분` : '조회 불가';}
  function routeDistanceValue(id,metric) {$(id).textContent=metric?.available ? `이동 ${formatDist(metric.distanceMeters)}` : (metric?.reason||'경로 조회 실패');}
  function drawRoute(kind) {
    if(!m.map) return;
    if(m.routeLine) m.routeLine.setMap(null);
    m.routeLine=null;
    const result=m.route?.[kind];
    $('show-drive-route').classList.toggle('active',kind==='drive');
    $('show-walk-route').classList.toggle('active',kind==='walk');
    if (!result?.available || !result.path?.length) return;
    m.routeLine = new window.kakao.maps.Polyline({
      map:m.map, path:result.path.map(([lat,lng])=>coord(lat,lng)),
      strokeWeight:5,strokeColor:kind==='drive'?'#1663ce':'#ea7c2e',strokeOpacity:0.9,strokeStyle:'solid',
    });
  }
  async function choose(index) {
    const apt=m.properties[index];
    if(!apt||!m.origin) return;
    const token=m.token;
    m.selected=index; m.route=null;
    renderAptList();
    $('route-detail').hidden=false;
    $('route-name').textContent=apt.name;
    $('route-quality').textContent=apt.quality;
    $('route-address').textContent=apt.address;
    $('straight-distance').textContent=formatDist(apt.meters);
    for(const id of ['drive-duration','walk-duration']) $(id).textContent='조회 중';
    for(const id of ['drive-distance','walk-distance']) $(id).textContent='실제 경로 조회 중…';
    $('show-drive-route').disabled=true;
    $('show-walk-route').disabled=true;
    $('external-map-link').href=`https://map.kakao.com/link/to/${encodeURIComponent(apt.name)},${apt.lat},${apt.lng}`;
    if(m.map) {
      if(m.routeLine)m.routeLine.setMap(null);
      m.routeLine=null;
      m.map.panTo(coord(apt.lat,apt.lng));
    }
    const params = new URLSearchParams({fromLat:m.origin.lat,fromLng:m.origin.lng,toLat:apt.lat,toLng:apt.lng});
    const key=params.toString();
    if (!m.routeCache.has(key)) m.routeCache.set(key,getJson('/api/route?'+params));
    try {
      const result=await m.routeCache.get(key);
      if(token!==m.token||index!==m.selected)return;
      m.route=result;
      routeValue('drive-duration',result.drive);routeValue('walk-duration',result.walk);
      routeDistanceValue('drive-distance',result.drive);routeDistanceValue('walk-distance',result.walk);
      $('show-drive-route').disabled=!result.drive?.available;
      $('show-walk-route').disabled=!result.walk?.available;
      if(result.drive?.available)drawRoute('drive');else if(result.walk?.available)drawRoute('walk');
      setInfo('예상시간은 실제 길찾기 API에서 반환한 값입니다. 경로 버튼으로 자동차/도보 이동선을 전환할 수 있습니다.');
    } catch(err) {
      m.routeCache.delete(key);
      if(token!==m.token||index!==m.selected)return;
      for(const id of ['drive-duration','walk-duration']) $(id).textContent='조회 불가';
      for(const id of ['drive-distance','walk-distance']) $(id).textContent=err.message;
      setInfo('길찾기 오류: '+err.message,true);
    }
  }
  function wire() {
    $('locate-button').addEventListener('click',locate);
    $('base-address').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();locate();}});
    $('map-apts-button').addEventListener('click',displayApartments);
    $('show-drive-route').addEventListener('click',()=>drawRoute('drive'));
    $('show-walk-route').addEventListener('click',()=>drawRoute('walk'));
  }
  return {wire,invalidate};
})();

document.addEventListener('DOMContentLoaded', () => {
  initDefaults();
  mapModule.wire();
  $('sido').addEventListener('change', () => renderDistricts());
  $('sigungu').addEventListener('change', updateCriteriaSummary);
  $('period').addEventListener('change', applyPeriod);
  for (const id of ['start-month', 'end-month', 'apt-name']) {
    $(id).addEventListener('input', updateCriteriaSummary);
  }
  $('lawd-cd').addEventListener('input', e => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 5);
    updateCriteriaSummary();
  });
  $('search-form').addEventListener('submit', runSearch);
  $('reset-button').addEventListener('click', () => {
    if (state.abort) state.abort.abort();
    $('search-form').reset(); initDefaults();
    state.rows = [];state.filtered = [];state.failed = [];state.loading = false;state.complete = false;state.page=1;
    mapModule.invalidate();
    $('search-button').disabled = false;
    $('search-button').innerHTML = '<span class="button-icon">⌕</span> 실거래가 조회';
    $('download-button').disabled = true;
    $('progress-area').hidden = true;
    $('stat-all').textContent = $('stat-jeonse').textContent = $('stat-wolse').textContent = $('stat-median').textContent = '—';
    $('results-body').innerHTML = emptyRow('아직 조회된 내역이 없습니다', '시·도 / 시·군·구와 기간을 선택해 조회해 주세요.');
    $('results-subtitle').textContent = '조건을 선택하고 조회 버튼을 눌러주세요.';
    $('page-info').textContent='조회 전'; $('page-number').textContent='—';
    $('previous-page').disabled = true; $('next-page').disabled = true; notify('');
  });
  for (const id of ['apt-name','area','tolerance','deal-type']) {
    $(id).addEventListener('input', () => { if (state.complete && !state.loading) updateFilters(); });
  }
  $('download-button').addEventListener('click', exportCsv);
  $('previous-page').addEventListener('click', () => { if (state.page > 1) {state.page--;renderRows();} });
  $('next-page').addEventListener('click', () => { if (state.page * PAGE_LENGTH < state.filtered.length) {state.page++;renderRows();} });
});
