import { readFile, writeFile } from 'node:fs/promises';

const source = process.argv[2]
  ? await readFile(process.argv[2], 'utf8')
  : await fetch('https://fonts.google.com/metadata/fonts').then((response) => {
      if (!response.ok) throw new Error(`Google Fonts metadata request failed: ${response.status}`);
      return response.text();
    });

const metadata = JSON.parse(source.replace(/^\)\]\}'\s*/, ''));
const families = metadata.familyMetadataList
  .map(({ family, category }) => [family, category])
  .sort(([a], [b]) => a.localeCompare(b));

const output = `/**
 * Generated from https://fonts.google.com/metadata/fonts.
 * Run \`npm run update:google-fonts\` to refresh the catalogue.
 */
export const GOOGLE_FONT_FAMILIES = ${JSON.stringify(families, null, 2)} as const;
`;

await writeFile(new URL('../src/googleFontsCatalog.ts', import.meta.url), output);
console.log(`Wrote ${families.length} Google Font families.`);
