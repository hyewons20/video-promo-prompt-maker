// 중계 서버 주소 (비밀 아님). 배포 후 Worker 주소로 바꾼다. 개발 중에는 VIDEO_PROMPT_SERVER 환경변수로 덮어쓸 수 있다.
module.exports = {
  SERVER_URL: process.env.VIDEO_PROMPT_SERVER || 'https://video-promo-prompt-server.REPLACE.workers.dev',
};
