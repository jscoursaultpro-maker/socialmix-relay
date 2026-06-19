const fs = require('fs');
const path = '../SocialMixApp/SocialMixApp/Engine/DJBrain.swift';
let content = fs.readFileSync(path, 'utf8');

// 1. Enum and properties
const propertiesTarget = `    // ★ Phase 5 — DJ Brain Progressive Ambiance
    var sessionStartDate: Date?
    var sessionPhase: String {`;

const propertiesReplacement = `    // ★ Phase 5 — DJ Brain Progressive Ambiance
    enum SessionModeOverride: String, CaseIterable {
        case auto, apero, cool, dance
    }
    
    @Published var sessionModeOverride: SessionModeOverride = .auto {
        didSet {
            print("[DJBrain] 🎼 Mode override → \\(sessionModeOverride) (manual, effectivePhase: \\(effectivePhase))")
        }
    }
    
    var effectivePhase: String {
        switch sessionModeOverride {
        case .auto: return sessionPhase
        case .apero: return "early"
        case .cool: return "mid"
        case .dance: return "late"
        }
    }

    var sessionStartDate: Date?
    var sessionPhase: String {`;

content = content.replace(propertiesTarget, propertiesReplacement);

// 2. computeNextTrack Phase resolution replacements
const computeReplace1Target = `let phase = self.sessionPhase`;
const computeReplace1Replacement = `let phase = self.effectivePhase`;
content = content.replace(computeReplace1Target, computeReplace1Replacement); // for Curated Track scoring

const computeReplace2Target = `let phase = self.sessionPhase`;
content = content.replace(computeReplace2Target, computeReplace1Replacement); // for Explore Track scoring

const sessionPhaseLogTarget = `print("[DJBrain] 🎼 Session phase: \\(sessionPhase) (\\(elapsedMins) min, \\(trackPlayDates.count) tracks)")`;
const sessionPhaseLogReplacement = `print("[DJBrain] 🎼 Session phase: \\(sessionPhase) (\\(elapsedMins) min, \\(trackPlayDates.count) tracks) - Effective: \\(effectivePhase)")`;
content = content.replace(sessionPhaseLogTarget, sessionPhaseLogReplacement);

fs.writeFileSync(path, content, 'utf8');
