#!/usr/bin/env node
/**
 * 隐形账本 · 一键上传到 GitHub
 * 建仓库 → 推送 main → 开启 Pages
 *
 * 用法：
 *   GH_TOKEN=github_pat_xxx node deploy-github.js
 *   GH_TOKEN=xxx REPO_NAME=invisible-ledger PRIVATE=1 node deploy-github.js
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TOKEN_FILE = path.join(__dirname, '.gh-token');

// token 来源优先级：环境变量 → 命令行参数 → .gh-token 文件（推荐，避免留在命令历史里）
let TOKEN = process.env.GH_TOKEN || process.argv[2] || '';
if (!TOKEN && fs.existsSync(TOKEN_FILE)) {
  TOKEN = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
}
const REPO = process.env.REPO_NAME || 'invisible-ledger';
const PRIVATE = process.env.PRIVATE === '1';
const BRANCH = 'main';
const DESC = '隐形账本 · 看见每一份看不见的劳动';

if (!TOKEN) {
  console.error('✗ 缺少 Token。三种给法任选其一：');
  console.error('   1) GH_TOKEN=github_pat_xxx node deploy-github.js');
  console.error('   2) node deploy-github.js github_pat_xxx');
  console.error(`   3) 把 token 写进 ${TOKEN_FILE}，然后直接 node deploy-github.js`);
  process.exit(1);
}

const dir = __dirname;
const api = async (method, p, body) => {
  const res = await fetch('https://api.github.com' + p, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'invisible-ledger-deploy'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* 非 JSON */ }
  return { status: res.status, json, text };
};

const git = (args, opts) => execFileSync('git', args, Object.assign({ cwd: dir, stdio: 'inherit' }, opts || {}));

(async () => {
  console.log('→ 校验 Token …');
  const me = await api('GET', '/user');
  if (!me.json || !me.json.login) {
    console.error(`✗ Token 无效或权限不足（HTTP ${me.status}）：${me.text.slice(0, 200)}`);
    process.exit(1);
  }
  const owner = process.env.OWNER || me.json.login;
  console.log(`  账号：${me.json.login}`);

  console.log(`→ 创建仓库 ${owner}/${REPO} …`);
  const create = await api('POST', '/user/repos', {
    name: REPO,
    private: PRIVATE,
    description: DESC,
    has_issues: true,
    has_wiki: false,
    auto_init: false
  });
  if (create.status === 201) console.log('  已创建');
  else if (/already exists/i.test(create.text)) console.log('  仓库已存在，继续推送');
  else {
    console.error(`✗ 创建失败（HTTP ${create.status}）：${create.text.slice(0, 300)}`);
    process.exit(1);
  }

  console.log('→ 推送代码 …');
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], { cwd: dir, stdio: 'pipe' });
  } catch (e) {
    git(['init', '-q']);
    git(['add', '-A']);
    git(['-c', 'user.name=蓝诺UFO李然', '-c', 'user.email=elon.li@fcdhy.com',
      'commit', '-q', '-m', '隐形账本 v1.0']);
  }
  try { git(['branch', '-M', BRANCH]); } catch (e) {}

  // 用临时 header 推送，token 不写进 .git/config
  const auth = Buffer.from(`x-access-token:${TOKEN}`).toString('base64');
  const pushArgs = [
    '-c', `http.extraheader=AUTHORIZATION: basic ${auth}`,
    'push', `https://github.com/${owner}/${REPO}.git`, `${BRANCH}:${BRANCH}`, '-f', '--quiet'
  ];
  try {
    git(pushArgs);
    console.log('  推送完成');
  } catch (e) {
    console.error('✗ 推送失败，请检查 token 是否具备 Contents: Read and write 权限');
    process.exit(1);
  }

  // 干净的 origin，方便你以后自己 push
  try { git(['remote', 'remove', 'origin'], { stdio: 'pipe' }); } catch (e) {}
  git(['remote', 'add', 'origin', `https://github.com/${owner}/${REPO}.git`]);

  console.log('→ 开启 GitHub Pages …');
  let pagesOk = false;
  for (let i = 0; i < 6; i++) {
    const pages = await api('POST', `/repos/${owner}/${REPO}/pages`,
      { source: { branch: BRANCH, path: '/' } });
    if (pages.status === 201) { pagesOk = true; console.log('  Pages 已开启'); break; }
    if (/already enabled|already exists/i.test(pages.text)) { pagesOk = true; console.log('  Pages 之前已开启'); break; }
    // 分支刚推上去时 GitHub 可能还没索引到，稍等重试
    if (pages.status === 404 || pages.status === 422) {
      await new Promise(r => setTimeout(r, 3000));
      continue;
    }
    console.log(`  Pages 需要手动开启（仓库 Settings → Pages）｜HTTP ${pages.status}: ${pages.text.slice(0, 160)}`);
    break;
  }

  console.log('\n✓ 完成');
  console.log(`  仓库：https://github.com/${owner}/${REPO}`);
  console.log(`  站点：https://${owner.toLowerCase()}.github.io/${REPO}/   （首次生效约 1–2 分钟）`);
  if (!pagesOk) console.log('  若站点 404：Settings → Pages → Source 选 Deploy from a branch → main / (root)');
})().catch(err => {
  console.error('✗ 出错：', err && err.message ? err.message : err);
  process.exit(1);
});
