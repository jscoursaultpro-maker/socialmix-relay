import sys

path = "/Users/Jean-Sebastien/App Workshop/Virtual DJ V3/SocialMixApp/SocialMixApp/Engine/DJBrain.swift"

with open(path, 'r') as f:
    content = f.read()

# Replace normalizeTitle logic
content = content.replace(
    '.filter { !$0.isEmpty }\n            .joined(separator: " ")',
    '.filter { !$0.isEmpty }\n            .joined(separator: "")'
)

with open(path, 'w') as f:
    f.write(content)

print("Done")
