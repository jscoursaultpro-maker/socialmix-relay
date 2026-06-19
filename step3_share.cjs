const fs = require('fs');

const path = '../SocialMixApp/SocialMixApp/Views/PartyArchiveView.swift';
let content = fs.readFileSync(path, 'utf8');

const targetBlock = `                            Button(action: downloadSelectedPhotos) {
                                Image(systemName: "arrow.down.to.line")
                                    .font(.system(size: 16, weight: .bold))
                                    .foregroundColor(selectedPhotos.isEmpty ? .textDim : .white)
                                    .padding(12)
                                    .background(selectedPhotos.isEmpty ? Color.surface2 : Color.royalBlue)
                                    .clipShape(Circle())
                            }
                            .disabled(selectedPhotos.isEmpty)
                            
                            Button(action: deleteSelectedPhotos) {`;

const replaceBlock = `                            Button(action: downloadSelectedPhotos) {
                                Image(systemName: "arrow.down.to.line")
                                    .font(.system(size: 16, weight: .bold))
                                    .foregroundColor(selectedPhotos.isEmpty ? .textDim : .white)
                                    .padding(12)
                                    .background(selectedPhotos.isEmpty ? Color.surface2 : Color.royalBlue)
                                    .clipShape(Circle())
                            }
                            .disabled(selectedPhotos.isEmpty)
                            
                            ShareLink(
                                items: Array(selectedPhotos).compactMap { decodeBase64Image($0).map { Image(uiImage: $0) } },
                                subject: Text("Photos de la soirée"),
                                message: Text("Voici les photos de la soirée SocialMix")
                            ) {
                                Image(systemName: "square.and.arrow.up")
                                    .font(.system(size: 16, weight: .bold))
                                    .foregroundColor(selectedPhotos.isEmpty ? .textDim : .white)
                                    .padding(12)
                                    .background(selectedPhotos.isEmpty ? Color.surface2 : Color.accentTurquoise)
                                    .clipShape(Circle())
                            }
                            .disabled(selectedPhotos.isEmpty)
                            
                            Button(action: deleteSelectedPhotos) {`;

content = content.replace(targetBlock, replaceBlock);
fs.writeFileSync(path, content, 'utf8');

