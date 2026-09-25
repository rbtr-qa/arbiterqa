#!/usr/bin/env node
/**
 * npx @rbtrqa/cli — install the ArbiterQA skill into your coding agent, and sign in to get
 * an API key.
 *
 *   npx @rbtrqa/cli install      Install the skill into detected agent harnesses
 *   npx @rbtrqa/cli update       Re-install from the latest published skill
 *   npx @rbtrqa/cli login        Browser sign-in; stores an API key locally
 *   npx @rbtrqa/cli status       Who am I
 *   npx @rbtrqa/cli print-key    Emit the stored API key (composable)
 *   npx @rbtrqa/cli logout       Revoke the key and forget it
 *   npx @rbtrqa/cli help         This text
 *
 * NO FLAGS, deliberately. Every command does one thing against production. A login
 * command with options is a login command you have to read the manual for, and the whole
 * promise here is two commands to a working key. Where behaviour genuinely has to vary,
 * it varies by ENVIRONMENT VARIABLE — which is also how an agent can direct where the key
 * lands WITHOUT ever reading the key itself.
 *
 *   ARBITER_API_KEY      use this key; skips login entirely (the CI pattern — GH_TOKEN,
 *                        VERCEL_TOKEN, STRIPE_API_KEY all work this way). Wins over
 *                        anything stored on the machine.
 *   ARBITER_ENV_FILE     write the key here instead of ./.env (relative resolves against
 *                        the cwd; the absolute path is always printed back)
 *   ARBITER_NO_ENV_FILE  do not touch the project at all — machine store only
 *   ARBITER_CONFIG_DIR   relocate hosts.json (else XDG_CONFIG_HOME/arbiter, else
 *                        ~/.config/arbiter)
 *
 * Maintainers only, undocumented in `help`:
 *   ARBITER_API_URL      point at a non-production deployment
 *   ARBITER_NO_BROWSER   never spawn a browser (also implied when stdin is not a TTY)
 *
 * Zero dependencies; Node >= 18.17 (built-in fetch).
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  renameSync,
  cpSync,
  rmSync,
  appendFileSync,
} from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// ── Configuration ────────────────────────────────────────────────────────────
// Production, always, unless a maintainer overrides it by environment variable.
const DEFAULT_API_BASE = 'https://app.arbiterqa.com';
const API_BASE = (process.env.ARBITER_API_URL || DEFAULT_API_BASE).replace(/\/$/, '');

// arbiterqa.kinde.com since 2026-08-10 — looksy.kinde.com is the RETIRED account and
// answers for nothing; a build pointing there fails login even with a valid client id.
const KINDE_DOMAIN = 'https://arbiterqa.kinde.com';

// A PUBLIC client id (no secret — safe to ship: possessing it grants nothing, because the
// flow still requires a human to sign in in a browser). Front-end/SPA app, PKCE.
const CLIENT_ID = '75a19305dcb747ccb8fafff32734417f';

// Fixed callback ports, tried in order. Kinde cannot wildcard a PORT in a redirect URI
// (wildcards are subdomain-only), so each of these is registered on the Kinde app and must
// match BYTE FOR BYTE — `127.0.0.1` here against `localhost` there is a hard 400.
const LOOPBACK_PORTS = [47635, 52447, 58931];
const redirectUriFor = (port) => `http://localhost:${port}/callback`;

/**
 * Where the browser is sent once sign-in succeeds.
 *
 * A hosted page rather than the localhost one, because the localhost listener shuts down
 * seconds later and a refresh then gives "connection refused" — a dead end for the last
 * thing the customer sees. This is the Vercel/Stripe pattern.
 *
 * ⚠ It must be a page that is CORRECT WHILE SIGNED OUT. After this flow the browser holds
 * a Kinde SSO session but no APP session — different cookies — so sending them to `/`
 * would render the visitor marketing page one second after signing in. Spec for the page:
 * docs/plans/2026-08-12-cli-success-page-handoff.md in the app repo.
 *
 * Follows API_BASE rather than the production constant, so a maintainer testing against a
 * pre-release deployment lands on THAT deployment's page instead of production's.
 *
 * ⚠ ORDERING: the app serves its SPA shell for every path (no catch-all route), so on a
 * deployment that predates the page this URL renders BLANK rather than 404ing. The page
 * must be live wherever this points. Status at 2026-08-12: live on staging (a82c716),
 * NOT yet on production (9a17f37) — so production must take that deploy before this
 * package is published. Cosmetic only: the terminal prints the real confirmation and the
 * key either way, but a blank tab reads as failure.
 *
 * Only the SUCCESS branch redirects. Failures keep their local page: a hosted page cannot
 * explain a state mismatch or a cancelled sign-in, and those are exactly the moments the
 * reader needs a specific answer.
 */
