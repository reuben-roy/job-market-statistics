/** Counts exact same-posting skill sets. No résumé or personal data leaves the browser. */
export function bitCount(value) {let n=0;while(value){value&=value-1n;n++;}return n;}
export function analyzeDemand(groups, ids, selected, {section='all',combination=[],minShared=1}={}) {
  const bits=new Map(ids.map((id,i)=>[id,1n<<BigInt(i)]));
  const selectedMask=[...selected].reduce((n,id)=>n|(bits.get(id)||0n),0n);
  const combinationMask=combination.reduce((n,id)=>n|(bits.get(id)||0n),0n);
  const counts=new Map(ids.map(id=>[id,0]));const gaps=new Map(),related=new Map(),bundles=new Map();
  let total=0,withSkills=0,any=0,covered=0,all=0;
  const available=groups.every(g=>g.patterns && typeof g.patterns==='object');
  if(!available)return {available:false};
  // Limit bundle exploration to twelve selected axes for predictable browser work.
  const selectedCounts=new Map([...selected].map(id=>[id,groups.reduce((n,g)=>n+(section==='all'?g.skills[id]||0:g.sections[section]?.[id]||0),0)]));
  const bundleIds=[...selected].sort((a,b)=>(selectedCounts.get(b)||0)-(selectedCounts.get(a)||0)||a.localeCompare(b)).slice(0,12);
  const sectionIndex={required:0,preferred:1,responsibilities:2}[section];
  for(const group of groups)for(const [signature,count] of Object.entries(group.patterns)) {
    const masks=signature.split('.').map(v=>BigInt('0x'+v));
    const mask=section==='all'?masks.reduce((a,b)=>a|b,0n):masks[sectionIndex];
    total+=count;if(!mask)continue;withSkills+=count;
    const shared=mask&selectedMask, missing=mask&~selectedMask;
    if(shared)any+=count;
    if(shared && missing===0n)covered+=count;
    if(combinationMask && (mask&combinationMask)===combinationMask)all+=count;
    const sharedEnough=bitCount(shared)>=minShared;
    for(const id of ids)if(mask&bits.get(id)) {
      counts.set(id,counts.get(id)+count);
      if(sharedEnough && !selected.has(id)) {
        related.set(id,(related.get(id)||0)+count);
        if(missing===bits.get(id))gaps.set(id,(gaps.get(id)||0)+count);
      }
    }
    const match=bundleIds.filter(id=>mask&bits.get(id));
    for(let a=0;a<match.length;a++)for(let b=a+1;b<match.length;b++) {
      const add=values=>{const key=values.slice().sort().join(',');bundles.set(key,(bundles.get(key)||0)+count);};
      add([match[a],match[b]]);
      for(let c=b+1;c<match.length;c++)add([match[a],match[b],match[c]]);
    }
  }
  return {available:true,total,withSkills,any,covered,all,counts,bundleIds,
    bundles:[...bundles].map(([key,count])=>({ids:key.split(','),count})).sort((a,b)=>b.count-a.count||a.ids.join(',').localeCompare(b.ids.join(','))),
    recommendations:[...related].map(([id,count])=>({id,related:count,additional:gaps.get(id)||0})).sort((a,b)=>b.additional-a.additional||b.related-a.related||a.id.localeCompare(b.id))};
}
