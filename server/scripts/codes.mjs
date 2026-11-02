// 초대 코드 관리
//   npm run code:add -- 친구이름 [하루횟수]   새 코드 발급
//   npm run code:list                         코드 목록
//   npm run code:off -- <코드>                코드 막기
// 로컬 테스트 서버(wrangler dev)에 하려면 끝에 --local 을 붙인다.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const args = process.argv.slice(2);
const local = args.includes('--local');
const [cmd, ...rest] = args.filter((a) => a !== '--local');
const target = local ? '--local' : '--remote';

const wrangler = (...a) =>
  execFileSync('npx', ['wrangler', 'kv', 'key', ...a, '--binding', 'CODES', target], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'inherit'],
  });

const newCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 헷갈리는 0/O/1/I 제외
  const bytes = randomBytes(12);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
};

const q = (s) => (process.platform === 'win32' ? `"${s.replace(/"/g, '\\"')}"` : s);

if (cmd === 'add') {
  const [name, daily = '20'] = rest;
  if (!name) throw new Error('사용법: npm run code:add -- 친구이름 [하루횟수]');
  const code = newCode();
  wrangler('put', `code:${code}`, q(JSON.stringify({ name, daily: Number(daily), active: true })));
  console.log(`\n발급 완료 → ${name}: ${code} (하루 ${daily}회)\n`);
} else if (cmd === 'list') {
  const keys = JSON.parse(wrangler('list', '--prefix', 'code:'));
  for (const { name } of keys) {
    const record = JSON.parse(wrangler('get', name));
    console.log(`${name.slice(5)}  ${record.active === false ? '[막힘]' : '[사용중]'}  ${record.name}  하루 ${record.daily}회`);
  }
  if (!keys.length) console.log('발급된 코드가 없습니다.');
} else if (cmd === 'off') {
  const [code] = rest;
  const record = JSON.parse(wrangler('get', `code:${code}`));
  wrangler('put', `code:${code}`, q(JSON.stringify({ ...record, active: false })));
  console.log(`막음 → ${record.name}: ${code}`);
} else {
  console.log('명령: add | list | off');
}
