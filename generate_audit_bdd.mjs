import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import Track from './models/Track.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REPORT_PATH = '/Users/Jean-Sebastien/Documents/Claude/Projects/Social M/AUDIT_BDD_2026-06-16.md';

const GENRE_MAP = {
  'deep house':'House','progressive house':'House','tech house':'House',
  'tropical house':'House','future house':'House','tribal house':'House',
  'dance-pop':'Electro','eurodance':'Electro','trance':'Electro',
  'techno':'Electro','electro house':'Electro',
  'hip hop':'Hip-Hop','r&b':'R&B','trap':'Hip-Hop',
  'drum n bass':'Hip-Hop','contemporary r&b':'R&B',
  'funk / soul':'Disco','funk/soul':'Disco','funk':'Disco','nu-disco':'Disco',
  'reggaeton':'Latin','bachata':'Latin','guaracha':'Latin',
  'chanson':'COCOVARIET','variété fr':'COCOVARIET', 'variete fr': 'COCOVARIET', 'variete francaise': 'COCOVARIET', 'chanson fr': 'COCOVARIET', 'varietes francaises': 'COCOVARIET', 'pop fr': 'COCOVARIET',
  'afrobeat':'Afro','afro house':'Afro', 'world': 'Afro',
  'pop rock':'Pop','synth-pop':'Pop','k-pop':'Pop', 'annees 80': 'Pop', '80s': 'Pop',
  'alternative rock':'Rock',
  'ambient':'Chill','jazz':'Jazz', 'chill/lounge': 'Chill', 'chill': 'Chill', 'chillout': 'Chill', 'chill out': 'Chill',
  'reggae':'Latin', 'latino': 'Latin', 'dancehall': 'Reggaeton'
};

function stripDiacritics(str) {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeGenre(g) {
  if (!g) return '';
  const stripped = stripDiacritics(g.trim().toLowerCase());
  return GENRE_MAP[stripped] || g.trim();
}

function normalizePhase(p) {
  if (!p) return null;
  const stripped = stripDiacritics(p.trim().toLowerCase());
  const map = {
    'arrivee': 'arrival', 'arrival': 'arrival',
    'ambiance': 'ambiance',
    'montee': 'takeoff', 'takeoff': 'takeoff',
    'groove': 'groove',
    'apogee': 'party', 'party': 'party',
    'redescente': 'closing', 'closing': 'closing'
  };
  return map[stripped] || p.trim();
}

function normKey(title, artist) {
  return [title, artist].map(s =>
    stripDiacritics((s||'').toLowerCase())
      .replace(/\b(feat\.?|ft\.?|featuring)\b/gi,'')
      .replace(/\([^)]*\)/g,'').replace(/\[[^\]]*\]/g,'')
      .replace(/[^a-z0-9\s]/g,'')
      .replace(/\s+/g,' ').trim()
  ).join('_');
}

