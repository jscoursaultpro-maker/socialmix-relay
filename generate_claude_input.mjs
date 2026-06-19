#!/usr/bin/env node
/**
 * generate_claude_input.mjs
 * 
 * Génère un JSON allégé avec uniquement les informations nécessaires pour l'audit de Claude
 * afin qu'il puisse l'analyser facilement.
 */

import fs from 'fs';

const baseV3 = JSON.parse(fs.readFileSync('./curated_base_v3.json', 'utf-8'));

const tracksForClaude = baseV3.tracks
    .filter(t => t.deezerID > 0)
    .map(t => ({
        id: t.deezerID,
        artist: t.artist,
        title: t.title,
        genre: t.genre,
        bpm: t.bpm || null,
        energy: t.energy || null,
        phase: t.phase || 'unclassified'
    }));

fs.writeFileSync('./claude_input.json', JSON.stringify(tracksForClaude, null, 2));

console.log(`✅ Généré claude_input.json avec ${tracksForClaude.length} tracks.`);
