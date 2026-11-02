# 홍보영상 프롬프트 메이커 v2

상품 키워드와 샵 이름만 넣으면 (예: `겨울 코트` / `상아 샵`) 고퀄리티 홍보영상 기획서와 **이미지·영상 AI에 바로 붙여넣을 씬별 프롬프트**를 만들어 주는 데스크탑 앱입니다.

> v1(API 키가 앱에 들어 있던 버전)은 [`v1` 브랜치](../../tree/v1)와 `v1.0.0` 태그에 그대로 남아 있습니다.

## v2에서 달라진 점

- **보안:** 앱에 API 키가 없습니다. 키는 중계 서버(Cloudflare Worker)에만 있고, 앱은 운영자가 발급한 **초대 코드**로만 접속합니다. 서버는 정해진 입력(상품·샵·옵션·이미지)만 받아 서버 안에서 프롬프트를 조립하기 때문에, 코드를 가진 사람도 서버를 다른 용도의 Claude 프록시로 쓸 수 없습니다. 코드별·전체 하루 사용 횟수도 제한합니다.
- **FLUX 3 → LTX-2.5:** 씬마다 FLUX 3 키프레임(첫 프레임) 이미지 프롬프트와, 그 이미지를 넣어 돌리는 LTX-2.5 이미지-투-비디오 프롬프트(효과음·앰비언스 포함)를 만듭니다. Veo 3·Sora 2·Kling·Runway·범용도 계속 지원합니다.
- **컷 간 일관성 고정:** 상품·인물·배경·조명·톤·사운드마다 "고정 문구"를 정하고 모든 컷 프롬프트에 똑같이 넣습니다. 앱이 컷마다 고정 문구가 빠짐없이 들어갔는지 검사해 `일관성 고정 ✓ 5/5`처럼 표시합니다. 컷마다 어떤 이미지를 레퍼런스로 넣을지도 알려 줍니다.
- **참고 이미지 누끼:** 상품·모델·매장 사진을 넣으면 이 PC에서 배경을 지우고(최대 3장), AI가 그 모습을 그대로 고정 문구에 반영합니다. 누끼 PNG는 저장해서 FLUX 3 레퍼런스로 쓸 수 있습니다.

## 고객(친구) 사용법

1. 설치 파일을 받아 실행합니다.
2. 처음 실행하면 운영자에게 받은 **초대 코드**를 입력합니다.
3. 상품 키워드와 샵 이름을 입력하고, 필요하면 참고 이미지를 추가한 뒤 **영상 프롬프트 만들기**를 누릅니다.

## 운영자: 서버 배포 (처음 한 번)

```bash
cd server
npm install
npx wrangler login
npx wrangler kv namespace create CODES
```

출력된 `id`를 [server/wrangler.toml](server/wrangler.toml)의 `REPLACE_WITH_KV_ID` 자리에 넣고:

```bash
npx wrangler secret put ANTHROPIC_API_KEY
npm run deploy
```

배포가 끝나면 나오는 `https://video-promo-prompt-server.<내계정>.workers.dev` 주소를 [src/config.js](src/config.js)의 `SERVER_URL`에 넣고 설치 파일을 만듭니다.

```bash
npm run dist
```

## 운영자: 초대 코드 관리

```bash
cd server
npm run code:add -- 민지 20
npm run code:list
npm run code:off -- ABCD-EFGH-JKLM
```

`code:add`는 이름과 하루 횟수(기본 20회)로 코드를 발급합니다. 서비스 전체 하루 최대 횟수는 `wrangler.toml`의 `GLOBAL_DAILY_LIMIT`(기본 200회)입니다. Anthropic 콘솔에서 월 사용 한도도 함께 걸어 두세요.

## 개발

```bash
cd server
npm run dev
```

로컬 서버용 키는 `server/.dev.vars`에 `ANTHROPIC_API_KEY=...` 한 줄로 넣습니다(커밋되지 않음). 로컬 초대 코드는 `npm run code:add -- 테스트 5 --local`로 만들고, 앱은 `VIDEO_PROMPT_SERVER=http://127.0.0.1:8787` 환경변수로 실행합니다.

## 구조

| 경로 | 역할 |
|---|---|
| `server/src/metaprompt.js` | **메타프롬프트 본체**: 시스템 프롬프트, 툴별 가이드, 일관성 고정 규칙, 출력 스키마, 입력 검증 |
| `server/src/index.js` | 중계 서버: 초대 코드 확인, 사용량 제한, Claude 호출(`claude-opus-5-5`) 스트리밍 |
| `server/scripts/codes.mjs` | 초대 코드 발급·목록·차단 |
| `main.js` | Electron 메인 프로세스: 서버 통신, 초대 코드 저장, 누끼 처리 |
| `src/cutout.js` | 배경 제거(`@imgly/background-removal-node`) |
| `renderer/` | UI |

## 라이선스

배경 제거에 쓰는 `@imgly/background-removal-node`가 AGPL-3.0이라 이 앱도 AGPL-3.0으로 배포합니다.
