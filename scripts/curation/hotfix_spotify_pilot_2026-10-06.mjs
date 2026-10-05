// Hotfix Spotify pilot — 5 trackIds résolus via connecteur MCP Anthropic (06/10/2026).
//
// Contexte : pilote 10 tracks closing bangers mondiaux via mcp__Spotify__search(isrc:XXX).
// Résultats bruts : 5/10 match (50%), autres bloqués ALL_CONTENT_LICENSOR_RESTRICTED
// (Disney, Eminem, HUNTR/X, Louise Attaque, ABBA — licensing côté Anthropic MCP).
//
// Verdict : le connecteur MCP n'est PAS viable pour résolution de masse Spotify.
// Il faudra basculer sur Client Credentials direct AhOuai (rate limit strict 30 req/min).
//
// Ce hotfix applique quand même les 5 résultats collectés pour ne pas les perdre.

import mongoose from 'mongoose';
import { connectMongo } from './lib.mjs';

const DRY = process.env.DRY_RUN === '1';

const PILOT_RESULTS = [
  { _id: '6a1db13d391f5e1520fa45cc', spotifyTrackId: '2oAE6v92E9WUEILL0LFQAR', title: 'End of Beginning', artist: 'Djo' },
  { _id: '6a19b864391f5e1520f811fb', spotifyTrackId: '1ydmhnyDOWr5y0s7Vvdw5i', title: "Can't Hold Us", artist: 'Macklemore & Ryan Lewis' },
  { _id: '6a19b86c391f5e1520f81351', spotifyTrackId: '44BdgwXryaVltM1ixhWZoA', title: "J'irai où tu iras", artist: 'Céline Dion & Jean-Jacques Goldman' },
  { _id: '6a19b866391f5e1520f81268', spotifyTrackId: '0vAZAAtJptSeLLP4NUXNY4', title: 'Beat It', artist: 'Michael Jackson' },
  { _id: '6a311e6547123329cd452f8d', spotifyTrackId: '11XIqROIzDGzzAUi0ZqesR', title: 'San Francisco', artist: 'Sound Of Legend' },
];

const db = await connectMongo();
const tracks = db.collection('tracks');
const backup = db.collection('MigrationBackup_SpotifyPilot');

let applied = 0, skipped = 0;

for (const row of PILOT_RESULTS) {
  const _id = new mongoose.Types.ObjectId(row._id);
  const before = await tracks.findOne({ _id }, { projection: { title: 1, artist: 1, 'providers.spotify': 1, spotifyID: 1, isVerified: 1 } });
  if (!before) { console.log(`⚠️  Not found: ${row._id}`); skipped++; continue; }
  if (before.providers?.spotify?.trackId) { console.log(`⏭️  Already has Spotify ID: ${row.title}`); skipped++; continue; }

  if (DRY) {
    console.log(`[DRY] ${row.artist} — ${row.title}  →  spotify=${row.spotifyTrackId}`);
    applied++;
    continue;
  }

  await backup.insertOne({
    _snapshotAt: new Date(),
    _hotfix: 'spotify_pilot_mcp_2026-10-06',
    _originalId: before._id,
    doc: { _id: before._id, title: before.title, artist: before.artist, spotify_before: before.providers?.spotify ?? null },
  });
  await tracks.updateOne({ _id }, { $set: { 'providers.spotify.trackId': row.spotifyTrackId } });
  console.log(`✅ ${row.artist} — ${row.title}  →  spotify=${row.spotifyTrackId}`);
  applied++;
}

console.log(`\nDone. Applied: ${applied}  Skipped: ${skipped}`);
await mongoose.disconnect();
