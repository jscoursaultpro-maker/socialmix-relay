import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import Party from '../models/Party.js';
import { verifySupabaseJWT } from '../lib/supabaseAuth.js';
import { findOrCreateFromSupabase } from '../services/userService.js';

export function activeRestriction(records, userId, now = Date.now()) {
  return (records || []).find(x => String(x.userId) === String(userId) && (x.kind === 'permanent' || (x.kind === 'temporary' && new Date(x.until).getTime() > now))) || null;
}
export function resolveReportedContent(party, kind, contentId) {
  const list = kind === 'photo' ? party.photos : kind === 'message' ? party.messages : kind === 'song' ? party.suggestions : kind === 'private_message' ? party.privateMessages : [];
  const item = (list || []).find(x => String(x.id || x._id || x.publicId || x.url || '') === String(contentId));
  if (!item || item.deletedAt) return null;
  const authorId = item.authorUserId || item.suggestedByUser?.userId || item.guestId || item.senderId;
  const author = (party.participants || []).find(x => String(x.userId) === String(authorId));
  return author && !author.isHost ? { item, author } : null;
}
export function registerReport(reports, { reporterId, targetId, kind, contentId, reason }, now = Date.now()) {
  // One disputed item creates at most one warning, even when several people flag it.
  if (reports.some(x => x.kind === kind && x.contentId === contentId)) throw new Error('Ce contenu a déjà été signalé.');
  if (reports.filter(x => x.reporterId === reporterId && now - new Date(x.createdAt).getTime() < 600000).length >= 3) throw new Error('Attends quelques minutes avant un nouveau signalement.');
  if (reports.length >= 300) throw new Error('La limite de signalements pour cette soirée est atteinte. Contacte l’organisateur.');
  const number = reports.filter(x => x.targetId === targetId).length + 1;
  const report = { id: randomUUID(), reporterId, targetId, kind, contentId, reason, warningNumber: number, createdAt: new Date(now).toISOString(), status: number >= 2 ? 'needs_review' : 'warned' };
  reports.push(report); return report;
}

