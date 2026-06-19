const fs = require("fs");
let content = fs.readFileSync("server.js", "utf8");

content = content.replace("const did = t.providers?.deezer?.trackId || t.deezerID;", "const did = t._id.toString();");

const old1 = `[
  {
    "deezerID": <int de l'ID fourni>,`;
const new1 = `[
  {
    "id": "<string de l'ID fourni>",`;
content = content.replace(old1, new1);

const old2 = `      const id = Number(up.deezerID || up.id);
      
      const updateData = {`;
const new2 = `      const id = up.id || up.deezerID;
      if (!id) continue;
      
      const updateData = {`;
content = content.replace(old2, new2);

const old3 = `      const t = await Track.findOneAndUpdate(
        { $or: [{ 'providers.deezer.trackId': id }, { deezerID: id }] },
        { $set: updateData }
      );`;
const new3 = `      const t = await Track.findOneAndUpdate(
        { _id: id },
        { $set: updateData }
      );`;
content = content.replace(old3, new3);

fs.writeFileSync("server.js", content);
console.log("Patched server.js successfully.");
