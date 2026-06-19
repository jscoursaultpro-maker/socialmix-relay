const fs = require('fs');

// COCKPIT VIEW
const cockpitPath = '../SocialMixApp/SocialMixApp/Views/CockpitView.swift';
let cockpit = fs.readFileSync(cockpitPath, 'utf8');

const selectorUI = `    private var sessionModeSelector: some View {
        Picker("Ambiance", selection: $djBrain.sessionModeOverride) {
            Text(String(localized: "session.mode.auto", defaultValue: "Auto")).tag(DJBrain.SessionModeOverride.auto)
            Text(String(localized: "session.mode.apero", defaultValue: "🥂 Apéro")).tag(DJBrain.SessionModeOverride.apero)
            Text(String(localized: "session.mode.cool", defaultValue: "🎵 Cool")).tag(DJBrain.SessionModeOverride.cool)
            Text(String(localized: "session.mode.dance", defaultValue: "🔥 Dance")).tag(DJBrain.SessionModeOverride.dance)
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, 4)
        .padding(.vertical, 2)
    }

    @ViewBuilder`;
cockpit = cockpit.replace('    @ViewBuilder', selectorUI);

const mainContentTarget = `            // DJ Mode Toggle — collé au header
            djModeToggle`;
const mainContentReplacement = `            // DJ Mode Toggle — collé au header
            djModeToggle
            
            sessionModeSelector`;
cockpit = cockpit.replace(mainContentTarget, mainContentReplacement);

const onChangeTarget = `        .onChange(of: mix.currentTrack?.id) { _, _ in handleMixTrackChanged() }`;
const onChangeReplacement = `        .onChange(of: djBrain.sessionModeOverride) { _, _ in
            // When mode changes, invalidate auto-queued tracks
            if djMode == .appMix {
                mix.nextTrack = nil
                hostSocket.autoAcceptedSuggestion = nil
                djBrain.autoSuggestNextTrack(
                    genreVotes: genreVotes,
                    vibeScore: Double(vibeScore),
                    consolidatedSuggestions: hostSocket.consolidatedSuggestions
                )
            } else {
                DeezerService.shared.nextTrackOverride = nil
                AppleMusicService.shared.nextTrackOverride = nil
                SpotifyService.shared.nextTrackOverride = nil
            }
        }
        .onChange(of: mix.currentTrack?.id) { _, _ in handleMixTrackChanged() }`;
cockpit = cockpit.replace(onChangeTarget, onChangeReplacement);

fs.writeFileSync(cockpitPath, cockpit, 'utf8');

// JUKEBOX DECK VIEW
const jukePath = '../SocialMixApp/SocialMixApp/Views/JukeboxDeckView.swift';
let juke = fs.readFileSync(jukePath, 'utf8');

const jukeOnChangeTarget = `        .onChange(of: deezer.currentTrack?.id) { _, _ in`;
const jukeOnChangeReplacement = `        .onChange(of: DJBrain.shared.sessionModeOverride) { _, _ in
            if provider.isDeezer {
                nextDeezerTrack = nil
                autoStageFromBrain()
            }
        }
        .onChange(of: deezer.currentTrack?.id) { _, _ in`;
juke = juke.replace(jukeOnChangeTarget, jukeOnChangeReplacement);

fs.writeFileSync(jukePath, juke, 'utf8');