const SUCCESS_REDIRECT_URL = `${API_BASE}/cli-success`;

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_SRC = join(PKG_ROOT, 'skills', 'arbiterqa');

/**
 * Where the credential OF RECORD lives. Two files, two jobs, deliberately:
 *   hosts.json  — what the CLI owns (status / print-key / logout / revoke)
 *   ./.env      — a PROJECTION for the project's runtime, because that is where the
 *                 agent already looks. Neither is a copy of the other's job.
 *
 * Precedence mirrors gh's own ordering (GH_CONFIG_DIR → XDG_CONFIG_HOME → HOME). The XDG
 * spec treats an EMPTY value as unset, which is why this tests truthiness rather than
 * `undefined`.
 */
const CONFIG_DIR = process.env.ARBITER_CONFIG_DIR
  ? resolve(process.env.ARBITER_CONFIG_DIR)
  : process.env.XDG_CONFIG_HOME
    ? join(resolve(process.env.XDG_CONFIG_HOME), 'arbiter')
    : join(homedir(), '.config', 'arbiter');
const HOSTS_PATH = join(CONFIG_DIR, 'hosts.json');

/**
 * Where the key is projected for the project. `./.env` by default — NOT `.env.local`,
 * even though framework CLIs (Vercel, Convex, Clerk) prefer that: Next.js deliberately
 * does not load `.env.local` under `NODE_ENV=test`, and a QA tool whose key vanishes
 * during tests is a support ticket nobody diagnoses quickly. `.env` also has the widest
 * reader base (dotenv, dotenvx, Deno, Docker Compose).
 *
 * A relative override resolves against the cwd — `ARBITER_ENV_FILE=.env.local` is the
 * obvious thing to write, and refusing it would be user-hostile. The absolute path is
 * always printed back, so there is never doubt about where the secret landed.
 */
const SKIP_ENV_FILE = Boolean(process.env.ARBITER_NO_ENV_FILE);
const ENV_FILE_PATH = resolve(process.cwd(), process.env.ARBITER_ENV_FILE || '.env');

const argv = process.argv.slice(2);
const COMMAND = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'help';

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

/**
 * Stored credentials, keyed by API host. Keyed rather than flat so a maintainer testing
 * against a pre-release deployment does not clobber their production login.
 */
