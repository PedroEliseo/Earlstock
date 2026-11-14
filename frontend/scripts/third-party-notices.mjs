// Writes public/third-party-notices.txt: the licence and notice files of every production
// dependency (the code that can end up in the browser bundle). Run before `dev` and `build`, so the
// file shipped with the app always matches the installed packages. No dependencies.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const tree = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json', '--long'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }),
);
const packages = new Map();
const walk = (deps = {}) => {
  for (const [name, info] of Object.entries(deps)) {
    if (!info.path || packages.has(info.path)) continue;
    packages.set(info.path, { name, version: info.version, license: info.license, dir: info.path });
    walk(info.dependencies);
  }
};
walk(tree.dependencies);

const sections = [...packages.values()]
  .sort((a, b) =>
    a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name),
  )
  .map(({ name, version, license, dir }) => {
    const files = readdirSync(dir)
      .filter((f) => /^(licen[cs]e|notice|copying)(\.|$)/i.test(f))
      .sort();
    const texts = files.map((f) => readFileSync(path.join(dir, f), 'utf8').trim());
    // Notices a package requires but does not ship (kept verbatim in licenses/<name>.NOTICE).
    const extra = path.join('licenses', `${name.replace('/', '__')}.NOTICE`);
    if (existsSync(extra)) texts.unshift(`NOTICE\n${readFileSync(extra, 'utf8').trim()}`);
    return [
      `${name}@${version} (${license ?? 'see package'})`,
      '-'.repeat(72),
      ...(texts.length ? texts : ['(no licence file in the package)']),
    ].join('\n');
  });

const header = `EarlStock frontend: third-party notices

The EarlStock web application includes the following open-source software. Each package's licence
and notice files are reproduced below.
`;
writeFileSync(
  'public/third-party-notices.txt',
  [header, ...sections].join('\n\n' + '='.repeat(72) + '\n\n') + '\n',
);
console.log(`third-party-notices.txt: ${String(sections.length)} packages`);
