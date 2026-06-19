const fs = require('fs');

const path = '../SocialMixApp/SocialMixApp/Views/PartyArchiveView.swift';
let content = fs.readFileSync(path, 'utf8');

const targetBlock1 = `    private var shareableImages: [Image] {
        var images: [Image] = []
        for urlStr in selectedPhotos {
            if let uiImg = decodeBase64Image(urlStr) {
                images.append(Image(uiImage: uiImg))
            }
        }
        return images
    }`;

const replaceBlock1 = `    private var shareableURLs: [URL] {
        var urls: [URL] = []
        for urlStr in selectedPhotos {
            if urlStr.hasPrefix("http"), let remoteURL = URL(string: urlStr) {
                urls.append(remoteURL)
            } else if let uiImg = decodeBase64Image(urlStr), let data = uiImg.jpegData(compressionQuality: 0.8) {
                let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".jpg")
                do {
                    try data.write(to: tempURL)
                    urls.append(tempURL)
                } catch {
                    print("Failed to write image to temp file: \\(error)")
                }
            }
        }
        return urls
    }`;

content = content.replace(targetBlock1, replaceBlock1);

const targetBlock2 = `                            ShareLink(
                                items: shareableImages,
                                subject: Text("Photos de la soirée"),
                                message: Text("Voici les photos de la soirée SocialMix")
                            ) {`;

const replaceBlock2 = `                            ShareLink(
                                items: shareableURLs,
                                subject: Text("Photos de la soirée"),
                                message: Text("Voici les photos de la soirée SocialMix")
                            ) {`;

content = content.replace(targetBlock2, replaceBlock2);

fs.writeFileSync(path, content, 'utf8');