export default function communityRouter({ parties, io, buildLightState, PartyModel = Party, verify = verifySupabaseJWT, authenticate = async token => findOrCreateFromSupabase(await verify(token)) }) {
  const router = Router(); const locks = new Map();
  const route = fn => async (req,res) => { try { await fn(req,res); } catch(e) { res.status(e.status || 400).json({error:e.message || 'Action impossible.'}); } };
  async function context(req, hostOnly = false) {
    const p = parties.get(String(req.params.code || '').toUpperCase());
    if (!p || p.endedAt) throw new Error('Cette soirée n’est pas ouverte.');
    const host = req.headers['x-host-secret'] && req.headers['x-host-secret'] === p.hostSecret;
    if (host) return { p, host:true, me:(p.participants || []).find(x=>x.isHost) || {userId:String(p.hostUserId),name:p.hostProfile?.name || 'Organisateur',isHost:true} };
    if (hostOnly) throw Object.assign(new Error('Action réservée à l’organisateur.'),{status:403});
    let me; const auth=req.headers.authorization || '';
    if (auth.startsWith('Bearer ')) {
      try { const user=await authenticate(auth.slice(7)); me=(p.participants || []).find(x=>String(x.userId)===String(user._id)); }
      catch { throw Object.assign(new Error('Reconnecte-toi pour continuer.'),{status:401}); }
    }
    const token=req.headers['x-guest-session'];
    if(!me && token) me=(p.participants || []).find(x=>x.sessionToken && x.sessionToken===token);
    const restrictions = await PartyModel.findOne({code:p.code}).select('communityRestrictions').lean();
    p.communityRestrictions = restrictions?.communityRestrictions || [];
    if(!me || me.departedAt || me.connected===false || activeRestriction(p.communityRestrictions,me.userId)) throw Object.assign(new Error('Tu dois être présent dans cette soirée.'),{status:403});
    return {p,me,host:Boolean(me.isHost)};
  }
  function event(p,person,event,data) { if(person?.id) io.to(person.id).emit(event,data); }
  function broadcast(p) {p.isDirty=true;io.to(`host:${p.code}`).emit('party:state',buildLightState(p,true));io.to(`guest:${p.code}`).emit('party:state',buildLightState(p));}
  async function serial(code,fn) { const previous=locks.get(code)||Promise.resolve();const next=previous.catch(()=>{}).then(fn);locks.set(code,next);try{return await next;}finally{if(locks.get(code)===next)locks.delete(code);} }
  router.get('/:code/community',route(async(req,res)=>{
    const {p,me,host}=await context(req);
    const doc=await PartyModel.findOne({code:p.code}).select('communityReports communityRestrictions privateMessages').lean();
    p.communityReports=doc?.communityReports || [];p.communityRestrictions=doc?.communityRestrictions || [];
    if(!host && activeRestriction(p.communityRestrictions,me.userId)) throw Object.assign(new Error('Ton accès à cette soirée est suspendu.'),{status:403});
    const safe=x=>({userId:String(x.userId),name:x.name,photoURL:x.photo || null,isHost:!!x.isHost,departedAt:x.departedAt || null});
    res.json({me:String(me.userId),people:(p.participants||[]).map(safe),
      warnings:p.communityReports.filter(x=>x.targetId===String(me.userId)).map(x=>({id:x.id,kind:x.kind,warningNumber:x.warningNumber,createdAt:x.createdAt})),
      alerts:host?p.communityReports.filter(x=>x.status==='needs_review').map(x=>({...x,reporterId:undefined})):[],
      restrictions:host?p.communityRestrictions:[],
      messages:(doc?.privateMessages || []).filter(x=>x.senderId===String(me.userId)||x.targetId===String(me.userId))});
  }));
  router.get('/:code/community/touch/:userId',route(async(req,res)=>{
    const {p,me}=await context(req);const uid=req.params.userId;
    const person=(p.participants||[]).find(x=>String(x.userId)===uid&&!x.departedAt);
    if(!person)throw new Error('Cette personne n’est plus présente.');
    const identity=new Set([uid,person.id].filter(Boolean).map(String));if(person.isHost)identity.add('host');
    const author=x=>identity.has(String(x.authorUserId||x.suggestedByUser?.userId||x.guestId||''));
    const doc=await PartyModel.findOne({code:p.code}).select('communityLikes').lean();
    const likes=doc?.communityLikes||[];
    const reaction=(kind,id)=>{const rows=likes.filter(x=>x.kind===kind&&x.contentId===String(id));return {likeCount:rows.length,liked:rows.some(x=>x.userId===String(me.userId))}};
    const votes=Object.assign({},...Array.from(identity).map(id=>p.guestVotes?.[id]||{}));
    const tracks=[...(p.trackHistory||[]),p.currentTrack].filter(Boolean);
    const favorites=Object.entries(votes).filter(([title,vote])=>vote==='fire').map(([title])=>{
      const track=tracks.find(x=>x.title===title||String(x.id)===title)||{};
      return {id:String(track.id||title),title:track.title||title,artist:track.artist||'',fireCount:Object.values(p.guestVotes||{}).filter(v=>v[title]==='fire').length};
    });
    res.json({isOwn:uid===String(me.userId),person:{userId:uid,name:person.name,photoURL:person.photo||null},favorites,
      songs:(p.suggestions||[]).filter(author).map(x=>({id:x.id,title:x.title,artist:x.artist,status:x.status||'pending',boostCount:x.boostCount||0,canBoost:['pending','queued','next'].includes(x.status)&&uid!==String(me.userId)&&!(x.boostedBy||[]).some(id=>[String(me.userId),me.id].includes(String(id)))})),
      messages:(p.messages||[]).filter(author).map(x=>({id:x.id,message:x.message,...reaction('message',x.id)})),
      photos:(p.photos||[]).filter(x=>author(x)&&!x.deletedAt).map(x=>{const id=String(x.id||x._id||x.publicId||x.url);return {id,url:x.url||x.dataURL,caption:x.caption,...reaction('photo',id)}})});
  }));
  router.post('/:code/community/like',route(async(req,res)=>{
    const {p,me}=await context(req);const {kind,contentId,liked}=req.body;
    if(!['photo','message'].includes(kind)||typeof liked!=='boolean')throw new Error('Réaction invalide.');
    const list=kind==='photo'?p.photos:p.messages;
    const item=(list||[]).find(x=>!x.deletedAt&&String(x.id||x._id||x.publicId||x.url)===String(contentId));
    if(!item)throw new Error('Ce contenu n’est plus disponible.');
    const reaction={kind,contentId:String(contentId),userId:String(me.userId)};
    await PartyModel.updateOne({code:p.code},liked?{$addToSet:{communityLikes:reaction}}:{$pull:{communityLikes:reaction}});
    res.json({ok:true,liked});
  }));
  router.get('/:code/community/reportable',route(async(req,res)=>{
    const {p,me}=await context(req);const items=[];
    for(const [kind,list] of [['song',p.suggestions],['message',p.messages],['photo',p.photos]])for(const item of list||[]){
      const id=String(item.id||item._id||item.publicId||item.url||'');const content=resolveReportedContent(p,kind,id);
      if(content&&String(content.author.userId)!==String(me.userId))items.push({id,kind,name:content.author.name,text:item.message||item.caption||item.title||'Photo partagée'});
    }
    res.json({items});
  }));
  // Moderation has its own host-only dossier; never expose private conversations.
  router.get('/:code/community/moderation/:userId',route(async(req,res)=>{
    const {p}=await context(req,true);const uid=req.params.userId;
    const person=(p.participants||[]).find(x=>String(x.userId)===uid&&!x.isHost);
    if(!person)throw new Error('Invité introuvable.');
    const doc=await PartyModel.findOne({code:p.code}).select('communityReports communityRestrictions').lean();
    res.json({person:{userId:uid,name:person.name,photoURL:person.photo||null,departedAt:person.departedAt||null},
      incidents:(doc?.communityReports||[]).filter(x=>x.targetId===uid).map(x=>{
        const item=x.kind==='private_message'?null:resolveReportedContent(p,x.kind,x.contentId)?.item;
        return {id:x.id,kind:x.kind,reason:x.reason,warningNumber:x.warningNumber,status:x.status,
          excerpt:item?.message||item?.caption||item?.title||null,url:x.kind==='photo'?(item?.url||item?.dataURL||null):null};
      }),restriction:activeRestriction(doc?.communityRestrictions,uid)?.kind||null});
  }));
  router.post('/:code/community/report',route(async(req,res)=>{
    const {p,me}=await context(req);const {kind,contentId,reason}=req.body;
    if(!['photo','message','song','private_message'].includes(kind)||!contentId||!['inappropriate','harassment','privacy'].includes(reason))throw new Error('Choisis le contenu et le motif du signalement.');
    if(kind==='private_message'){const doc=await PartyModel.findOne({code:p.code}).select('privateMessages').lean();p.privateMessages=doc?.privateMessages||[];const message=p.privateMessages.find(x=>x.id===String(contentId)&&x.targetId===String(me.userId));if(!message)throw new Error('Ce message ne peut pas être signalé.');}
    const content=resolveReportedContent(p,kind,contentId);
    if(!content || String(content.author.userId)===String(me.userId))throw new Error('Ce contenu ne peut pas être signalé.');
    await serial(p.code,async()=>{
      const doc=await PartyModel.findOne({code:p.code}).select('communityReports').lean();const reports=doc?.communityReports || [];
      const report=registerReport(reports,{reporterId:String(me.userId),targetId:String(content.author.userId),kind,contentId:String(contentId),reason});
      await PartyModel.updateOne({code:p.code},{$push:{communityReports:report}});p.communityReports=reports;
      event(p,content.author,'community:warning',{id:report.id,warningNumber:report.warningNumber,kind,message:report.warningNumber===1?'Un contenu que tu as partagé a été signalé. Veille à respecter les autres invités.':'Un nouveau contenu a été signalé. L’organisateur a été averti.'});
      if(report.warningNumber>=2)io.to(`host:${p.code}`).emit('community:alert',{targetId:report.targetId});
      res.json({ok:true,message:report.warningNumber===1?'Un avertissement privé a été envoyé.':'L’organisateur a été averti.'});
    });
  }));
  router.post('/:code/community/decision',route(async(req,res)=>{
    const {p}=await context(req,true);const {userId,action}=req.body;
    if(!['temporary','permanent','departed','dismiss','restore'].includes(action))throw new Error('Décision invalide.');
    const target=(p.participants||[]).find(x=>String(x.userId)===String(userId)&&!x.isHost);
    if(!target)throw new Error('Invité introuvable.');
    await serial(p.code,async()=>{
      if(action==='dismiss') {
        await PartyModel.updateOne({code:p.code},{$set:{'communityReports.$[r].status':'reviewed'}},{arrayFilters:[{'r.targetId':String(userId),'r.status':'needs_review'}]});
      } else if(action==='restore') {
        await PartyModel.updateOne({code:p.code},{$pull:{communityRestrictions:{userId:String(userId)}}});
        p.communityRestrictions=(p.communityRestrictions||[]).filter(x=>x.userId!==String(userId));
      } else {
        const restriction={userId:String(userId),kind:action,until:action==='temporary'?new Date(Date.now()+900000).toISOString():null,createdAt:new Date().toISOString()};
        const old=await PartyModel.findOne({code:p.code}).select('communityRestrictions').lean();
        p.communityRestrictions=[...(old?.communityRestrictions||[]).filter(x=>x.userId!==String(userId)),restriction];
        target.departedAt=restriction.createdAt;target.connected=false;
        await PartyModel.updateOne({code:p.code},{$set:{communityRestrictions:p.communityRestrictions,'participants.$[g].departedAt':target.departedAt,'participants.$[g].connected':false}},{arrayFilters:[{'g.userId':String(userId)}]});
        event(p,target,'community:excluded',{kind:action,until:restriction.until,message:action==='departed'?'L’organisateur t’a marqué comme parti de la soirée.':action==='temporary'?'Ton accès à cette soirée est suspendu pendant 15 minutes.':'L’organisateur t’a exclu de cette soirée.'});
        const peer=io.sockets.sockets.get(target.id);peer?.leave(`guest:${p.code}`);
      }
      broadcast(p);res.json({ok:true});
    });
  }));
  router.post('/:code/community/message',route(async(req,res)=>{
    const {p,me}=await context(req);const {targetId,text}=req.body;
    const target=(p.participants||[]).find(x=>String(x.userId)===String(targetId)&&!x.departedAt&&x.connected!==false);
    if(!target||String(targetId)===String(me.userId)||typeof text!=='string'||!text.trim()||text.length>1000)throw new Error('Destinataire ou message invalide.');
    await serial(p.code,async()=>{
      const doc=await PartyModel.findOne({code:p.code}).select('privateMessages').lean();const history=doc?.privateMessages||[];
      if(history.length>=500||history.filter(x=>x.senderId===String(me.userId)&&Date.now()-new Date(x.sentAt).getTime()<60000).length>=10)throw new Error('Attends un instant avant d’envoyer un autre message.');
      const msg={id:randomUUID(),senderId:String(me.userId),targetId:String(targetId),text:text.trim(),sentAt:new Date().toISOString()};
      await PartyModel.updateOne({code:p.code},{$push:{privateMessages:msg}});event(p,target,'community:message',{id:msg.id,senderId:msg.senderId});res.json({ok:true,message:msg});
    });
  }));
  return router;
}

