import vocabulary from './vocabulary.json' with {type:'json'};
const MAX_BYTES = 5_000_000;
const groupKeys = new Set(['role','country','industry','status','published_on','postings','with_skills','skills','classified','sections','salary']);
const roles = new Set(['engineering','data','design','sales','operations','unknown']);
function validSections(sections, postings) {
  return sections && Object.keys(sections).sort().join(',') === 'preferred,required,responsibilities' && Object.values(sections).every(counts => counts && typeof counts === 'object' && !Array.isArray(counts) && Object.keys(counts).length <= 300 && Object.entries(counts).every(([id,n]) => /^[a-z0-9-]{1,50}$/.test(id) && Number.isSafeInteger(n) && n >= 0 && n <= postings));
}
function validSalary(s, postings) {
  return s && Object.keys(s).sort().join(',') === 'count,max_sum,min_sum' && Number.isSafeInteger(s.count) && s.count >= 0 && s.count <= postings && Number.isSafeInteger(s.min_sum) && Number.isSafeInteger(s.max_sum) && s.min_sum >= 15000*s.count && s.max_sum >= s.min_sum && s.max_sum <= 3000000*s.count;
}
function validCoverage(c) {
  const count=n=>Number.isSafeInteger(n)&&n>=0;
  return c && Object.keys(c).sort().join(',')==='history,platforms' && Array.isArray(c.platforms) && c.platforms.length<=20 && c.platforms.every(p=>p && typeof p==='object' && Object.keys(p).sort().join(',')==='boards,issues,platform,postings' && ['greenhouse','ashby','lever','workday','smartrecruiters'].includes(p.platform)&&[p.boards,p.postings,p.issues].every(count)) && Array.isArray(c.history) && c.history.length<=366 && c.history.every(h=>h && typeof h==='object' && Object.keys(h).sort().join(',')==='boards,date,postings' && /^\d{4}-\d{2}-\d{2}$/.test(h.date)&&count(h.boards)&&count(h.postings));
}
function validPatterns(g, cache) {
  if(!g.patterns || typeof g.patterns!=='object' || Array.isArray(g.patterns) || Object.keys(g.patterns).length>g.postings) return false;
  const singles={}, sections={required:{},preferred:{},responsibilities:{}};
  let total=0,withSkills=0;
  for(const [key,count] of Object.entries(g.patterns)) {
    if(!Number.isSafeInteger(count) || count<=0 || count>g.postings) return false;
    let decoded=cache.get(key);
    if(!decoded) {
      if(!/^[0-9a-f]{1,75}\.[0-9a-f]{1,75}\.[0-9a-f]{1,75}$/.test(key))return false;
      const masks=key.split('.'), lists=[], union=new Set();
      for(const mask of masks){const ids=[];for(let digit=0;digit<mask.length;digit++){const nibble=parseInt(mask[mask.length-1-digit],16);for(let bit=0;bit<4;bit++)if(nibble&(1<<bit)){const index=digit*4+bit;if(index>=vocabulary.skills.length)return false;const id=vocabulary.skills[index].id;ids.push(id);union.add(id);}}lists.push(ids);}
      decoded={lists,ids:[...union]};cache.set(key,decoded);
    }
    total+=count;if(decoded.ids.length)withSkills+=count;
    for(const id of decoded.ids)singles[id]=(singles[id]||0)+count;
    for(let j=0;j<3;j++){const values=sections[['required','preferred','responsibilities'][j]];for(const id of decoded.lists[j])values[id]=(values[id]||0)+count;}
  }
  const same=(a,b)=>a&&b&&Object.keys(a).length===Object.keys(b).length&&Object.entries(a).every(([id,n])=>n===b[id]);
  return total===g.postings && withSkills===g.with_skills && same(singles,g.skills) && Object.entries(sections).every(([section,values])=>same(values,g.sections?.[section]));
}
function validSnapshot(value) {
  if (!value || typeof value !== 'object' || Object.keys(value).filter(k=>k!=='coverage').sort().join(',') !== 'generated_at,groups,schema_version,source,vocabulary_version') return false;
  if(value.schema_version===4 && value.vocabulary_version!==vocabulary.version)return false;
  if (value.coverage && !validCoverage(value.coverage)) return false;
  if (![3,4].includes(value.schema_version) || value.source !== 'collector snapshot' || typeof value.vocabulary_version !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.vocabulary_version) || !Number.isFinite(Date.parse(value.generated_at))) return false;
  if (!Array.isArray(value.groups) || value.groups.length > 15000) return false;
  const patternCache=new Map();
  return value.groups.every(g => g && typeof g === 'object' && Object.keys(g).length === groupKeys.size + (value.schema_version===4?1:0) && Object.keys(g).every(k => groupKeys.has(k) || (value.schema_version===4 && k==='patterns')) && (value.schema_version!==4 || validPatterns(g,patternCache)) && roles.has(g.role) && (g.country === 'unknown' || /^[A-Z]{2}$/.test(g.country)) && g.industry === 'unknown' && ['open','closed'].includes(g.status) && (g.published_on === null || (typeof g.published_on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(g.published_on) && Number.isFinite(Date.parse(g.published_on)))) && Number.isSafeInteger(g.postings) && g.postings >= 0 && Number.isSafeInteger(g.with_skills) && g.with_skills >= 0 && g.with_skills <= g.postings && Number.isSafeInteger(g.classified) && g.classified >= 0 && g.classified <= g.postings && g.with_skills <= g.classified && validSections(g.sections, g.postings) && validSalary(g.salary, g.postings) && g.skills && typeof g.skills === 'object' && !Array.isArray(g.skills) && Object.keys(g.skills).length <= 300 && Object.entries(g.skills).every(([k,n]) => /^[a-z0-9-]{1,50}$/.test(k) && Number.isSafeInteger(n) && n >= 0 && n <= g.postings));
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/snapshot.json' && request.method === 'GET') {
      const snapshot = await env.SNAPSHOTS.get('latest');
      if (snapshot) return new Response(snapshot, {headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff'}});
      return env.ASSETS.fetch(request);
    }
    if (url.pathname === '/internal/refresh' && request.method === 'POST') {
      if (!env.REFRESH_TOKEN) return new Response('Unavailable', {status:503});
      const candidate = request.headers.get('Authorization') || '';
      const encoder = new TextEncoder();
      const [a,b] = await Promise.all([crypto.subtle.digest('SHA-256',encoder.encode(candidate)),crypto.subtle.digest('SHA-256',encoder.encode(`Bearer ${env.REFRESH_TOKEN}`))]);
      if (!crypto.subtle.timingSafeEqual(a,b)) return new Response('Unauthorized',{status:401});
      if (Number(request.headers.get('Content-Length') || 0) > MAX_BYTES || !request.body) return new Response('Too large',{status:413});
      const reader = request.body.getReader(); let size=0; const chunks=[];
      for (;;) { const {done,value}=await reader.read(); if (done) break; size+=value.length; if (size>MAX_BYTES) { await reader.cancel(); return new Response('Too large',{status:413}); } chunks.push(value); }
      const bytes = new Uint8Array(size); let offset=0; for (const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.length; }
      let value; try { value=JSON.parse(new TextDecoder().decode(bytes)); } catch { return new Response('Invalid JSON',{status:400}); }
      if (!validSnapshot(value)) return new Response('Invalid snapshot',{status:400});
      await env.SNAPSHOTS.put('latest', JSON.stringify(value));
      return new Response('Updated',{status:200,headers:{'Cache-Control':'no-store'}});
    }
    return env.ASSETS.fetch(request);
  }
};
export {validSnapshot};
