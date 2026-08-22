import mongoose from 'mongoose';
import util from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const uri = process.env.MONGODB_URI;
mongoose.connect(uri);

const UserSchema = new mongoose.Schema({}, { strict: false });
const User = mongoose.model('User', UserSchema);

async function verify() {
  const total = await User.countDocuments();
  const migrated = await User.countDocuments({ isMigrated: true });
  
  console.log(`--- VÉRIFICATION POST-MIGRATION ---`);
  console.log(`Total Users: ${total}`);
  console.log(`Migrated Users: ${migrated}`);
  
  const mylena = await User.findOne({ email: 'myl3na@hotmail.fr' }).lean();
  console.log(`\n--- DOCUMENT: myl3na@hotmail.fr ---`);
  console.log(JSON.stringify(mylena, null, 2));
  
  const js = await User.findOne({ email: 'jscoursault@gmail.com' }).lean();
  console.log(`\n--- DOCUMENT: jscoursault@gmail.com ---`);
  console.log(JSON.stringify(js, null, 2));
  
  process.exit(0);
}

verify();
