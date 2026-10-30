/** Counts exact same-posting skill sets. No résumé or personal data leaves the browser. */
export const STRONG_FIT_LABEL='60%';
export const MIN_SCORED_SKILLS=3;
export const FIT_BANDS=['Under 20%','20–39%','40–59%','60–79%','80%+'];
const STRONG_BAND=3, SECTIONS=['required','preferred','responsibilities'];
export function bitCount(value) {let n=0;while(value){value&=value-1n;n++;}return n;}
const band=(have,scored)=>Math.min(4,Math.floor(have*5/scored));
const decodedSets=new Map();
// Signatures repeat across buckets, so each one is parsed once per vocabulary.
function decoder(ids) {
  const key=ids.join(','); let cache=decodedSets.get(key);
  if(!cache){cache=new Map();decodedSets.set(key,cache);}
  const list=mask=>ids.filter((_,i)=>mask&(1n<<BigInt(i)));
  return signature=>{
    let d=cache.get(signature);
    if(!d){const masks=signature.split('.').map(v=>BigInt('0x'+v)),union=masks.reduce((a,b)=>a|b,0n);d={masks,union,lists:{all:list(union),required:list(masks[0]),preferred:list(masks[1]),responsibilities:list(masks[2])}};cache.set(signature,d);}
    return d;
  };
}
export function analyzeDemand(groups, ids, selected, {section='all',combination=[],minShared=1,general=[]}={}) {
  const bits=new Map(ids.map((id,i)=>[id,1n<<BigInt(i)]));
  const toMask=list=>[...list].reduce((n,id)=>n|(bits.get(id)||0n),0n);
  const selectedMask=toMask(selected), combinationMask=toMask(combination), generalMask=toMask(general);
  const counts=new Map(ids.map(id=>[id,0]));const gaps=new Map(),related=new Map(),gains=new Map(),bundles=new Map(),scoredShares=[];
  let total=0,withSkills=0,any=0,covered=0,all=0,lane=0,scored=0;
  const fit=[0,0,0,0,0];
  const available=groups.every(g=>g.patterns && typeof g.patterns==='object');
  if(!available)return {available:false};
  // Limit bundle exploration to twelve selected axes for predictable browser work.
  const selectedCounts=new Map([...selected].map(id=>[id,groups.reduce((n,g)=>n+(section==='all'?g.skills[id]||0:g.sections[section]?.[id]||0),0)]));
  const bundleIds=[...selected].sort((a,b)=>(selectedCounts.get(b)||0)-(selectedCounts.get(a)||0)||a.localeCompare(b)).slice(0,12);
  const decode=decoder(ids), sectionIndex=SECTIONS.indexOf(section);
  for(const group of groups)for(const [signature,count] of Object.entries(group.patterns)) {
    const decoded=decode(signature), mask=section==='all'?decoded.union:decoded.masks[sectionIndex], present=decoded.lists[section];
    total+=count;if(!mask)continue;withSkills+=count;
    const shared=mask&selectedMask, missing=mask&~selectedMask;
    if(shared)any+=count;
    if(shared && missing===0n)covered+=count;
    if(combinationMask && (mask&combinationMask)===combinationMask)all+=count;
    const sharedEnough=bitCount(shared)>=minShared;
    if(sharedEnough)lane+=count;
    const scoredMask=mask&~generalMask, listed=bitCount(scoredMask), have=bitCount(scoredMask&selectedMask);
    const weak=listed>=MIN_SCORED_SKILLS && band(have,listed)<STRONG_BAND;
    if(listed>=MIN_SCORED_SKILLS){scored+=count;fit[band(have,listed)]+=count;scoredShares.push([have/listed,count]);}
    for(const id of present) {
      counts.set(id,counts.get(id)+count);
      if(sharedEnough && !selected.has(id)) {
        related.set(id,(related.get(id)||0)+count);
        if(missing===bits.get(id))gaps.set(id,(gaps.get(id)||0)+count);
        // A gain is a posting that crosses into a strong match if this one skill is added.
        if(weak && !(generalMask&bits.get(id)) && band(have+1,listed)>=STRONG_BAND)gains.set(id,(gains.get(id)||0)+count);
      }
    }
    const match=bundleIds.filter(id=>mask&bits.get(id));
    for(let a=0;a<match.length;a++)for(let b=a+1;b<match.length;b++) {
      const add=values=>{const key=values.slice().sort().join(',');bundles.set(key,(bundles.get(key)||0)+count);};
      add([match[a],match[b]]);
      for(let c=b+1;c<match.length;c++)add([match[a],match[b],match[c]]);
    }
  }
  let seen=0,median=0;
  for(const [share,count] of scoredShares.sort((a,b)=>a[0]-b[0])){seen+=count;if(seen*2>=scored){median=share;break;}}
  return {available:true,total,withSkills,any,covered,all,lane,counts,bundleIds,
    fit:{bands:fit,scored,strong:fit[3]+fit[4],median},
    bundles:[...bundles].map(([key,count])=>({ids:key.split(','),count})).sort((a,b)=>b.count-a.count||a.ids.join(',').localeCompare(b.ids.join(','))),
    recommendations:[...related].map(([id,count])=>({id,related:count,additional:gaps.get(id)||0,gain:gains.get(id)||0})).sort((a,b)=>b.gain-a.gain||b.related-a.related||a.id.localeCompare(b.id))};
}
/** The classified role with the most postings sharing two or more skills; unclassified titles never win. */
export function inferRole(groups, ids, selected) {
  const decode=decoder(ids), bits=new Map(ids.map((id,i)=>[id,1n<<BigInt(i)]));
  const mask=[...selected].reduce((n,id)=>n|(bits.get(id)||0n),0n), byRole=new Map();
  for(const group of groups) {
    if(group.role==='unknown' || !group.patterns)continue;
    for(const [signature,count] of Object.entries(group.patterns))if(bitCount(decode(signature).union&mask)>=2)byRole.set(group.role,(byRole.get(group.role)||0)+count);
  }
  const [best]=[...byRole].sort((a,b)=>b[1]-a[1]);
  return best && best[1]>=20 ? best[0] : null;
}
