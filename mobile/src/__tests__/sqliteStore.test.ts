import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { Snapshot } from '../api/types';
import { createSqliteStore } from '../sync/sqliteStore';
import { createNodeSqlite } from './helpers/nodeSqlite';

const fixtureText = readFileSync(resolve(__dirname, '../../../shared/snapshot.fixture.json'), 'utf8');
const fixture: Snapshot = JSON.parse(fixtureText);

it('round-trips a snapshot with its sync time', async () => {
  const store = await createSqliteStore(createNodeSqlite());
  await store.replaceSnapshot(fixture, 1234);
  expect(await store.readSnapshot()).toEqual({ snapshot: fixture, syncedAt: 1234 });
});

it('replace overwrites the single row', async () => {
  const db = createNodeSqlite();
  const store = await createSqliteStore(db);
  await store.replaceSnapshot(fixture, 1);
  const newer = { ...fixture, watchlist: ['NVDA'] };
  await store.replaceSnapshot(newer, 2);
  expect(await store.readSnapshot()).toEqual({ snapshot: newer, syncedAt: 2 });
  expect(db.raw.prepare('SELECT COUNT(*) AS n FROM snapshot_cache').get()).toEqual({ n: 1 });
});

it('clear makes readSnapshot return null', async () => {
  const store = await createSqliteStore(createNodeSqlite());
  await store.replaceSnapshot(fixture, 1);
  await store.clear();
  expect(await store.readSnapshot()).toBeNull();
});

it('reads a row written by another process with different JSON whitespace', async () => {
  const db = createNodeSqlite();
  const store = await createSqliteStore(db);
  // The Kotlin worker stores the raw HTTP response body, which is not formatted like JSON.stringify output.
  db.raw.prepare('INSERT OR REPLACE INTO snapshot_cache VALUES (1, ?, ?)').run(fixtureText, 987654321);
  expect(await store.readSnapshot()).toEqual({ snapshot: fixture, syncedAt: 987654321 });
});

it('refuses a second row', async () => {
  const db = createNodeSqlite();
  await createSqliteStore(db);
  expect(() => db.raw.prepare("INSERT INTO snapshot_cache VALUES (2, '{}', 1)").run()).toThrow();
});

it.each(['not json', '{}', '[]', 'null'])('a corrupt json column (%p) reads as null instead of throwing', async (bad) => {
  const db = createNodeSqlite();
  const store = await createSqliteStore(db);
  db.raw.prepare('INSERT OR REPLACE INTO snapshot_cache VALUES (1, ?, 1)').run(bad);
  expect(await store.readSnapshot()).toBeNull();
});

it('drops the old relational tables from the previous cache layout', async () => {
  const db = createNodeSqlite();
  db.raw.exec('CREATE TABLE positions (symbol TEXT); CREATE TABLE meta (key TEXT, value TEXT);');
  await createSqliteStore(db);
  const names = (db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name);
  expect(names).toContain('snapshot_cache');
  expect(names).not.toContain('positions');
  expect(names).not.toContain('meta');
});
