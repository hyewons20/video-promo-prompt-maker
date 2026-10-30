# 홍보영상 프롬프트 메이커

상품 키워드와 샵 이름만 넣으면 (예: `겨울 코트` / `상아 샵`) 고퀄리티 홍보영상 기획서와 **영상 AI에 바로 붙여넣을 씬별 프롬프트**를 만들어 주는 데스크탑 앱입니다.

## 실행

```bash
npm install
npm start
```

처음 실행하면 오른쪽 위 **⚙ 설정**에서 Anthropic API 키(console.anthropic.com에서 발급)를 입력하세요. 키는 OS 암호화 저장소(safeStorage)를 써서 이 PC에 저장됩니다. 환경변수 `ANTHROPIC_API_KEY`가 있으면 그 값을 대신 씁니다.

## 운영자 키로 배포하기 (고객은 키 입력 없이 사용)

1. `operator-key.example.txt`를 `operator-key.txt`로 복사하고, 내용을 운영자 API 키 한 줄로 바꿉니다.
2. 설치 파일을 만듭니다.

   ```bash
   npm run dist
   ```

3. `dist\홍보영상 프롬프트 메이커 Setup 1.0.0.exe`를 고객에게 전달합니다.

`operator-key.txt`가 있으면 앱은 그 키를 쓰고, 고객 화면에서 ⚙ 설정 버튼을 숨깁니다. 이 파일은 `.gitignore`에 들어 있습니다.

> ⚠ 키는 설치 폴더의 `resources\operator-key.txt`에 그대로 들어갑니다. 설치본을 받은 사람은 누구나 키를 꺼낼 수 있으니, 믿을 수 있는 고객에게만 배포하고 console.anthropic.com에서 **월 사용 한도(spend limit)**를 꼭 걸어 두세요. 불특정 다수에게 배포하려면 키를 서버에 두는 중계 서버 방식이 안전합니다.

## 만들어 주는 것

- 콘셉트: 제목, 로그라인, 타깃, 무드, 컬러 팔레트, 음악
- 씬별 영문 프롬프트 (HOOK → DESIRE → PROOF → CTA 구성, 씬마다 복사 버튼)
- 씬별 한글 자막 / 내레이션
- 원샷 마스터 프롬프트, 네거티브 프롬프트
- 인스타그램 업로드 문구와 해시태그, 제작 팁
- 전체 복사 / Markdown 파일로 저장

## 대상 영상 AI

범용, Google Veo 3, OpenAI Sora 2, Kling, Runway Gen-4 중에서 고를 수 있습니다. 툴마다 클립 길이와 프롬프트 문법이 달라서 씬 개수와 작성 규칙이 바뀝니다.

## 구조

| 파일 | 역할 |
|---|---|
| `src/metaprompt.js` | **메타프롬프트 본체**: 시스템 프롬프트, 툴별 가이드, 출력 JSON 스키마 |
| `main.js` | Electron 메인 프로세스, Claude API 호출(`claude-opus-5-5`, 스트리밍 + 구조화 출력) |
| `preload.js` | 렌더러와 메인 사이 IPC 브리지 |
| `renderer/` | UI (HTML/CSS/JS) |

품질을 조정하려면 `src/metaprompt.js`의 `SYSTEM_PROMPT`와 `TOOLS[*].guide`를 고치면 됩니다.
