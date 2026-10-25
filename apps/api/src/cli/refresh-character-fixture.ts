import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildRoster } from '../database/seeds/stella-source';

const target = resolve(__dirname, '../database/fixtures/stella-sora-roster.json');
async function run(): Promise<void> {
  const previous = existsSync(target)
    ? (JSON.parse(readFileSync(target, 'utf8')) as { source: { commit: string } })
    : undefined;
  const commit = process.argv[2] ?? previous?.source.commit;
  if (!commit || !/^[a-f0-9]{40}$/.test(commit)) throw new Error('Pass a full upstream commit SHA');
  const download = async (file: string) => {
    const response = await fetch(
      `https://raw.githubusercontent.com/AutumnVN/ss-data/${commit}/${file}`,
      { signal: AbortSignal.timeout(30000) },
    );
    if (!response.ok) throw new Error(`Failed to fetch ${file}: HTTP ${response.status}`);
    return response.text();
  };
  const [raw, unreleased] = await Promise.all([
    download('character.json'),
    download('unreleased.json'),
  ]);
  const snapshot = buildRoster(raw, unreleased, commit, new Date().toISOString());
  // Only point at artwork already available in this repository's web preview.
  for (const character of snapshot.characters)
    for (const asset of [character.portraitUrl, character.imageUrl]) {
      if (
        !asset ||
        !existsSync(resolve(__dirname, '../../../../demo-ui/dist', asset.replace(/^\//, '')))
      )
        throw new Error(`Missing reviewed asset for ${character.slug}`);
    }
  writeFileSync(target, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`Saved ${snapshot.characters.length} characters at source commit ${commit}`);
}
void run().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Snapshot refresh failed');
  process.exitCode = 1;
});
