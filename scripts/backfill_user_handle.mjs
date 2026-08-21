/**
 * scripts/backfill_user_handle.mjs
 * ★ B2.1: Generate profile.handle for all users without one.
 * 
 * Usage:
 *   DRY_RUN=1 node scripts/backfill_user_handle.mjs
 *   DRY_RUN=0 node scripts/backfill_user_handle.mjs
 */
import mongoose from 'mongoose';
import dns from 'dns';
import { readFileSync } from 'fs';
import { generateHandle } from '../utils/slugify.js';

// ─── Config ──────────────────────────────────────────────────────────
const DRY_RUN = process.env.DRY_RUN !== '0';

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
    fallbacks++;
    
    if (!DRY_RUN) {
      await User.updateOne({ _id: user._id }, { $set: { 'profile.handle': fallbackHandle } });
      console.log(`  ✅ ${name} → ${fallbackHandle} (fallback)`);
    } else {
      console.log(`  🔍 ${name} → ${fallbackHandle} (fallback DRY_RUN)`);
    }
    generated++;
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
  console.log('\n💡 To apply: DRY_RUN=0 node scripts/backfill_user_handle.mjs');
}

await mongoose.disconnect();
