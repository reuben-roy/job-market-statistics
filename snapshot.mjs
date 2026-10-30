/** Combine disjoint aggregate buckets; date filters exclude unknown publication dates. */
export function matchingGroups(snapshot, filters) {
  return snapshot.groups.filter(g => (filters.role === 'all' || g.role === filters.role) && (filters.country === 'all' || g.country === filters.country) && (filters.industry === 'all' || g.industry === filters.industry) && (filters.status === 'all' || g.status === filters.status) && (!filters.from || (g.published_on && g.published_on >= filters.from)) && (!filters.to || (g.published_on && g.published_on <= filters.to)));
}
export function filterSnapshot(snapshot, vocabulary, filters) {
  const groups = matchingGroups(snapshot, filters);
  const counts = new Map();
  for (const group of groups) for (const [id, count] of Object.entries(group.skills)) counts.set(id, (counts.get(id) || 0) + count);
  const skills = vocabulary.skills.map(s => ({id:s.id, label:s.label, postings:counts.get(s.id) || 0})).sort((a,b) => b.postings-a.postings || a.label.localeCompare(b.label));
  return { vocabulary_version:snapshot.vocabulary_version, generated_at:snapshot.generated_at, denominator:{postings:groups.reduce((n,g)=>n+g.postings,0)}, coverage:{with_skills:groups.reduce((n,g)=>n+g.with_skills,0), classified:groups.reduce((n,g)=>n+g.classified,0), unknown_dates:groups.filter(g=>!g.published_on).reduce((n,g)=>n+g.postings,0)}, skills, groups };
}
/** Monthly publication cohorts, zero-filled only between the available endpoints. */
export function monthlySeries(groups, selected, mode='count') {
  const months = new Map();
  for (const g of groups) {
    if (!g.published_on) continue;
    const month = g.published_on.slice(0,7);
    if (!months.has(month)) months.set(month, {denominator:0,values:Object.fromEntries(selected.map(id=>[id,0]))});
    const row=months.get(month);row.denominator+=g.classified;
    for (const id of selected) row.values[id] += g.skills[id] || 0;
  }
  const keys=[...months.keys()].sort(); if (!keys.length) return [];
  const start=new Date(keys[0]+'-01T00:00:00Z'), end=new Date(keys.at(-1)+'-01T00:00:00Z');
  const output=[];
  while (start<=end) {
    const month=start.toISOString().slice(0,7), row=months.get(month)||{denominator:0,values:Object.fromEntries(selected.map(id=>[id,0]))};
    const values=Object.fromEntries(selected.map(id=>[id,mode==='share'?(row.denominator?100*row.values[id]/row.denominator:null):row.values[id]]));
    output.push({month,denominator:row.denominator,values});start.setUTCMonth(start.getUTCMonth()+1);
  }
  return output;
}

export function salarySummary(groups) {
  const s=groups.reduce((a,g)=>({count:a.count+g.salary.count,min:a.min+g.salary.min_sum,max:a.max+g.salary.max_sum}),{count:0,min:0,max:0});
  return {...s, midpoint:s.count?(s.min+s.max)/(2*s.count):null};
}
export function monthlySalary(groups) {
  const months=new Map(); for(const g of groups) {if(!g.published_on) continue;const month=g.published_on.slice(0,7);if(!months.has(month)) months.set(month,[]);months.get(month).push(g);}
  return [...months].sort(([a],[b])=>a.localeCompare(b)).map(([month,gs])=>({month,...salarySummary(gs)}));
}
