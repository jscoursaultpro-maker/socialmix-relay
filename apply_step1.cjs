const fs = require('fs');

const path = '../SocialMixApp/SocialMixApp/Engine/DJBrain.swift';
let content = fs.readFileSync(path, 'utf8');

const propertiesInsert = `    var useHybridScoring: Bool = false
    
    // ★ Phase 5 — DJ Brain Progressive Ambiance
    var sessionStartDate: Date?
    var sessionPhase: String {
        guard let start = sessionStartDate else { return "early" }
        let elapsedMins = Date().timeIntervalSince(start) / 60.0
        let trackCount = trackPlayDates.count
        
        if elapsedMins >= 120.0 || trackCount >= 15 {
            return "late"
        } else if elapsedMins >= 30.0 || trackCount >= 5 {
            return "mid"
        } else {
            return "early"
        }
    }`;

content = content.replace('    var useHybridScoring: Bool = false', propertiesInsert);

const computeInsert = `        computeID += 1
        let myComputeID = computeID
        
        if sessionStartDate == nil {
            sessionStartDate = Date()
        }
        if let start = sessionStartDate {
            let elapsedMins = Int(Date().timeIntervalSince(start) / 60.0)
            print("[DJBrain] 🎼 Session phase: \\(sessionPhase) (\\(elapsedMins) min, \\(trackPlayDates.count) tracks)")
        }`;

content = content.replace(`        computeID += 1\n        let myComputeID = computeID`, computeInsert);

const resetInsert = `        energyLevel = 50
        sessionStartDate = nil`;
content = content.replace(`        energyLevel = 50`, resetInsert);

fs.writeFileSync(path, content, 'utf8');
