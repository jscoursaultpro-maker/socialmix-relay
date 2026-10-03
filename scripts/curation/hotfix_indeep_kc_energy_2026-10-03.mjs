// Bump energy=8 sur Indeep + KC Sunshine Band (hymnes disco déjà basculés en party/closing).
import mongoose from 'mongoose';
import { connectMongo } from './lib.mjs';

const DRY = process.env.DRY_RUN === '1';
const IDS = [
  { _id: '6a19b868391f5e1520f812be', label: 'Indeep — Last Night a D.J. Saved My Life' },
  { _id: '6a19b869391f5e1520f812c1', label: 'KC & The Sunshine Band — That\'s the Way (I Like It)' },
];

const db = await connectMongo();
const tracks = db.collection('tracks');
const backup = db.collection('MigrationBackup_CurationAuto');

for (const row of IDS) {
  const _id = new mongoose.Types.ObjectId(row._id);
  const before = await tracks.findOne({ _id });
  console.log(`BEFORE  ${row.label}  | energy=${before.energy}  phase=${before.phase}`);
  if (DRY) continue;
  await backup.insertOne({
    _snapshotAt: new Date(),
    _hotfix: 'indeep_kc_energy_2026-10-03',
    _originalId: before._id,
    doc: before,
  });
  await tracks.updateOne({ _id }, { $set: { energy: 8 } });
  const after = await tracks.findOne({ _id });
  console.log(`AFTER   ${row.label}  | energy=${after.energy}  phase=${after.phase}  ✅`);
}
await mongoose.disconnect();
