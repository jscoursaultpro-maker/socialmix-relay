// Sonde : set.energy + set.bpm seuls sur Vangelis (debug du hotfix précédent).
import mongoose from 'mongoose';
import { connectMongo } from './lib.mjs';

const DRY = process.env.DRY_RUN === '1';
const _id = new mongoose.Types.ObjectId('6a311e6747123329cd452fa8');

const db = await connectMongo();
const tracks = db.collection('tracks');

const before = await tracks.findOne({ _id });
console.log('BEFORE:', { energy: before.energy, bpm: before.bpm, phase: before.phase });

if (!DRY) {
  const r = await tracks.updateOne({ _id }, { $set: { energy: 3, bpm: 77 } });
  console.log('updateOne result:', JSON.stringify(r));
  const after = await tracks.findOne({ _id });
  console.log('AFTER :', { energy: after.energy, bpm: after.bpm, phase: after.phase });
}

await mongoose.disconnect();
