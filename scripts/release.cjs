// Builds a new MoviePlex release and publishes it for in-app updates (electron/updater.cjs).
//
//   npm run release                      bumps the patch version (0.1.0 -> 0.1.1)
//   npm run release -- 0.2.0 "Notes"     a specific version, with release notes
//
// Publishing needs package.json "movieplexUpdates.repo" ("owner/name", a public GitHub repo) and a
// GitHub token with access to it in GH_TOKEN. Without a token the files are only built; upload
// them by hand as described at the end.
const { execSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const repo = pkg.movieplexUpdates?.repo ?? '';

const [versionArg, notes = ''] = process.argv.slice(2);
const bump = (v) => v.split('.').map((n, i) => (i === 2 ? +n + 1 : n)).join('.');
const version = versionArg || bump(pkg.version);
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Not a version: ${version}`);
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Set "movieplexUpdates": { "repo": "owner/name" } in package.json first.');

// 1. Version
pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
execSync(`npm version ${version} --no-git-tag-version --allow-same-version`, { cwd: root, stdio: 'ignore' });
console.log(`Building MoviePlex ${version}…`);

// 2. Build
execSync('npm run dist:mac', { cwd: root, stdio: 'inherit' });
const out = path.join(root, 'release');
const zipName = `MoviePlex-${version}-arm64-mac.zip`;
const dmgName = `MoviePlex-${version}-arm64.dmg`;
const zip = fs.readFileSync(path.join(out, zipName));

// 3. Update feed
const tag = `v${version}`;
const feed = {
  version,
  notes,
  date: new Date().toISOString(),
  mac: {
    url: `https://github.com/${repo}/releases/download/${tag}/${zipName}`,
    sha256: crypto.createHash('sha256').update(zip).digest('hex'),
    size: zip.length,
  },
};
fs.writeFileSync(path.join(out, 'update.json'), JSON.stringify(feed, null, 2) + '\n');

// 4. Publish
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!token) {
  console.log(`
Built release/${dmgName}, release/${zipName} and release/update.json.
No GH_TOKEN set, so nothing was published. To publish by hand: on github.com/${repo}, open
Releases > Draft a new release, use the tag ${tag}, attach those three files and publish it.`);
  process.exit(0);
}

const api = async (url, options = {}) => {
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', ...options.headers },
  });
  if (!res.ok) throw new Error(`GitHub: ${res.status} ${await res.text()}`);
  return res.json();
};

(async () => {
  // Draft first so no copy of MoviePlex sees the release before every file is uploaded.
  const release = await api(`https://api.github.com/repos/${repo}/releases`, {
    method: 'POST',
    body: JSON.stringify({ tag_name: tag, name: `MoviePlex ${version}`, body: notes, draft: true }),
  });
  for (const [name, type] of [
    [dmgName, 'application/x-apple-diskimage'],
    [zipName, 'application/zip'],
    ['update.json', 'application/json'],
  ]) {
    console.log(`Uploading ${name}…`);
    await api(`https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': type },
      body: fs.readFileSync(path.join(out, name)),
    });
  }
  const published = await api(`https://api.github.com/repos/${repo}/releases/${release.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ draft: false, make_latest: 'true' }),
  });
  console.log(`Published ${published.html_url}`);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
