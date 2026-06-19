const fs = require('fs');

const path = '../SocialMixApp/SocialMixApp/Engine/DJBrain.swift';
let content = fs.readFileSync(path, 'utf8');

const curatedScoringTarget = `                    let popScore = min(100.0, Double(trackRank) / 5000.0)
                    
                    // Genre match bonus: exact genre = +25, compatible = +10
                    let isExactGenre = curated.genre == self.dominantGenre
                    let genreBonus: Double = isExactGenre ? 25.0 : 10.0
                    
                    let composite = 100.0 * self.weightGenre       // Perfect genre match
                                  + 80.0 * self.weightEnergy       // Known danceable
                                  + bpmProximity * self.weightBPM
                                  + popScore * self.weightPopularity
                                  + 0.0 * self.weightSuggestion
                                  + 50.0 * self.weightVariety
                                  + genreBonus                     // Editorial line bonus
                                  + self.continuityBonus(for: curated.genre)  // P11 continuity`;

const curatedScoringReplacement = `                    let popScore = min(100.0, Double(trackRank) / 5000.0)
                    
                    // Genre match bonus: exact genre = +25, compatible = +10
                    let isExactGenre = curated.genre == self.dominantGenre
                    let genreBonus: Double = isExactGenre ? 25.0 : 10.0
                    
                    // ★ Phase 5 — Progressive Ambiance
                    let normKey = self.normalizedTrackKey(title: track.title, artist: track.artist)
                    let candEnergy = Double(self.trackKnowledge[normKey]?.energy ?? 5)
                    let phase = self.sessionPhase
                    let targetEnergy = phase == "early" ? 6.0 : (phase == "mid" ? 8.0 : 7.0)
                    let phaseEnergyBonus = max(0.0, 10.0 - abs(targetEnergy - candEnergy))
                    
                    let candPop = popScore / 10.0
                    var phasePopBonus = 0.0
                    if phase == "early" { phasePopBonus = min(15.0, candPop * 1.5) }
                    else if phase == "mid" { phasePopBonus = min(5.0, candPop * 0.5) }
                    
                    let isUnknown = curated.genre == "Unknown"
                    let isFallback = self.playedKeys.isEmpty
                    let unknownPenalty = (isUnknown && !isFallback) ? -1000000.0 : 0.0
                    
                    let composite = 100.0 * self.weightGenre       // Perfect genre match
                                  + 80.0 * self.weightEnergy       // Known danceable
                                  + bpmProximity * self.weightBPM
                                  + popScore * self.weightPopularity
                                  + 0.0 * self.weightSuggestion
                                  + 50.0 * self.weightVariety
                                  + genreBonus                     // Editorial line bonus
                                  + self.continuityBonus(for: curated.genre)  // P11 continuity
                                  + phaseEnergyBonus
                                  + phasePopBonus
                                  + unknownPenalty`;

content = content.replace(curatedScoringTarget, curatedScoringReplacement);

const curatedReasonsTarget = `                    if finalBPM > 0 { reasons.append("\\(finalBPM) BPM") }
                    reasons.append("playlist")`;

const curatedReasonsReplacement = `                    if finalBPM > 0 { reasons.append("\\(finalBPM) BPM") }
                    if phaseEnergyBonus > 0 { reasons.append(String(format: "E+%.1f", phaseEnergyBonus)) }
                    if phasePopBonus > 0 { reasons.append(String(format: "P+%.1f", phasePopBonus)) }
                    reasons.append("playlist")`;

content = content.replace(curatedReasonsTarget, curatedReasonsReplacement);

const exploreScoringTarget = `                        // ★ P11 — Genre continuity bonus (prefer tracks matching recent genre streak)
                        let candidateGenre = resolvedGenre ?? self.dominantGenre
                        composite += self.continuityBonus(for: candidateGenre)`;

const exploreScoringReplacement = `                        // ★ P11 — Genre continuity bonus (prefer tracks matching recent genre streak)
                        let candidateGenre = resolvedGenre ?? self.dominantGenre
                        composite += self.continuityBonus(for: candidateGenre)
                        
                        // ★ Phase 5 — Progressive Ambiance
                        let normKey = self.normalizedTrackKey(title: track.title, artist: track.artist)
                        let candEnergy = Double(self.trackKnowledge[normKey]?.energy ?? 5)
                        let phase = self.sessionPhase
                        let targetEnergy = phase == "early" ? 6.0 : (phase == "mid" ? 8.0 : 7.0)
                        let phaseEnergyBonus = max(0.0, 10.0 - abs(targetEnergy - candEnergy))
                        
                        let candPop = popScore / 10.0
                        var phasePopBonus = 0.0
                        if phase == "early" { phasePopBonus = min(15.0, candPop * 1.5) }
                        else if phase == "mid" { phasePopBonus = min(5.0, candPop * 0.5) }
                        
                        let isUnknown = candidateGenre == "Unknown"
                        let isFallback = self.playedKeys.isEmpty
                        let unknownPenalty = (isUnknown && !isFallback) ? -1000000.0 : 0.0
                        
                        composite += phaseEnergyBonus + phasePopBonus + unknownPenalty`;

content = content.replace(exploreScoringTarget, exploreScoringReplacement);

const exploreReasonsTarget = `                        if trackRank > 0 { reasons.append("pop:\\(Int(popScore))") }
                        if trackBPM > 0 { reasons.append("\\(trackBPM) BPM") }`;

const exploreReasonsReplacement = `                        if trackRank > 0 { reasons.append("pop:\\(Int(popScore))") }
                        if trackBPM > 0 { reasons.append("\\(trackBPM) BPM") }
                        if phaseEnergyBonus > 0 { reasons.append(String(format: "E+%.1f", phaseEnergyBonus)) }
                        if phasePopBonus > 0 { reasons.append(String(format: "P+%.1f", phasePopBonus)) }`;

content = content.replace(exploreReasonsTarget, exploreReasonsReplacement);

fs.writeFileSync(path, content, 'utf8');

