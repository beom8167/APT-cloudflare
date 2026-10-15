# 아파트 전월세 실거래가 조회 — Cloudflare Pages 무료 배포판

기존 Netlify 프로젝트의 화면은 유지하고, 서버 API만 Cloudflare Pages Functions로 바꾼 버전입니다.
공공데이터포털 인증키는 서버 Secret으로 보관합니다.

## 준비물

- GitHub 계정
- Cloudflare 계정
- 공공데이터포털 아파트 전월세 실거래가 자료 활용신청 및 인증키

## 폴더 구조

```text
apt-rent-cloudflare/
├─ public/
│  ├─ index.html
│  ├─ app.js
│  ├─ styles.css
│  └─ _headers
├─ functions/
│  └─ api/
│     └─ apt-rent.js
├─ tests/
│  └─ api.test.mjs
├─ package.json
└─ README.md
```

## 배포 방법 — Netlify 크레딧 불필요

1. GitHub에 **새 저장소** `APT-cloudflare`를 만듭니다. ZIP을 푼 뒤 **내부의 파일과 폴더**를 저장소 루트에 업로드합니다. 기존 `APT` 저장소를 건드리지 않아도 됩니다.
2. [Cloudflare 대시보드](https://dash.cloudflare.com/) > **Workers & Pages** > **Create** > **Pages** > **Connect to Git** 에서 새 GitHub 저장소를 연결합니다. 화면 메뉴는 변경될 수 있습니다.
3. 배포 설정:
   - Framework preset: **None** 또는 **No framework**
   - Production branch: **main**
   - Root directory: 기본값/비우기
   - Build command: **비우기**
   - Build output directory: **public**
4. 배포가 완료되면 Cloudflare Pages 프로젝트 > **Settings** > **Variables and Secrets** > **Add** 에서 다음 값을 추가합니다.
   - Name: `DATA_GO_KR_API_KEY`
   - Value: 공공데이터포털 발급 인증키 **Decoding 키** (Encoding 키도 자동 정규화 시도)
   - `Encrypt`를 선택하여 Secret으로 저장합니다.
   - Production 적용 후 **다시 배포**합니다.
5. 생성된 `https://프로젝트.pages.dev/` 로 접속하세요.
6. API 직접 점검: `https://프로젝트.pages.dev/api/apt-rent?lawdCd=11680&ymd=202609`
   - 정상: `items` 배열이 포함된 JSON
   - 503: Secret 미설정
   - 502 `stage: api`: 인증키/활용신청 또는 공공데이터 API 응답
   - 502 `stage: network`: 외부 API 연결 문제
   - 404: Cloudflare Pages Functions 빌드 또는 프로젝트 구조 확인

**주의:** Cloudflare Pages는 Functions가 있는 프로젝트를 대시보드의 파일 드래그 앤 드롭(Direct Upload) 방식으로 배포하는 것을 지원하지 않습니다. GitHub 연결 방식으로 배포하세요.

## 제약

- 실시간은 API 조회 시점에 *공개된 최신 자료를 가져오는 것*이며 모든 계약이 당일 즉시 공개되는 것은 아닙니다.
- 무료 사용량은 Cloudflare 정책에 따라 제한됩니다(월간 Pages Git 빌드 수, 일일 Functions 호출 등).
- 공공데이터포털 서비스 자체의 요청 제한 및 장애가 있을 수 있습니다.
- 실제 인증키를 이용한 운영 API 호출은 배포 후 확인해야 합니다. 로컬 테스트는 모의 응답을 사용합니다.

## 로컬 테스트

```bash
node --test tests/*.test.mjs
```