function readHosts() {
  try {
    return JSON.parse(readFileSync(HOSTS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeHosts(hosts) {
  // Mode at CREATION, then atomic rename. Writing first and chmod'ing after leaves the
  // credential world-readable at the umask default (usually 0644) for the window between
  // the two calls — small, but it is a secret, and 0o700 on the directory is what the XDG
  // spec asks for anyway. The trailing chmod re-asserts 0600 on an existing file, since
  // Node's `mode` only applies when the file is created.
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${HOSTS_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(hosts, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, HOSTS_PATH);
  // Re-assert BOTH modes on every save. Node's `mode` argument applies only when the
  // thing is created, so a directory or file that already existed keeps whatever
  // permissions it had — a config dir created by an older build (or by hand) stays
  // group- and world-readable forever otherwise. Measured: 0775 without this.
  try {
    chmodSync(CONFIG_DIR, 0o700);
    chmodSync(HOSTS_PATH, 0o600);
  } catch {
    /* best effort — Windows and some filesystems have no POSIX mode */
  }
}

/** The repository root containing `dir`, or null. Never throws. */
function gitRootFor(dir) {
  try {
    const out = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() || null;
  } catch {
    return null; // not a repo, or git is not installed
  }
}

/** Ask git itself, rather than pattern-matching .gitignore by hand. */
function gitSays(root, args) {
  try {
    execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Write the key where the project's tooling already looks: `ARBITER_API_KEY` in `./.env`.
 *
 * The skill is installed per project (`.claude/skills/…`), so the credential belongs to
 * the project too — and every agent harness and dotenv loader already reads `.env`, so
 * nothing has to be taught where to find it.
 *
 * ⚠ THIS FILE IS THE CUSTOMER'S, AND IT HOLDS THEIR OTHER SECRETS. Two rules, both
 * load-bearing:
 *   1. NEVER rewrite it. Exactly one line changes — an existing `ARBITER_API_KEY=` is
 *      replaced in place, or ours is appended at the end. Every other byte (their keys,
 *      comments, blank lines, ordering) is carried through untouched.
 *   2. Write ATOMICALLY — temp file, then rename. A half-written `.env` from a crash or a
 *      full disk would destroy credentials we did not create, and rename() cannot leave
 *      the file partially written.
 */
function writeKeyToEnv(apiKey, meta) {
  // ENV_FILE_PATH already resolved ARBITER_ENV_FILE against the cwd. Recomputing the
  // path here is how the override silently became dead code the first time.
  const envPath = ENV_FILE_PATH;
  const line = `ARBITER_API_KEY=${apiKey}`;
  const original = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  let content;

  if (/^ARBITER_API_KEY=.*$/m.test(original)) {
    content = original.replace(/^ARBITER_API_KEY=.*$/m, line);
  } else {
    const base = original && !original.endsWith('\n') ? original + '\n' : original;
    const who = [meta.email, meta.orgName || meta.orgCode].filter(Boolean).join(' · ');
    content = `${base}${base ? '\n' : ''}# ArbiterQA${who ? ` — ${who}` : ''}\n${line}\n`;
  }

  // Refuse rather than shrink: if the result is somehow smaller than what we read, the
  // edit went wrong and writing it would delete the customer's secrets.
  if (original && content.length < original.length) {
    fail(`Refusing to write ${envPath} — the edit would have removed existing content.`);
  }

  const tmpPath = `${envPath}.arbiterqa-tmp`;
  writeFileSync(tmpPath, content);
  try {
    chmodSync(tmpPath, 0o600);
  } catch {
    /* best effort — Windows and some filesystems have no POSIX mode */
  }
  renameSync(tmpPath, envPath); // atomic on POSIX: readers see old or new, never partial
  return envPath;
}

/**
 * Make sure `.env` cannot be committed.
 *
 * A live API key sitting in a tracked file is one `git add -A` from being published to a
 * repository, and that is the single most common way credentials leak. Writing the key
 * into the project is only safe if this holds, so it runs on every login, not just the
 * first. Returns what it did so the caller can say so out loud.
 */
function ensureEnvIgnored(envPath) {
  // Ask GIT where the repo is. Testing for a `.git` directory in the cwd is wrong the
  // moment you run this from `repo/packages/web`: it reports "not a repository" while
  // standing inside one, and leaves the key unignored.
  const root = gitRootFor(dirname(envPath));
  if (!root) return { state: 'not-a-repo' };

  const rel = relative(root, envPath);
  if (rel.startsWith('..')) return { state: 'outside-repo' };

  // Already TRACKED beats already-ignored: "files already tracked by Git are not affected"
  // by .gitignore, so adding a line would change nothing while we told the user it did.
  if (gitSays(root, ['ls-files', '--error-unmatch', rel])) return { state: 'tracked', rel };

  // Let git answer the coverage question — it understands nested .gitignore files,
  // negations and precedence, none of which a hand-rolled pattern list gets right.
  if (gitSays(root, ['check-ignore', '-q', rel])) return { state: 'already-ignored', rel };

  const gitignorePath = join(root, '.gitignore');
  const current = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
  const next = (current && !current.endsWith('\n') ? current + '\n' : current) + `${rel}\n`;
  try {
    writeFileSync(gitignorePath, next);
    return { state: 'added', rel };
  } catch {
    return { state: 'failed', rel };
  }
}

/**
 * Remove our line (and only ours) from the env file on logout.
 *
 * Without this, `logout` revokes the key server-side and leaves `ARBITER_API_KEY=` sitting
 * in `.env` — so the agent keeps presenting a dead credential and gets 401s nobody can
 * explain. The `# ArbiterQA` marker written on insert is what identifies our block; every
 * other line is carried through untouched, same rules as the write.
 */
function removeKeyFromEnv(envPath) {
  if (!existsSync(envPath)) return false;
  const original = readFileSync(envPath, 'utf8');
  if (!/^ARBITER_API_KEY=/m.test(original)) return false;

  const kept = [];
  for (const line of original.split('\n')) {
    if (/^ARBITER_API_KEY=/.test(line)) {
      // Drop the provenance comment we wrote directly above it, and the blank line that
      // separated our block from theirs — but never a line we did not author.
      while (kept.length && /^# ArbiterQA/.test(kept[kept.length - 1])) kept.pop();
      while (kept.length > 1 && kept[kept.length - 1] === '' && kept[kept.length - 2] === '') kept.pop();
      continue;
    }
    kept.push(line);
  }

  const tmp = `${envPath}.arbiterqa-tmp`;
  writeFileSync(tmp, kept.join('\n'), { mode: 0o600 });
  renameSync(tmp, envPath);
  return true;
}

/**
 * Best-effort browser open. Returns whether it tried; the URL is printed either way.
 *
 * ⚠ Deliberately INERT with no interactive terminal, or when ARBITER_NO_BROWSER is set. A
 * CLI that opens a browser as an unconditional side effect is hostile to scripts, CI and
 * test harnesses — not hypothetical: an automated review of this file once ran `login`
 * repeatedly and buried a maintainer's desktop in tabs.
 *
 * Windows: `start` is a cmd.exe BUILTIN, not an executable, so it must go through the
 * shell — spawning it directly fails with ENOENT.
 */
function openBrowser(url) {
  if (process.env.ARBITER_NO_BROWSER || !process.stdin.isTTY) return false;

  let child;
  try {
    if (process.platform === 'win32') {
      // ⚠ Windows needs BOTH tricks, and each fixes a different failure:
      //   `start` is a cmd.exe BUILTIN, so it must run through cmd (spawning it directly
      //   is ENOENT); the URL must be QUOTED or cmd treats `&` as a command separator and
      //   truncates the authorize URL at the first parameter; the empty "" is start's
      //   window-title argument, without which the quoted URL is consumed as the title;
      //   and windowsVerbatimArguments stops libuv re-escaping the quotes we just added
      //   (it would otherwise turn `""` into `\"\"`, which cmd reads as a literal title).
      child = spawn('cmd.exe', ['/c', `start "" "${url}"`], {
        stdio: 'ignore',
        detached: true,
        windowsVerbatimArguments: true,
      });
    } else {
      const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
      child = spawn(opener, [url], { stdio: 'ignore', detached: true });
    }
  } catch {
    return false; // the URL is printed regardless
  }

  // ⚠ A missing opener does NOT throw — spawn reports ENOENT by emitting an async 'error'
  // event, and a ChildProcess with no listener for it takes the whole process down with an
  // uncaught exception. Without this line, `login` on any Linux box without xdg-utils
  // (SSH boxes, slim containers, Alpine) printed the URL and then died before the callback
  // listener could ever receive the code.
  child.on('error', () => {});
  child.unref();
  return true;
}

// ── install / update ─────────────────────────────────────────────────────────
// Harnesses that support directory-based skills get the full skill folder.
// Anything else (or nothing detected) gets a pointer section in AGENTS.md.
const SKILL_TARGETS = [
  { dir: '.claude', dest: join('.claude', 'skills', 'arbiterqa'), name: 'Claude Code' },
  { dir: '.cursor', dest: join('.cursor', 'skills', 'arbiterqa'), name: 'Cursor' },
  { dir: '.agents', dest: join('.agents', 'skills', 'arbiterqa'), name: 'Codex CLI' },
  { dir: '.gemini', dest: join('.gemini', 'skills', 'arbiterqa'), name: 'Gemini CLI' },
];

const AGENTS_MD_MARKER = '<!-- arbiterqa:begin -->';
const AGENTS_MD_END = '<!-- arbiterqa:end -->';

function agentsMdSection() {
  const skill = readFileSync(join(SKILL_SRC, 'SKILL.md'), 'utf8')
    // strip frontmatter for inline embedding
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    // drop the skill's own H1 and demote remaining headings under our ## section
    .replace(/^# ArbiterQA\n/m, '')
    .replace(/^##(#*) /gm, '###$1 ');
  return `${AGENTS_MD_MARKER}\n## ArbiterQA\n${skill}\n${AGENTS_MD_END}\n`;
}

/** Canonical MCP endpoint — always production unless a maintainer overrides the API host. */
function mcpEndpointUrl() {
  // API_BASE historically pointed at the app host for device-flow pages; the MCP
  // protocol lives on the API host. When ARBITER_API_URL is set to a full API
  // origin (…/ or host that already serves /mcp), use it; otherwise production API.
  if (process.env.ARBITER_API_URL) {
    return `${API_BASE}/mcp`;
  }
  return 'https://api.arbiterqa.com/mcp';
}

const MCP_JSON_MARKER = 'arbiterqa';

/**
 * Merge (or create) `.cursor/mcp.json` with the ArbiterQA remote server entry.
 * Never deletes other servers. Idempotent on update.
 */
function installCursorMcpEntry(cwd) {
  const cursorDir = join(cwd, '.cursor');
  if (!existsSync(cursorDir)) return false;

  const mcpPath = join(cursorDir, 'mcp.json');
  let doc = { mcpServers: {} };
  if (existsSync(mcpPath)) {
    try {
      const parsed = JSON.parse(readFileSync(mcpPath, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        doc = parsed;
        if (!doc.mcpServers || typeof doc.mcpServers !== 'object') {
          doc.mcpServers = {};
        }
      }
    } catch {
      console.error('⚠ .cursor/mcp.json exists but is not valid JSON — leaving it alone.');
      return false;
    }
  }

  doc.mcpServers[MCP_JSON_MARKER] = {
    url: mcpEndpointUrl(),
    headers: {
      Authorization: 'Bearer ${ARBITER_API_KEY}',
    },
  };

  mkdirSync(cursorDir, { recursive: true });
  writeFileSync(mcpPath, `${JSON.stringify(doc, null, 2)}\n`);
  console.error(`✓ Cursor MCP: .cursor/mcp.json → ${mcpEndpointUrl()}`);
  console.error('  Set ARBITER_API_KEY (npx @rbtrqa/cli print-key) or paste the key into the header.');
  return true;
}

function installSkill({ update = false } = {}) {
  if (!existsSync(SKILL_SRC)) fail('Skill files missing from package (broken install?)');
  const cwd = process.cwd();
  const found = SKILL_TARGETS.filter((t) => existsSync(join(cwd, t.dir)));
  let installed = 0;

  for (const target of found) {
    const dest = join(cwd, target.dest);
    rmSync(dest, { recursive: true, force: true }); // our managed dir — safe to replace
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(SKILL_SRC, dest, { recursive: true });
    console.error(`✓ ${target.name}: ${target.dest}`);
    installed++;
  }

  if (installCursorMcpEntry(cwd)) {
    installed++;
  }

  const agentsMd = join(cwd, 'AGENTS.md');
  if (existsSync(agentsMd)) {
    const current = readFileSync(agentsMd, 'utf8');
    const section = agentsMdSection();
    if (current.includes(AGENTS_MD_MARKER)) {
      const next = current.replace(
        new RegExp(`${AGENTS_MD_MARKER}[\\s\\S]*?${AGENTS_MD_END}\\n?`),
        section
      );
      if (next !== current) writeFileSync(agentsMd, next);
      console.error(`✓ AGENTS.md: refreshed ArbiterQA section`);
    } else if (installed === 0) {
      appendFileSync(agentsMd, `\n${section}`);
      console.error(`✓ AGENTS.md: appended ArbiterQA section`);
    }
    installed++;
  }

  if (installed === 0) {
    console.error('No agent harness detected (.claude, .cursor, .agents, .gemini, AGENTS.md).');
    console.error('Run from your project root, or create AGENTS.md first.');
    process.exit(1);
  }

  console.error(`\n${update ? 'Updated' : 'Installed'}. Next: npx @rbtrqa/cli login`);
}

// ── command dispatch ─────────────────────────────────────────────────────────
if (COMMAND === 'help' || COMMAND === '--help' || COMMAND === '-h') {
  console.error(`ArbiterQA — agent-native QA for emails and webpages
https://www.arbiterqa.com · MCP https://api.arbiterqa.com/mcp

  npx @rbtrqa/cli install      Install the ArbiterQA skill (+ Cursor MCP entry) into this project
  npx @rbtrqa/cli update       Refresh a previous install
  npx @rbtrqa/cli login        Sign in and store an API key on this machine
  npx @rbtrqa/cli status       Show who you are signed in as
  npx @rbtrqa/cli print-key    Print the stored API key to stdout
  npx @rbtrqa/cli logout       Revoke the key and forget it

login writes ARBITER_API_KEY into ./.env and gitignores it. To change that:
  ARBITER_ENV_FILE=path/to/.env    write it somewhere else
  ARBITER_NO_ENV_FILE=1            don't write into the project at all
  ARBITER_API_KEY=...              already have a key? every command uses it`);
  process.exit(0);
}

if (COMMAND === 'install' || COMMAND === 'update') {
  installSkill({ update: COMMAND === 'update' });
  process.exit(0);
}

if (COMMAND === 'status') {
  // An exported ARBITER_API_KEY is a legitimate way to run this — it is how every CLI in
  // this class works in CI (GH_TOKEN, VERCEL_TOKEN, STRIPE_API_KEY). Reporting "not signed
  // in" while the environment plainly holds a key is just wrong, and it hides the more
  // useful fact: which key is actually in effect.
  if (process.env.ARBITER_API_KEY) {
    console.error('✓ Using the key from ARBITER_API_KEY (environment)');
    console.error(`  It takes precedence over anything stored on this machine.`);
    process.exit(0);
  }
  const cred = readHosts()[API_BASE];
  if (!cred) fail('Not signed in. Run: npx @rbtrqa/cli login');
  console.error(`✓ Signed in as ${cred.email}`);
  if (cred.orgCode) console.error(`  Organization ${cred.orgCode}`);
  console.error(`  Key "${cred.keyName}" (…${String(cred.keyId).slice(-8)}), stored ${cred.createdAt}`);
  if (API_BASE !== DEFAULT_API_BASE) console.error(`  Host ${API_BASE}`);
  process.exit(0);
}

if (COMMAND === 'print-key') {
  // Same precedence as status, and as every consumer of the key: environment first.
  if (process.env.ARBITER_API_KEY) {
    console.log(process.env.ARBITER_API_KEY);
    process.exit(0);
  }
  const cred = readHosts()[API_BASE];
  if (!cred) fail('Not signed in. Run: npx @rbtrqa/cli login');
  console.log(cred.apiKey);
  process.exit(0);
}

if (COMMAND === 'logout') {
  // Always revokes. A key that outlives the logout that was supposed to end it is a
  // credential nobody is tracking — and each `login` mints its own key, so revoking this
  // machine's key never disturbs another machine.
  const hosts = readHosts();
  const cred = hosts[API_BASE];
  if (!cred) fail('Not signed in.');

  let revoked = false;
  try {
    const res = await fetch(`${API_BASE}/api/keys/${encodeURIComponent(cred.keyId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${cred.apiKey}` },
    });
    revoked = res.ok;
  } catch {
    /* reported below — the outcome, not the exception, is what matters */
  }

  // Clear the projection too, from wherever login actually wrote it. A revoked key left
  // in .env is worse than no key: the agent keeps sending it and collects 401s nobody
  // connects back to a logout that happened days ago.
  const wroteTo = cred.envFile || (SKIP_ENV_FILE ? null : ENV_FILE_PATH);
  const cleared = wroteTo ? removeKeyFromEnv(wroteTo) : false;

  delete hosts[API_BASE];
  writeHosts(hosts);
  console.error('✓ Signed out locally');
  if (cleared) console.error(`✓ Removed ARBITER_API_KEY from ${wroteTo}`);

  // ⚠ Never end on a green tick when the key is still live. Forgetting the credential
  // locally discards the only copy of its id, so if revocation failed the id has to be on
  // screen NOW — otherwise someone closes an incident believing a leaked key is dead.
  if (revoked) {
    console.error(`✓ Key "${cred.keyName}" revoked`);
  } else {
    console.error(
      `\n⚠ The key is STILL ACTIVE — revoking it needs a browser.\n` +
        `  Key "${cred.keyName}" (${cred.keyId})\n` +
        `  Revoke it at ${API_BASE}/keys`
    );
  }
  process.exit(revoked ? 0 : 1);
}

if (COMMAND !== 'login') fail(`Unknown command: ${COMMAND} (try: npx @rbtrqa/cli help)`);

// ── login ────────────────────────────────────────────────────────────────────
// Loopback authorization-code + PKCE (RFC 8252 / RFC 7636) — the `gcloud auth login`
// mechanism. It uses the SAME hosted sign-in page as the web app, so an existing customer
// is recognised rather than pushed through new-account registration.
//
// The Kinde access token it produces is then traded at POST /api/device/keys for an
// ArbiterQA API key; the server confirms the token with Kinde's userinfo endpoint and
// provisions the caller's organization if this is their first time.

/** base64url, per RFC 7636 — no padding, URL-safe alphabet. */
function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Constant-time compare for the state parameter; a length mismatch is an early false. */
function safeEquals(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * The page the browser lands on after Kinde hands back the code.
 *
 * ⚠ Deliberately NOT a redirect to app.arbiterqa.com. After this flow the browser holds a
 * Kinde SSO session but no APP session — they are different cookies — so the app's landing
 * route would render the visitor marketing page and the customer would see a signed-out
 * homepage one second after signing in. A hosted success page on the app (the Vercel/Stripe
 * pattern) is the right destination once one exists; until then this page confirms the
 * thing that actually happened and offers the dashboard as a choice rather than a surprise.
 */
function callbackPage(title, message, { link = false } = {}) {
  const cta = link
    ? `<p class="cta"><a href="https://app.arbiterqa.com/">Open ArbiterQA &rarr;</a></p>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>ArbiterQA</title>
<style>
  :root{color-scheme:dark light}
  body{font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
    display:grid;place-items:center;min-height:100vh;margin:0;background:#0f1211;color:#e6ebe8}
  main{text-align:center;max-width:34rem;padding:2rem}
  .mark{width:2.5rem;height:2.5rem;border-radius:.75rem;background:#1e6b4f;margin:0 auto 1.25rem;
    display:grid;place-items:center;color:#e6ebe8;font-weight:700}
  h1{font-size:1.375rem;margin:0 0 .5rem;letter-spacing:-.01em}
  p{margin:0;color:#9fb0a6}
  .cta{margin-top:1.5rem}
  .cta a{display:inline-block;padding:.6rem 1.1rem;border-radius:.5rem;border:1px solid #2c3436;
    color:#7ed2ac;text-decoration:none}
  .cta a:hover,.cta a:focus-visible{border-color:#63c79b;outline:none}
  @media (prefers-color-scheme:light){
    body{background:#faf9f6;color:#20281f}p{color:#5c665c}
    .cta a{border-color:#e3e1d8;color:#1e6b4f}
  }
</style></head>
<body><main><div class="mark">A</div><h1>${title}</h1><p>${message}</p>${cta}</main></body></html>`;
}

/**
 * Bind the first free registered port, on BOTH loopback stacks.
 *
 * Both, because the redirect_uri says `localhost` and which address that resolves to is
 * the machine's business: a browser may try ::1 while Node bound 127.0.0.1 (or the
 * reverse), and then the callback silently never arrives. A host without IPv6 simply fails
 * that half and runs on the other.
 */
async function bindLoopback(handler) {
  for (const port of LOOPBACK_PORTS) {
    const servers = [];
    for (const host of ['127.0.0.1', '::1']) {
      const server = createServer(handler);
      // eslint-disable-next-line no-await-in-loop -- sequential binding is the point
      const ok = await new Promise((resolve) => {
        server.once('error', () => resolve(false));
        server.listen(port, host, () => resolve(true));
      });
      if (ok) servers.push(server);
      else server.close();
    }
    if (servers.length > 0) return { servers, port };
  }
  return null;
}

const existing = readHosts()[API_BASE];
if (existing) {
  console.error(`  Already signed in as ${existing.email} — signing in again mints a new key.`);
}
// Warn, don't refuse. Most dotenv loaders will NOT overwrite a variable already present
// in the environment, so an exported ARBITER_API_KEY silently shadows the fresh key we are
// about to write — login appears to have done nothing at all.
if (process.env.ARBITER_API_KEY) {
  console.error(
    '  ⚠ ARBITER_API_KEY is already set in this shell. It will take precedence over the\n' +
      '    new key until you unset it.'
  );
}
if (API_BASE !== DEFAULT_API_BASE) {
  console.error(`  Host: ${API_BASE}`);
}

const verifier = base64url(randomBytes(32));
const challenge = base64url(createHash('sha256').update(verifier).digest());
const state = base64url(randomBytes(16));

let settle;
const awaited = new Promise((resolve) => {
  settle = resolve;
});

const bound = await bindLoopback((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/callback') {
    res.writeHead(404).end();
    return;
  }
  const params = url.searchParams;
  const respond = (status, title, message) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(callbackPage(title, message));
  };

  if (params.get('error')) {
    respond(400, 'Sign-in cancelled', 'You can close this tab and try again.');
    settle({ error: params.get('error_description') || params.get('error') });
    return;
  }
  // The state check is the CSRF defence: without it, a code supplied by anything else on
  // this machine could be exchanged as though the user had authorised it.
  if (!safeEquals(params.get('state') ?? '', state)) {
    respond(400, 'Sign-in could not be verified', 'That response did not match this request. Close this tab and run login again.');
    settle({ error: 'state mismatch — the callback did not match this sign-in' });
    return;
  }
  const code = params.get('code');
  if (!code) {
    respond(400, 'Sign-in incomplete', 'No authorization code came back. Close this tab and try again.');
    settle({ error: 'no authorization code in the callback' });
    return;
  }
  // Success: hand the browser off to the hosted page. 302 rather than rendering HTML so
  // the customer ends on a live URL they can refresh, not a listener about to close.
  res.writeHead(302, { Location: SUCCESS_REDIRECT_URL });
  res.end();
  settle({ code });
});

if (!bound) {
  fail(
    `Could not open a local sign-in port (tried ${LOOPBACK_PORTS.join(', ')}).\n` +
      '  Close whatever is using them and try again.'
  );
}

const redirectUri = redirectUriFor(bound.port);
const authorizeUrl =
  `${KINDE_DOMAIN}/oauth2/auth?` +
  new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'openid profile email',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

const opened = openBrowser(authorizeUrl);
console.error(
  opened
    ? '\n  Opening your browser to sign in…\n  (if it does not open, visit this URL yourself)\n'
    : '\n  Open this URL in a browser to sign in:\n'
);
console.error(`  ${authorizeUrl}\n`);
console.error('  Waiting for you to finish in the browser…');

// Nothing here outlasts the human: five minutes, then the listener is released.
const timeout = setTimeout(() => settle({ error: 'timed out waiting for the browser' }), 300_000);
const outcome = await awaited;
clearTimeout(timeout);
for (const server of bound.servers) server.close();

if (outcome.error) fail(`Sign-in failed: ${outcome.error}`);

const tokenRes = await fetch(`${KINDE_DOMAIN}/oauth2/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code: outcome.code,
    redirect_uri: redirectUri, // must match the authorize request byte for byte
    code_verifier: verifier,
  }),
});
const token = await tokenRes.json().catch(() => ({}));
if (!tokenRes.ok || !token.access_token) {
  fail(
    `Could not complete sign-in (${tokenRes.status}): ${token.error_description ?? token.error ?? 'no access token'}`
  );
}

// ── trade the Kinde user token for an ArbiterQA API key ──────────────────────
const keyName = `cli-${new Date().toISOString().slice(0, 10)}`;
const exchangeRes = await fetch(`${API_BASE}/api/device/keys`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: keyName }),
});
const exchange = await exchangeRes.json().catch(() => ({}));
if (!exchangeRes.ok || !exchange.apiKey) {
  fail(`Could not create your API key (${exchangeRes.status}): ${exchange.error ?? 'unknown error'}`);
}

// Resolve the org's NAME. The exchange returns `orgName` only on deployments that carry
// that change; against an older one, ask the (read-only) orgs endpoint and match on code,
// so a person sees "Acme" rather than org_3e1b27100ebcd either way. A nicety, never a
// failure: any problem here leaves the code showing and the login intact.
let orgName = exchange.orgName;
if (!orgName && exchange.orgCode) {
  try {
    const orgsRes = await fetch(`${API_BASE}/api/device/orgs`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (orgsRes.ok) {
      const listed = await orgsRes.json();
      orgName = (listed.orgs ?? []).find((o) => o.code === exchange.orgCode)?.name || null;
    }
  } catch {
    /* the code alone is still correct, just less readable */
  }
}

// The key goes in the project's .env (where the agent already looks); the bookkeeping
// (which key id, so `logout` can revoke it) stays in the user-level config.
const envPath = SKIP_ENV_FILE
  ? null
  : writeKeyToEnv(exchange.apiKey, {
      email: exchange.email,
      orgName: exchange.orgName,
      orgCode: exchange.orgCode,
    });
const ignored = envPath ? ensureEnvIgnored(envPath) : { state: 'skipped' };

const hosts = readHosts();
hosts[API_BASE] = {
  apiKey: exchange.apiKey,
  keyId: exchange.keyId ?? '',
  email: exchange.email ?? '',
  orgCode: exchange.orgCode ?? '',
  orgName: orgName ?? '',
  keyName,
  // Remember WHERE the projection went, so logout cleans the same file even if the
  // override was set only for this one invocation.
  envFile: envPath ?? '',
  createdAt: new Date().toISOString(),
};
writeHosts(hosts);

console.error(`\n✓ ${exchange.isNewAccount ? 'Account created' : 'Signed in'} as ${exchange.email}`);
// Name the organization in words. `org_3e1b27100ebcd` is not something a person can check
// against what they see in the dashboard, and a key bound to the wrong workspace is the
// one failure they cannot diagnose — it reads as "my jobs vanished".
const orgLabel = orgName
  ? `${orgName}${exchange.orgCode ? ` (${exchange.orgCode})` : ''}`
  : (exchange.orgCode ?? 'your personal workspace');
console.error(`✓ Key acts on ${orgLabel}`);

if (!envPath) {
  console.error('✓ Stored for this machine only (ARBITER_NO_ENV_FILE is set)');
} else {
  console.error(`✓ ARBITER_API_KEY written to ${envPath}`);
  switch (ignored.state) {
    case 'added':
      console.error(`✓ Added ${ignored.rel} to .gitignore`);
      break;
    case 'already-ignored':
      console.error('✓ Already gitignored');
      break;
    case 'tracked':
      // The loudest case, and the one a naive implementation gets wrong: .gitignore does
      // nothing for a file git already tracks, so the key really is committable right now.
      console.error(
        `\n⚠ ${ignored.rel} is TRACKED BY GIT — your key would be committed.\n` +
          `  Fix it now:  git rm --cached ${ignored.rel} && echo ${ignored.rel} >> .gitignore`
      );
      break;
    case 'outside-repo':
      console.error('  Note: outside the repository — nothing to gitignore');
      break;
    case 'not-a-repo':
      console.error('  Note: not a git repository — keep this file out of version control');
      break;
    default:
      console.error('⚠ Could not update .gitignore — make sure this file is never committed');
  }
}
// The outcome first — that is the sentence the reader came for — then the two commands
// they will actually reach for next.
console.error(`\n  Your agent can use it now.`);
console.error(`\n  Scripts can read it with:  npx @rbtrqa/cli print-key`);
console.error(`  Check anytime with:        npx @rbtrqa/cli status\n`);
