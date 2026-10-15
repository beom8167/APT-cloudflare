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

document.addEventListener('DOMContentLoaded', () => {
  initDefaults();
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