async function runAudit() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGO_URI);
  
  console.log("Fetching MongoDB tracks...");
  const mongoTracks = await Track.find().lean();
  
  console.log("Reading iOS JSONs...");
  const editorialSeedPath = path.join(__dirname, '../SocialMixApp/SocialMixApp/Resources/editorial_seed.json');
  const trackMetaPath = path.join(__dirname, '../SocialMixApp/SocialMixApp/Resources/track_metadata.json');
  
  const editorialSeed = JSON.parse(fs.readFileSync(editorialSeedPath, 'utf-8'));
  const trackMetadata = JSON.parse(fs.readFileSync(trackMetaPath, 'utf-8'));
  
  let md = `# AUDIT EXHAUSTIF BDD MUSICALE — Préparation 20 juin\n\n`;
  
  // ==========================================
  // SECTION 1 — VUE D'ENSEMBLE
  // ==========================================
  console.log("Section 1: Vue d'ensemble...");
  const numMongo = mongoTracks.length;
  const numEditorial = editorialSeed.tracks ? editorialSeed.tracks.length : editorialSeed.length;
  const numMeta = Object.keys(trackMetadata).length;
  
  const curatedMap = new Map();
  let step1Filtered = 0;
  let step2Filtered = 0;
  
  // Simulate DJBrain loading
  for (const st of (editorialSeed.tracks || editorialSeed)) {
    const did = st.providers?.deezer?.trackId || st.deezerID || 0;
    if (did <= 0) { step1Filtered++; continue; }
    const g = normalizeGenre(st.genre);
    if (!g || g === 'Unknown') { step2Filtered++; continue; }
    
    curatedMap.set(did, {
      deezerID: did, title: st.title, artist: st.artist, genre: g,
      bpm: st.bpm, energy: st.energy, phase: normalizePhase(st.phase),
      rank: st.deezerRank || 0, danceability: st.danceability || 0,
      isrc: st.isrc || null, source: 'editorial'
    });
  }
  
  for (const [key, t] of Object.entries(trackMetadata)) {
    const did = t.deezerID || 0;
    if (did <= 0) { step1Filtered++; continue; }
    if (curatedMap.has(did)) continue;
    const g = normalizeGenre(t.genre);
    if (!g || g === 'Unknown') { step2Filtered++; continue; }
    
    curatedMap.set(did, {
      deezerID: did, title: t.title, artist: t.artist, genre: g,
      bpm: t.bpm, energy: t.energy, phase: normalizePhase(t.phase),
      rank: t.deezerRank || 0, danceability: t.danceability || 0,
      isrc: t.isrc || null, source: 'metadata'
    });
  }
  
  const numCurated = curatedMap.size;
  
  md += `## SECTION 1 — VUE D'ENSEMBLE\n\n`;
  md += `- **Nombre total de tracks dans MongoDB :** ${numMongo}\n`;
  md += `- **Nombre de tracks dans editorial_seed.json :** ${numEditorial}\n`;
  md += `- **Nombre de tracks dans track_metadata.json :** ${numMeta}\n`;
  md += `- **Couverture iOS effective (Curated) :** ${numCurated}\n`;
  md += `- **Détail du filtrage Curated :**\n`;
  md += `  - Exclues car pas de \`deezerID\` valide : ${step1Filtered}\n`;
  md += `  - Exclues car genre inconnu/vide : ${step2Filtered}\n\n`;
  
  // ==========================================
  // SECTION 2 — DISTRIBUTIONS DE BASE (sur le curated + mongo)
  // ==========================================
  console.log("Section 2: Distributions...");
  
  const curatedArr = Array.from(curatedMap.values());
  const counts = (arr, fn) => {
    const m = {};
    for (const item of arr) {
      const v = fn(item) || 'nil/vide';
      m[v] = (m[v] || 0) + 1;
    }
    return Object.entries(m).sort((a,b)=>b[1]-a[1]);
  };
  
  // Phase
  const phases = counts(curatedArr, t => t.phase);
  const phaseList = phases.map(([p,c])=>`- phase = ${p} : ${c}`).join('\n');
  
  // Genre
  const genres = counts(curatedArr, t => t.genre);
  const genreList = genres.map(([g,c])=>`- ${g} : ${c}`).join('\n');
  const under10Genres = genres.filter(([g,c])=>c<10).map(([g,c])=>g);
  
  // Energy
  const energyBuckets = { '0 ou nil':0, '1-2':0, '3-4':0, '5-6':0, '7-8':0, '9-10':0 };
  for (const t of curatedArr) {
    const e = t.energy || 0;
    if (e===0) energyBuckets['0 ou nil']++;
    else if (e<=2) energyBuckets['1-2']++;
    else if (e<=4) energyBuckets['3-4']++;
    else if (e<=6) energyBuckets['5-6']++;
    else if (e<=8) energyBuckets['7-8']++;
    else energyBuckets['9-10']++;
  }
  
  // BPM
  const bpmBuckets = { '0 ou nil':0, '60-89':0, '90-109':0, '110-129':0, '130-149':0, '150+':0 };
  for (const t of curatedArr) {
    const b = t.bpm || 0;
    if (b===0) bpmBuckets['0 ou nil']++;
    else if (b<90) bpmBuckets['60-89']++;
    else if (b<110) bpmBuckets['90-109']++;
    else if (b<130) bpmBuckets['110-129']++;
    else if (b<150) bpmBuckets['130-149']++;
    else bpmBuckets['150+']++;
  }
  
  // Deezer Rank
  const rankBuckets = { '0 ou nil':0, '1-100k':0, '100k-500k':0, '500k-1M':0, '1M-2M':0, '>2M':0 };
  for (const t of curatedArr) {
    const r = t.rank || 0;
    if (r===0) rankBuckets['0 ou nil']++;
    else if (r<=100000) rankBuckets['1-100k']++;
    else if (r<=500000) rankBuckets['100k-500k']++;
    else if (r<=1000000) rankBuckets['500k-1M']++;
    else if (r<=2000000) rankBuckets['1M-2M']++;
    else rankBuckets['>2M']++;
  }
  
  // Danceability
  let dance0 = 0, danceHigh = 0;
  for (const t of curatedArr) {
    if (!t.danceability || t.danceability===0) dance0++;
    else danceHigh++;
  }
  
  // ISRC / Deezer ID from MONGO
  let isrcYes=0, isrcNo=0;
  let didGt0=0, did0=0, didLt0=0;
  for (const m of mongoTracks) {
    if (m.isrc) isrcYes++; else isrcNo++;
    const did = m.providers?.deezer?.trackId || 0;
    if (did>0) didGt0++;
    else if (did===0) did0++;
    else didLt0++;
  }
  
  md += `## SECTION 2 — DISTRIBUTIONS DE BASE\n\n`;
  md += `### a) PHASE\n${phaseList}\n\n`;
  md += `### b) GENRE\n${genreList}\n- **Genres sous-dotés (<10) :** ${under10Genres.join(', ') || 'Aucun'}\n\n`;
  md += `### c) ENERGY\n`;
  Object.entries(energyBuckets).forEach(([k,v])=> md+=`- energy ${k} : ${v}\n`);
  md += `\n### d) BPM\n`;
  Object.entries(bpmBuckets).forEach(([k,v])=> md+=`- bpm ${k} : ${v}\n`);
  md += `\n### e) DEEZER RANK\n`;
  Object.entries(rankBuckets).forEach(([k,v])=> md+=`- rank ${k} : ${v}\n`);
  md += `\n### f) DANCEABILITY\n- dance=nil/0 : ${dance0}\n- avec score : ${danceHigh}\n\n`;
  md += `### g) ISRC (MongoDB)\n- avec ISRC : ${isrcYes}\n- sans ISRC : ${isrcNo}\n\n`;
  md += `### h) DEEZER ID (MongoDB)\n- deezerID > 0 : ${didGt0}\n- deezerID = 0 : ${did0}\n- deezerID < 0 : ${didLt0}\n\n`;
  
  // ==========================================
  // SECTION 3 — COUVERTURE POUR UNE SOIRÉE 6H
  // ==========================================
  console.log("Section 3: Couverture 6h...");
  const targets = { 'arrival':50, 'ambiance':70, 'takeoff':80, 'groove':100, 'party':120, 'closing':60 };
  const pools = { 'arrival':0, 'ambiance':0, 'takeoff':0, 'groove':0, 'party':0, 'closing':0 };
  
  for (const t of curatedArr) {
    if (t.energy > 0 && t.deezerID > 0) {
      if (t.phase && pools[t.phase] !== undefined) pools[t.phase]++;
    }
  }
  
  md += `## SECTION 3 — COUVERTURE POUR UNE SOIRÉE 6H\n\n`;
  let score = 10;
  for (const [stage, target] of Object.entries(targets)) {
    const p = pools[stage];
    let verdict = '🔴 ROUGE';
    if (p >= target) verdict = '🟢 VERT';
    else if (p >= target/2) { verdict = '🟠 ORANGE'; score -= 0.5; }
    else { score -= 1.5; }
    md += `- **${stage}** : ${p} tracks utilisables (cible : >${target}) -> ${verdict}\n`;
  }
  md += `\n`;
  
  // ==========================================
  // SECTION 4 — ANOMALIES
  // ==========================================
  console.log("Section 4: Anomalies...");
  const anomMeta = [];
  const anomGhost = [];
  const anomDoubles = [];
  const anomOrphans = [];
  const anomGenres = [];
  
  const titlesMap = {};
  
  for (const t of curatedArr) {
    const e = t.energy;
    const b = t.bpm;
    const p = t.phase;
    const g = t.genre;
    
    // Incohérences
    if (p === 'party' && e < 5 && e > 0) anomMeta.push(`${t.title} (party mais E:${e})`);
    if (p === 'arrival' && e > 7) anomMeta.push(`${t.title} (arrival mais E:${e})`);
    if (p === 'closing' && e > 7) anomMeta.push(`${t.title} (closing mais E:${e})`);
    if (g === 'House' && b > 0 && b < 100) anomMeta.push(`${t.title} (House lente ${b} BPM)`);
    if (g === 'Jazz' && b > 140) anomMeta.push(`${t.title} (Jazz rapide ${b} BPM)`);
    
    // Fantomes
    if (!t.title || !t.artist) anomGhost.push(`ID:${t.deezerID} (titre ou artiste vide)`);
    else if (t.title.match(/^Track \d+|Untitled|Mix/i)) anomGhost.push(`${t.title} - ${t.artist}`);
    
    // Doublons
    const k = normKey(t.title, t.artist);
    if (titlesMap[k]) anomDoubles.push(`ID:${t.deezerID} ${t.title} - ${t.artist} (ressemble à ID:${titlesMap[k]})`);
    else titlesMap[k] = t.deezerID;
    
    // Genres suspects
    if (t.genre === 'Chill' && t.energy > 7) anomGenres.push(`${t.title} (Chill mais E:${e})`);
    if (t.genre === 'Classical') anomGenres.push(`${t.title} (Classique)`);
  }
  
  for (const m of mongoTracks) {
    const did = m.providers?.deezer?.trackId || 0;
    const isrc = m.isrc || '';
    const plays = m.performance?.totalPlays || 0;
    const rank = m.deezerRank || 0;
    if (did === 0 && plays === 0 && rank === 0 && !m.providers?.appleMusic) {
      anomOrphans.push(`${m.title} - ${m.artist} [MONGO]`);
    }
  }
  
  md += `## SECTION 4 — ANOMALIES DÉTECTÉES\n\n`;
  md += `### a) INCOHÉRENCES METADATA\n` + (anomMeta.slice(0,20).map(s=>`- ${s}`).join('\n') || '- Aucune') + `\n\n`;
  md += `### b) TRACKS FANTÔMES\n` + (anomGhost.slice(0,20).map(s=>`- ${s}`).join('\n') || '- Aucune') + `\n\n`;
  md += `### c) DOUBLONS PROBABLES\n` + (anomDoubles.slice(0,30).map(s=>`- ${s}`).join('\n') || '- Aucun') + `\n\n`;
  md += `### d) TRACKS ORPHELINES (Candidates suppression)\n` + (anomOrphans.slice(0,20).map(s=>`- ${s}`).join('\n') || '- Aucune') + `\n\n`;
  md += `### e) GENRES SUSPECTS\n` + (anomGenres.slice(0,20).map(s=>`- ${s}`).join('\n') || '- Aucun') + `\n\n`;
  
  score -= (anomMeta.length * 0.1);
  score -= (anomDoubles.length * 0.05);
  
  // ==========================================
  // SECTION 5 — TOP / FLOP par PHASE
  // ==========================================
  console.log("Section 5: Top/Flop...");
  md += `## SECTION 5 — TOP / FLOP par PHASE\n\n`;
  for (const stage of Object.keys(targets)) {
    const tracks = curatedArr.filter(t => t.phase === stage);
    tracks.sort((a,b) => {
      // 0 means no rank -> worst. 1 is best.
      const rA = a.rank > 0 ? a.rank : 9999999;
      const rB = b.rank > 0 ? b.rank : 9999999;
      return rA - rB;
    });
    
    md += `### Phase : ${stage.toUpperCase()}\n`;
    md += `**TOP 10 :**\n`;
    tracks.slice(0, 10).forEach(t => {
      md += `- ${t.title} | ${t.artist} | rank:${t.rank} | E:${t.energy} | ${t.bpm}BPM\n`;
    });
    md += `\n**FLOP 10 :**\n`;
    tracks.reverse().slice(0, 10).forEach(t => {
      md += `- ${t.title} | ${t.artist} | rank:${t.rank} | E:${t.energy} | ${t.bpm}BPM\n`;
    });
    md += `\n`;
  }
  
  // ==========================================
  // SECTION 6 — CROSS-ANALYSE
  // ==========================================
  console.log("Section 6: Cross analyse...");
  md += `## SECTION 6 — CROSS-ANALYSE\n\n`;
  // Matrice Genre x Phase
  md += `### MATRICE GENRE × PHASE\n`;
  md += `| Genre | arrival | ambiance | takeoff | groove | party | closing |\n`;
  md += `|-------|---------|----------|---------|--------|-------|---------|\n`;
  const mainGenres = ['House','Pop','Hip-Hop','Electro','Disco','Chill','Latin','R&B','COCOVARIET','Afro'];
  for (const g of mainGenres) {
    let row = `| **${g}** | `;
    const tr = curatedArr.filter(t=>t.genre===g);
    const mP = { arrival:0, ambiance:0, takeoff:0, groove:0, party:0, closing:0 };
    for (const t of tr) if (mP[t.phase] !== undefined) mP[t.phase]++;
    row += `${mP.arrival} | ${mP.ambiance} | ${mP.takeoff} | ${mP.groove} | ${mP.party} | ${mP.closing} |`;
    md += row + `\n`;
  }
  md += `\n`;
  
  // ==========================================
  // SECTION 7 — KPI NATIFS
  // ==========================================
  console.log("Section 7: KPIs...");
  let playedCount = 0;
  const mongoPlays = [...mongoTracks].filter(t => t.performance?.totalPlays > 0);
  playedCount = mongoPlays.length;
  
  const topFeu = [...mongoTracks].filter(t=>t.performance?.feuRatio>0).sort((a,b)=>b.performance.feuRatio - a.performance.feuRatio).slice(0,10);
  const topPlays = [...mongoTracks].filter(t=>t.performance?.totalPlays>0).sort((a,b)=>b.performance.totalPlays - a.performance.totalPlays).slice(0,10);
  
  md += `## SECTION 7 — STATISTIQUES KPI NATIFS SOCIALMIX\n\n`;
  md += `- **Tracks avec playsTotal > 0 :** ${playedCount}\n\n`;
  md += `**Top 10 par feuRatio :**\n`;
  topFeu.forEach(t => md += `- ${t.title} - ${t.artist} (Feu: ${t.performance.feuRatio.toFixed(2)})\n`);
  md += `\n**Top 10 par playsTotal :**\n`;
  topPlays.forEach(t => md += `- ${t.title} - ${t.artist} (Plays: ${t.performance.totalPlays})\n`);
  md += `\n`;
  
  // ==========================================
  // SECTION 8 & 9 — RECO & VERDICT
  // ==========================================
  console.log("Section 8 & 9: Recos...");
  
  const s = Math.max(0, Math.min(10, score));
  let rec = '';
  if (s > 7) rec = "GO LIVE TEL QUEL";
  else if (s >= 5) rec = "GO LIVE AVEC CLASSIFICATION 1H";
  else rec = "REPORT OU PROBLÈME MAJEUR";
  
  md += `## SECTION 8 — RECOMMANDATIONS ACTIONS\n\n`;
  md += `- **Top Normalisations :** Terminer l'injection des tracks Variété Fr non taguées correctement.\n`;
  md += `- **Top Suppressions :** Purger les ${anomOrphans.length} tracks orphelines MongoDB.\n\n`;
  
  md += `## SECTION 9 — VERDICT GLOBAL\n\n`;
  md += `- **SANTÉ DE LA BDD :** ${s.toFixed(1)} / 10\n`;
  md += `- **RECOMMANDATION POUR LE 20 JUIN :** **${rec}**\n\n`;
  
  fs.writeFileSync(REPORT_PATH, md, 'utf-8');
  console.log(`Report generated successfully at ${REPORT_PATH}`);
  mongoose.disconnect();
}

runAudit().catch(console.error);