// Applied before legacy HTTP routes as well as authenticated party routers.
export function communityAccessGuard({ parties, PartyModel = Party, authenticate = async token => findOrCreateFromSupabase(await verifySupabaseJWT(token)) }) {
  return async (req,res,next) => {
    if(!['POST','PATCH','DELETE'].includes(req.method))return next();
    const code=req.path.split('/')[1]?.toUpperCase();if(!/^[A-Z0-9]{6,10}$/.test(code || ''))return next();
    if(req.path.includes('/community/') || req.path.endsWith('/preparation'))return next();
    const ram=parties.get(code);if(req.headers['x-host-secret'] && ram?.hostSecret===req.headers['x-host-secret'])return next();
    try {
      const auth=req.headers.authorization||'';let id;
      if(auth.startsWith('Bearer '))id=String((await authenticate(auth.slice(7)))._id);
      else {const token=req.headers['x-session-token']||req.headers['x-guest-session'];id=ram?.participants?.find(p=>p.sessionToken && p.sessionToken===token)?.userId || req.body?.guestId;}
      if(!id)return next();
      const doc=await PartyModel.findOne({code}).select('communityRestrictions participants').lean();
      const departed=doc?.participants?.find(p=>String(p.userId)===String(id)&&p.departedAt);
      const joining=/\/(request-join|join-as-user|join)$/.test(req.path);
      if((departed&&!joining)||activeRestriction(doc?.communityRestrictions,id))return res.status(403).json({error:'Ton accès à cette soirée est suspendu. Rejoins-la après autorisation de l’organisateur.'});
      next();
    }catch(e){return res.status(401).json({error:'Impossible de vérifier ton accès. Reconnecte-toi.'});}
  };
}
