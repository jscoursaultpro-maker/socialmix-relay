const fs = require('fs');

const path = '../SocialMixApp/SocialMixApp/Views/PartyArchiveView.swift';
let content = fs.readFileSync(path, 'utf8');

const targetBlock1 = `                            ShareLink(
                                items: Array(selectedPhotos).compactMap { decodeBase64Image($0).map { Image(uiImage: $0) } },
                                subject: Text("Photos de la soirée"),
                                message: Text("Voici les photos de la soirée SocialMix")
                            ) {`;

const replaceBlock1 = `                            ShareLink(
                                items: shareableImages,
                                subject: Text("Photos de la soirée"),
                                message: Text("Voici les photos de la soirée SocialMix")
                            ) {`;

content = content.replace(targetBlock1, replaceBlock1);

const targetBlock2 = `    private func downloadSelectedPhotos() {`;

const replaceBlock2 = `    private var shareableImages: [Image] {
        var images: [Image] = []
        for urlStr in selectedPhotos {
            if let uiImg = decodeBase64Image(urlStr) {
                images.append(Image(uiImage: uiImg))
            }
        }
        return images
    }
    
    private func downloadSelectedPhotos() {`;

content = content.replace(targetBlock2, replaceBlock2);

fs.writeFileSync(path, content, 'utf8');

