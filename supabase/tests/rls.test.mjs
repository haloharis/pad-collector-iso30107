// Two-user RLS test against a Supabase project (SPEC section 5).
// Env (root .env): SUPABASE_URL, SUPABASE_ANON_KEY, optional SUPABASE_SERVICE_ROLE_KEY
// (service key is used only for the admin case and cleanup; never ships in the app).
// Requires "Allow anonymous sign-ins" enabled on the project.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;
assert.ok(SUPABASE_URL && SUPABASE_ANON_KEY, 'set SUPABASE_URL and SUPABASE_ANON_KEY in .env');

const newClient = (key = SUPABASE_ANON_KEY) =>
  createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
const service = SUPABASE_SERVICE_ROLE_KEY ? newClient(SUPABASE_SERVICE_ROLE_KEY) : null;

const MP4 = new Uint8Array(2048).fill(7); // fake "video" bytes, size 2048

async function makeUser() {
  const client = newClient();
  const { data, error } = await client.auth.signInAnonymously();
  assert.ifError(error);
  const id = data.user.id;
  const { error: e2 } = await client.from('installs').insert({ id, platform: 'test' });
  assert.ifError(e2);
  return { client, id };
}

const videoRow = (u, over = {}) => {
  const id = randomUUID();
  return {
    id,
    install_id: u.id,
    session_id: randomUUID(),
    storage_path: `${u.id}/${id}.mp4`,
    sha256: 'x'.repeat(64),
    size_bytes: MP4.byteLength,
    source: 'camera',
    contributor_category: 'live_person',
    ...over,
  };
};

let A, B, vA;
const created = [];

before(async () => {
  A = await makeUser();
  B = await makeUser();
  created.push(A.id, B.id);
  vA = videoRow(A);
  const { error } = await A.client.from('videos').insert(vA);
  assert.ifError(error);
});

after(async () => {
  if (!service) return console.warn('no service key: test users/rows left in project');
  for (const id of created) {
    const { data } = await service.storage.from('videos').list(id);
    if (data?.length) await service.storage.from('videos').remove(data.map((o) => `${id}/${o.name}`));
    await service.auth.admin.deleteUser(id); // cascades installs/videos
  }
});

test('catalogs are readable, including by contributors', async () => {
  const { data, error } = await A.client.from('categories').select('key');
  assert.ifError(error);
  assert.equal(data.length, 9);
  const fc = await A.client.from('final_categories').select('key');
  assert.equal(fc.data.length, 11);
});

test('A cannot see B rows (table, my_videos, installs)', async () => {
  const vB = videoRow(B);
  assert.ifError((await B.client.from('videos').insert(vB)).error);
  assert.equal((await A.client.from('my_videos').select('id').eq('id', vB.id)).data.length, 0);
  assert.equal((await A.client.from('videos').select('id')).data.length, 0); // no direct select at all
  assert.equal((await A.client.from('installs').select('id').eq('id', B.id)).data.length, 0);
  const mine = await A.client.from('my_videos').select('id');
  assert.deepEqual(mine.data.map((r) => r.id), [vA.id]);
});

test('A cannot insert a video for B', async () => {
  const { error } = await A.client.from('videos').insert(videoRow(B));
  assert.ok(error, 'expected RLS rejection');
});

test('A cannot set reviewer fields on insert or update', async () => {
  for (const over of [{ final_category: 'real' }, { review_status: 'accepted' }, { reviewer_notes: 'hi' }]) {
    const { error } = await A.client.from('videos').insert(videoRow(A, over));
    assert.ok(error, `insert with ${JSON.stringify(over)} should fail`);
  }
  await A.client.from('videos').update({ final_category: 'real', review_status: 'accepted' }).eq('id', vA.id);
  if (service) {
    const { data } = await service.from('videos').select('final_category, review_status').eq('id', vA.id).single();
    assert.equal(data.final_category, null);
    assert.equal(data.review_status, 'pending');
  }
});

test('A cannot insert as already uploaded or with a bad path/category', async () => {
  assert.ok((await A.client.from('videos').insert(videoRow(A, { upload_status: 'uploaded' }))).error);
  assert.ok((await A.client.from('videos').insert(videoRow(A, { storage_path: `${A.id}/other.mp4` }))).error);
  assert.ok((await A.client.from('videos').insert(videoRow(A, { contributor_category: 'nonsense' }))).error);
  assert.ifError((await A.client.from('videos').insert(videoRow(A, { contributor_category: 'not_sure' }))).error);
});

test('my_videos has no reviewer columns', async () => {
  const { data } = await A.client.from('my_videos').select('*').limit(1);
  const cols = Object.keys(data[0]);
  for (const c of ['final_category', 'review_status', 'reviewer_notes']) assert.ok(!cols.includes(c), c);
});

test('confirm_upload: fails before upload, fails for another user, succeeds after matching upload', async () => {
  let r = await A.client.rpc('confirm_upload', { p_video_id: vA.id });
  assert.ok(r.error, 'no object yet');

  r = await B.client.rpc('confirm_upload', { p_video_id: vA.id });
  assert.ok(r.error, "B must not confirm A's video");

  const up = await A.client.storage.from('videos').upload(vA.storage_path, MP4, { contentType: 'video/mp4' });
  assert.ifError(up.error);

  r = await B.client.rpc('confirm_upload', { p_video_id: vA.id });
  assert.ok(r.error, "B still must not confirm A's video");

  r = await A.client.rpc('confirm_upload', { p_video_id: vA.id });
  assert.ifError(r.error);
  const { data } = await A.client.from('my_videos').select('upload_status, uploaded_at').eq('id', vA.id).single();
  assert.equal(data.upload_status, 'uploaded');
  assert.ok(data.uploaded_at);
});

test('confirm_upload fails on size mismatch', async () => {
  const v = videoRow(A, { size_bytes: 999 });
  assert.ifError((await A.client.from('videos').insert(v)).error);
  assert.ifError((await A.client.storage.from('videos').upload(v.storage_path, MP4, { contentType: 'video/mp4' })).error);
  assert.ok((await A.client.rpc('confirm_upload', { p_video_id: v.id })).error);
});

test('storage: own folder insert only; no read/list; no upload into another folder', async () => {
  const bucket = A.client.storage.from('videos');
  assert.ok((await bucket.upload(`${B.id}/${randomUUID()}.mp4`, MP4, { contentType: 'video/mp4' })).error);
  assert.ok((await bucket.download(vA.storage_path)).error, 'contributor must not download');
  const list = await bucket.list(A.id);
  assert.equal(list.data?.length ?? 0, 0, 'contributor must not list');
  assert.ok((await B.client.storage.from('videos').createSignedUrl(vA.storage_path, 60)).error);
  assert.ok((await bucket.upload(`${A.id}/${randomUUID()}.txt`, 'hi', { contentType: 'text/plain' })).error, 'non-video MIME rejected');
});

test('admin can see all rows and set final_category', { skip: !service }, async () => {
  const email = `admin-${randomUUID()}@example.test`;
  const password = randomUUID();
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(error);
  created.push(data.user.id);
  await service.from('admin_users').insert({ user_id: data.user.id });

  const admin = newClient();
  assert.ifError((await admin.auth.signInWithPassword({ email, password })).error);
  const all = await admin.from('videos').select('id').in('id', [vA.id]);
  assert.equal(all.data.length, 1);
  assert.ifError((await admin.from('videos').update({ final_category: 'real', review_status: 'accepted' }).eq('id', vA.id)).error);
  const signed = await admin.storage.from('videos').createSignedUrl(vA.storage_path, 300);
  assert.ifError(signed.error);
});
