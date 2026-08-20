/**
 * scripts/backfill_user_slug.mjs
 * ★ B2.1: Generate profile.handle for all users without one.
 * 
 * Usage:
 *   DRY_RUN (default):  node scripts/backfill_user_slug.mjs
 *   REAL RUN:           DRY_RUN=false node scripts/backfill_user_slug.mjs
 */
import mongoose from 'mongoose';
import dns from 'dns';
import { readFileSync } from 'fs';

// ─── Config ──────────────────────────────────────────────────────────
const DRY_RUN = process.env.DRY_RUN !== 'false';

// ─── Slugify (inline to avoid import issues with ESM) ────────────────
function generateHandle(name) {
  if (!name || typeof name !== 'string') return '';
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
}

// ─── Connect ─────────────────────────────────────────────────────────
const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const match = env.match(/MONGODB_URI=["']?([^"'\n]+)/);
if (!match) { console.error('❌ MONGODB_URI not found in .env'); process.exit(1); }

dns.setServers(['8.8.8.8', '1.1.1.1']);
await mongoose.connect(match[1]);
console.log(`✅ Connected to MongoDB (DRY_RUN=${DRY_RUN})`);

const User = mongoose.connection.db.collection('users');

// ─── Process ─────────────────────────────────────────────────────────
const usersWithoutHandle = await User.find({
  $or: [
    { 'profile.handle': null },
    { 'profile.handle': { $exists: false } }
  ]
}).toArray();

console.log(`📋 Found ${usersWithoutHandle.length} users without handle`);

let generated = 0;
let conflicts = 0;
let fallbacks = 0;
const results = [];

for (const user of usersWithoutHandle) {
  const name = user.profile?.firstName || user.profile?.lastName || null;
  if (!name) {
    console.log(`  ⚠️ ${user._id}: no name, skipping`);
    continue;
  }
  
  const base = generateHandle(name);
  if (!base) {
    console.log(`  ⚠️ ${user._id}: slugify("${name}") = empty, using fallback`);
    const fallbackHandle = user._id.toString().slice(-8);
    results.push({ id: user._id, name, handle: fallbackHandle, method: 'fallback' });
    fallbacks++;
    continue;
  }
  
  // Check collision
  const existing = await User.findOne({ 'profile.handle': base });
  let handle = base;
  
  if (existing && existing._id.toString() !== user._id.toString()) {
    // Try suffixed versions
    let resolved = false;
    for (let i = 2; i <= 10; i++) {
      const candidate = `${base.slice(0, 27)}-${i}`;
      const exists = await User.findOne({ 'profile.handle': candidate });
      if (!exists || exists._id.toString() === user._id.toString()) {
        handle = candidate;
        resolved = true;
        conflicts++;
        break;
      }
    }
    if (!resolved) {
      handle = `${base.slice(0, 21)}-${user._id.toString().slice(-8)}`;
      fallbacks++;
    }
  }
  
  results.push({ id: user._id, name, handle, method: handle === base ? 'clean' : 'suffixed' });
  
  if (!DRY_RUN) {
    await User.updateOne(
      { _id: user._id },
      { $set: { 'profile.handle': handle } }
    );
    console.log(`  ✅ ${name} → ${handle}`);
  } else {
    console.log(`  🔍 ${name} → ${handle} (DRY_RUN)`);
  }
  
  generated++;
}

// ─── Summary ─────────────────────────────────────────────────────────
console.log('\n════════════════════════════════════════');
console.log(`Mode:              ${DRY_RUN ? '🔍 DRY_RUN' : '✅ REAL RUN'}`);
console.log(`Total processed:   ${usersWithoutHandle.length}`);
console.log(`Handles generated: ${generated}`);
console.log(`Conflicts (suffix):${conflicts}`);
console.log(`Fallbacks (hex):   ${fallbacks}`);
console.log('════════════════════════════════════════');

if (DRY_RUN) {
  console.log('\n💡 To apply: DRY_RUN=false node scripts/backfill_user_slug.mjs');
}

await mongoose.disconnect();
