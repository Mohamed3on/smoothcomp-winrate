// Stage the files the manifest loads into dist/ and zip them, after stamping the
// version when one is given: semantic-release runs `bun pack.ts <version>`
// (.releaserc.json). Tests, plans and docs stay out of the zip.
import { $ } from 'bun';

const version = process.argv[2];
if (version) {
  // Touch only the version line, so the release commit is a one-line diff.
  const text = await Bun.file('manifest.json').text();
  await Bun.write('manifest.json', text.replace(/("version":\s*)"[^"]*"/, `$1"${version}"`));
}

const manifest = await Bun.file('manifest.json').json();
const files = new Set<string>([
  'manifest.json',
  ...Object.values<string>(manifest.icons),
  ...manifest.content_scripts.flatMap((script: { js?: string[]; css?: string[] }) => [
    ...(script.js ?? []),
    ...(script.css ?? []),
  ]),
]);

await $`rm -rf dist mat-stats-for-smoothcomp.zip`;
for (const file of files) await Bun.write(`dist/${file}`, Bun.file(file));
await $`zip -qr ../mat-stats-for-smoothcomp.zip .`.cwd('dist');
console.log(`Packed ${files.size} files at ${manifest.version}`);
