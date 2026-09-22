// Generates a seed migration from categories.seed.json.
// Usage: npm run gen:seed  -> writes supabase/migrations/<timestamp>_seed_categories.sql
// Re-run after editing the JSON (uses upserts, so it is safe to apply again).
import { readFileSync, writeFileSync } from 'node:fs';

const seed = JSON.parse(readFileSync(new URL('../../categories.seed.json', import.meta.url), 'utf8'));
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
const arr = (a) => `array[${a.map(q).join(', ')}]::text[]`;
const json = (v) => `${q(JSON.stringify(v))}::jsonb`;

const lines = [`-- Generated from categories.seed.json (taxonomy_version ${seed.taxonomy_version}). Do not edit by hand.`];

for (const k of seed.final_taxonomy) {
  lines.push(`insert into public.final_categories (key, name) values (${q(k)}, ${q(k)}) on conflict (key) do update set name = excluded.name;`);
}
for (const g of seed.groups) {
  lines.push(`insert into public.category_groups (key, name, sort) values (${q(g.key)}, ${q(g.name)}, ${g.sort}) on conflict (key) do update set name = excluded.name, sort = excluded.sort;`);
}
for (const c of seed.categories) {
  lines.push(
    `insert into public.categories (key, group_key, name, summary, final_keys, availability, needs, steps, dos, donts, confused_with, sort) values (` +
      [q(c.key), q(c.group), q(c.name), q(c.summary), arr(c.final_keys), q(c.availability),
       json(c.needs), json(c.steps), json(c.dos), json(c.donts), arr(c.confused_with), c.sort].join(', ') +
      `) on conflict (key) do update set group_key = excluded.group_key, name = excluded.name, summary = excluded.summary, final_keys = excluded.final_keys, availability = excluded.availability, needs = excluded.needs, steps = excluded.steps, dos = excluded.dos, donts = excluded.donts, confused_with = excluded.confused_with, sort = excluded.sort;`,
  );
}

const stamp = process.argv[2] ?? new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const out = new URL(`../migrations/${stamp}_seed_categories.sql`, import.meta.url);
writeFileSync(out, lines.join('\n') + '\n');
console.log('wrote', out.pathname);
