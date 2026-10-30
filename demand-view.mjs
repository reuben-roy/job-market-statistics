import {analyzeDemand} from './demand.mjs';
import {renderTrend} from './trend.mjs';
const NS='http://www.w3.org/2000/svg';
const el=(tag,value='',cls='')=>{const e=document.createElement(tag);e.textContent=value;if(cls)e.className=cls;return e;};
const svgEl=(tag,attrs={})=>{const e=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));return e;};
let view='bars', axes=new Set(), selectedKey='', combination=[],minShared=2;
export function resetDemand(){view='bars';axes.clear();selectedKey='';combination=[];minShared=2;}
function table(headings,rows){const wrapper=el('div','','table-wrap'),t=el('table'),head=el('thead'),hr=el('tr');for(const h of headings){const th=el('th',h);th.scope='col';hr.append(th);}head.append(hr);t.append(head);const body=el('tbody');for(const row of rows){const tr=el('tr');for(const cell of row)tr.append(el('td',String(cell)));body.append(tr);}t.append(body);wrapper.append(t);return wrapper;}
function radar(skills,total) {
  const svg=svgEl('svg',{viewBox:'0 0 800 540',role:'img','aria-label':'Share of filtered postings mentioning each radar skill. Exact counts and percentages are listed below.'});
  const cx=400,cy=265,r=175, point=(i,f)=>[cx+Math.cos(-Math.PI/2+i*2*Math.PI/skills.length)*r*f,cy+Math.sin(-Math.PI/2+i*2*Math.PI/skills.length)*r*f];
  for(const fraction of [.25,.5,.75,1]) {svg.append(svgEl('polygon',{points:skills.map((_,i)=>point(i,fraction).join(',')).join(' '),fill:'none',stroke:'#d8e4dc'}));const label=svgEl('text',{x:cx+6,y:cy-r*fraction+14});label.textContent=`${fraction*100}%`;svg.append(label);}
  skills.forEach((s,i)=>{const [x,y]=point(i,1);svg.append(svgEl('line',{x1:cx,y1:cy,x2:x,y2:y,stroke:'#d8e4dc'}));const [tx,ty]=point(i,1.17),label=svgEl('text',{x:tx,y:ty,'text-anchor':Math.abs(tx-cx)<20?'middle':tx<cx?'end':'start'});label.textContent=s.label;svg.append(label);});
  svg.append(svgEl('polygon',{points:skills.map((s,i)=>point(i,total?s.postings/total:0).join(',')).join(' '),fill:'#4d8b7030',stroke:'#2e7759','stroke-width':2}));
  skills.forEach((s,i)=>{const [x,y]=point(i,total?s.postings/total:0),dot=svgEl('circle',{cx:x,cy:y,r:5,fill:'#2e7759'}),title=svgEl('title');title.textContent=`${s.label}: ${s.postings.toLocaleString()} postings (${total?(100*s.postings/total).toFixed(1):'0.0'}%)`;dot.append(title);svg.append(dot);});return svg;
}
export function renderDemand({target,data,selected,vocabulary,section='all'}) {
  target.replaceChildren();
  if(!data){target.append(el('p','Choose a valid filter range to view demand.'));return;}
  if(!selected.size){target.append(el('p','Select at least one skill above to explore demand.'));return;}
  const labels=Object.fromEntries(vocabulary.skills.map(s=>[s.id,s.label]));
  const skills=data.skills.filter(s=>selected.has(s.id)).sort((a,b)=>b.postings-a.postings||a.label.localeCompare(b.label));
  const nextKey=[...selected].sort().join(',');
  if(nextKey!==selectedKey){axes=new Set(skills.slice(0,8).map(s=>s.id));combination=skills.slice(0,Math.min(2,skills.length)).map(s=>s.id);selectedKey=nextKey;}
  minShared=Math.min(Math.max(1,minShared),selected.size);
  const rerender=()=>renderDemand({target,data,selected,vocabulary,section});
  const analysis=analyzeDemand(data.groups,vocabulary.skills.map(s=>s.id),selected,{section,combination,minShared});
  target.append(el('h3','Demand for your skills'),el('p',`Current market filters apply: ${data.denominator.postings.toLocaleString()} retained postings. Values measure mentions in the chosen job sections, not proficiency or hiring eligibility.`,'fine'));
  const metricBox=el('div','','metrics');
  if(analysis.available)for(const [n,label] of [[analysis.any,'mention at least one selected skill'],[analysis.covered,'all detected skills covered by your selection'],[analysis.withSkills,'have detected skills in these sections']]){const card=el('div','','metric');card.append(el('strong',n.toLocaleString()),el('span',label));metricBox.append(card);}
  target.append(metricBox);
  if(!data.denominator.postings){target.append(el('p','No postings match the current market filters.'));return;}
  const controls=el('div','','actions');for(const [value,label] of [['bars','Ranked bars'],['radar','Radar chart']]){const button=el('button',label,value===view?'':'secondary');button.type='button';button.setAttribute('aria-pressed',String(view===value));button.addEventListener('click',()=>{view=value;rerender();});controls.append(button);}target.append(controls);
  if(view==='radar') {
    const details=el('details'),summary=el('summary','Choose radar axes (3–10 skills)'),choices=el('div','','checks'),notice=el('p','','fine');details.open=true;details.append(summary,choices,notice);
    for(const skill of skills){const label=el('label'),input=el('input');input.type='checkbox';input.checked=axes.has(skill.id);input.addEventListener('change',()=>{if(input.checked && axes.size>=10){input.checked=false;notice.textContent='Choose up to ten axes. Deselect another skill first.';return;}input.checked?axes.add(skill.id):axes.delete(skill.id);rerender();});label.append(input,document.createTextNode(' '+skill.label));choices.append(label);}target.append(details);
    const visible=skills.filter(s=>axes.has(s.id));if(visible.length<3)target.append(el('p','Select at least three radar axes. The full demand table remains available below.','fine'));else {const chart=el('div','','demand-radar');chart.append(radar(visible,data.denominator.postings));target.append(chart);}
  }
  const list=el('div','','demand-bars');for(const skill of skills){const row=el('div','','skill-row'),bar=el('progress','','bar');bar.max=data.denominator.postings;bar.value=skill.postings;bar.setAttribute('aria-label',`${skill.label}: ${skill.postings} of ${data.denominator.postings} postings`);row.append(el('strong',skill.label),bar,el('small',`${skill.postings.toLocaleString()} · ${(100*skill.postings/data.denominator.postings).toFixed(1)}%`));list.append(row);}target.append(list);
  if(!analysis.available){target.append(el('p','Exact combinations and recommendations are unavailable in this older snapshot. Individual demand counts are still shown.','notice'));return;}
  target.append(el('h3','Explore a skill combination'));
  const combos=el('div','','filters');for(let index=0;index<3;index++){const label=el('label',`Skill ${index+1}`),select=el('select');select.setAttribute('aria-label',`Combination skill ${index+1}`);for(const [id,name] of [['','None'],...skills.map(s=>[s.id,s.label])]){const option=el('option',name);option.value=id;select.append(option);}select.value=combination[index]||'';select.addEventListener('change',()=>{combination[index]=select.value;combination=[...new Set(combination.filter(Boolean))];rerender();});label.append(select);combos.append(label);}target.append(combos);
  const comboLabel=[...new Set(combination)].filter(Boolean).map(id=>labels[id]).join(' + ');
  target.append(el('p',comboLabel?`${analysis.all.toLocaleString()} postings mention every skill in ${comboLabel} (${(100*analysis.all/data.denominator.postings).toFixed(1)}% of this sample). Other skills may also be mentioned.`:'Choose a combination to count postings mentioning every selected term.'));
  if(combination.length===2){const first=analysis.counts.get(combination[0])||0;target.append(el('p',first?`${(100*analysis.all/first).toFixed(1)}% of postings mentioning ${labels[combination[0]]} also mention ${labels[combination[1]]}.`:`No postings mention ${labels[combination[0]]} in this sample.`,'fine'));}
  target.append(el('h3','Common bundles from your skills'),el('p',`Pairs and triples are counted within the same posting, among your ${analysis.bundleIds.length} most-mentioned selected skills. Counts overlap and should not be added together.`,'fine'));
  if(analysis.bundles.length)target.append(table(['Skills together','Postings'],analysis.bundles.slice(0,8).map(b=>[b.ids.map(id=>labels[id]).join(' + '),b.count.toLocaleString()])));else target.append(el('p','No pairs or triples from your selection were detected together.','fine'));
  target.append(el('h3','Skills worth exploring next'));
  const minLabel=el('label','Require shared skills for recommendations'),minSelect=el('select');minSelect.setAttribute('aria-label','Minimum shared skills');for(let n=1;n<=Math.min(selected.size,5);n++){const option=el('option',String(n));option.value=String(n);minSelect.append(option);}minSelect.value=String(minShared);minSelect.addEventListener('change',()=>{minShared=Number(minSelect.value);rerender();});minLabel.append(minSelect);target.append(minLabel);
  target.append(el('p',`Suggestions require at least ${minShared} of your existing selected skills in the same posting. “One detected skill gap” counts postings where the suggestion is the only detected skill absent from your selection. Adding it would cover those detected terms; this does not establish qualification. Related demand can include additional gaps. Small counts are exploratory signals.`,'fine'));
  if(analysis.recommendations.length)target.append(table(['Skill to explore','One detected skill gap','Related postings'],analysis.recommendations.slice(0,12).map(s=>[labels[s.id],s.additional.toLocaleString(),s.related.toLocaleString()])));else target.append(el('p','No additions meet this shared-skill threshold. Try a broader role or date range, or reduce the threshold.','fine'));
  target.append(el('h3','Publication-month demand for your combination'),el('p','These lines show each chosen skill separately. Jobs without reliable publication dates are excluded. Older months contain only retained postings, and the current month may be incomplete.','fine'));
  const chart=el('div','','trend-chart'),legend=el('div','','trend-legend'),details=el('details'),summary=el('summary','Monthly demand numbers'),numbers=el('table'),wrap=el('div','','table-wrap'),status=el('p','','notice');wrap.append(numbers);details.append(summary,wrap);target.append(status,chart,legend,details);
  renderTrend({groups:data.groups,selected:[...new Set(combination)].filter(Boolean),labels,chart,legend,table:numbers,details,status});
}
