// Cloudflare Pages Function: 국토교통부 아파트 전월세 실거래가 API
// /api/apt-rent?lawdCd=11680&ymd=202609&pageNo=1
// API 키를 GitHub에 기록하지 말고 Cloudflare Pages Secret으로 설정하세요.
const ENDPOINT = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent';
const PAGE_SIZE = 1000;

function reply(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function decodeXml(text) {
  return String(text ?? '').replace(/&(amp|lt|gt|quot|apos|#x[\da-fA-F]+|#\d+);/g, (match, entity) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (Object.prototype.hasOwnProperty.call(named, entity)) return named[entity];
    const hex = entity.startsWith('#x');
    const codepoint = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    return codepoint > 0 && codepoint <= 0x10ffff && !(codepoint >= 0xd800 && codepoint <= 0xdfff)
      ? String.fromCodePoint(codepoint) : '\uFFFD';
  }).trim();
}

function tag(xml, name) {
  const pattern = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i');
  const match = pattern.exec(xml);
  return match ? decodeXml(match[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1')) : '';
}

export function parseApiXml(xml) {
  if (typeof xml !== 'string' || !/<(?:\?xml|response|OpenAPI_ServiceResponse)/i.test(xml)) {
    throw new Error('XML 응답이 아닙니다.');
  }
  const code = tag(xml, 'resultCode') || tag(xml, 'returnReasonCode');
  const message = tag(xml, 'resultMsg') || tag(xml, 'returnAuthMsg') || tag(xml, 'errMsg');
  const names = [
    'aptNm', 'umdNm', 'jibun', 'excluUseAr', 'dealYear', 'dealMonth', 'dealDay',
    'deposit', 'monthlyRent', 'floor', 'buildYear', 'contractType', 'contractTerm',
    'useRRRight', 'preDeposit', 'preMonthlyRent',
  ];
  const items = [];
  for (const found of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const item = {};
    for (const name of names) item[name] = tag(found[1], name);
    items.push(item);
  }
  return {
    code, message, items,
    totalCount: tag(xml, 'totalCount'),
    numOfRows: tag(xml, 'numOfRows'),
  };
}

function asText(value) {
  return value === undefined || value === null || typeof value === 'object' ? '' : String(value).trim();
}
function toNumber(value) {
  const num = Number(asText(value).replace(/,/g, ''));
  return Number.isFinite(num) ? num : 0;
}
export function normalize(item) {
  const year = asText(item.dealYear);
  const month = asText(item.dealMonth).padStart(2, '0');
  const day = asText(item.dealDay).padStart(2, '0');
  const date = `${year}-${month}-${day}`;
  return {
    aptName: asText(item.aptNm),
    dong: asText(item.umdNm),
    jibun: asText(item.jibun),
    area: toNumber(item.excluUseAr),
    dealDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
    deposit: toNumber(item.deposit),
    monthlyRent: toNumber(item.monthlyRent),
    floor: toNumber(item.floor),
    buildYear: toNumber(item.buildYear),
    contractType: asText(item.contractType),
    contractTerm: asText(item.contractTerm),
    renewalRight: asText(item.useRRRight),
    previousDeposit: toNumber(item.preDeposit),
    previousMonthlyRent: toNumber(item.preMonthlyRent),
  };
}
function normalizeKey(raw) {
  const value = String(raw ?? '').trim();
  try { return decodeURIComponent(value); } catch { return value; }
}
function validYm(ym) {
  if (!/^(19|20)\d{2}(0[1-9]|1[0-2])$/.test(ym)) return false;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date());
  const currentYm = parts.find(p => p.type === 'year').value + parts.find(p => p.type === 'month').value;
  return ym <= currentYm;
}

export async function onRequestGet(context) {
  const qs = new URL(context.request.url).searchParams;
  const lawdCd = qs.get('lawdCd') || '';
  const ymd = qs.get('ymd') || '';
  const pageNo = Number(qs.get('pageNo') || 1);
  if (!/^\d{5}$/.test(lawdCd) || !validYm(ymd) || !Number.isInteger(pageNo) || pageNo < 1 || pageNo > 100) {
    return reply(400, { error: '시군구코드(5자리), 계약년월(YYYYMM), 페이지번호를 확인하세요.' });
  }
  const apiKey = normalizeKey(context.env.DATA_GO_KR_API_KEY);
  if (!apiKey || apiKey === '발급받은_인증키') {
    return reply(503, { error: 'DATA_GO_KR_API_KEY Secret이 설정되지 않았습니다. Cloudflare Pages 설정을 확인하세요.', stage: 'config' });
  }
  const url = new URL(ENDPOINT);
  url.searchParams.set('serviceKey', apiKey);
  url.searchParams.set('LAWD_CD', lawdCd);
  url.searchParams.set('DEAL_YMD', ymd);
  url.searchParams.set('pageNo', String(pageNo));
  url.searchParams.set('numOfRows', String(PAGE_SIZE));

  let response;
  try {
    response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/xml,text/xml,*/*' },
    });
  } catch (err) {
    console.error('APT upstream network failure:', err?.name || 'UnknownError');
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return reply(502, { error: timeout ? '공공데이터 API 응답 시간 초과' : '공공데이터 API 네트워크 연결 실패', stage: 'network' });
  }
  if (!response.ok) {
    console.error('APT upstream HTTP status:', response.status);
    return reply(502, { error: `공공데이터 API HTTP ${response.status} 오류`, stage: 'http' });
  }

  let parsed;
  try { parsed = parseApiXml(await response.text()); }
  catch { return reply(502, { error: '공공데이터 API가 올바른 XML을 반환하지 않았습니다.', stage: 'xml' }); }
  if (!['00', '000'].includes(parsed.code)) {
    console.error('APT upstream result code:', parsed.code);
    return reply(502, { error: `공공데이터 API 오류 (${parsed.code || '응답코드 없음'}): ${parsed.message || '인증 및 활용신청 상태 확인'}`, stage: 'api' });
  }
  const items = parsed.items.map(normalize);
  const totalCount = Number.parseInt(parsed.totalCount, 10);
  const resultPageSize = Number.parseInt(parsed.numOfRows, 10);
  return reply(200, {
    lawdCd, ymd, pageNo,
    pageSize: Number.isInteger(resultPageSize) && resultPageSize > 0 ? resultPageSize : PAGE_SIZE,
    totalCount: Number.isFinite(totalCount) ? totalCount : items.length,
    items,
    source: '국토교통부_아파트 전월세 실거래가 자료',
  });
}

export function onRequest() {
  return reply(405, { error: 'GET 요청만 지원합니다.' });
}
