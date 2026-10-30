import vocabulary from './vocabulary.json';
import { detectSkills } from './matcher.mjs';
import { filterSnapshot, salarySummary, monthlySalary } from './snapshot.mjs';
import { renderTrend } from './trend.mjs';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
const $ = id => document.getElementById(id);
let data = null;
let selected = new Set();
let rawSnapshot = null;
let showAllSkills = false;
let fileSequence = 0;
if (window.isSecureContext) $('compare-panel').hidden = false;
else $('insecure-warning').hidden = false;
function text(tag, value, cls) { const e = document.createElement(tag); e.textContent = value; if (cls) e.className = cls; return e; }
function renderChecks() {
  $('checks').replaceChildren();
  for (const skill of vocabulary.skills) {
    const label = document.createElement('label'); const input = document.createElement('input');
    input.type = 'checkbox'; input.checked = selected.has(skill.id);
    input.addEventListener('change', () => { input.checked ? selected.add(skill.id) : selected.delete(skill.id); renderComparison(); });
    label.append(input, document.createTextNode(` ${skill.label}`)); $('checks').append(label);
  }
}
function renderComparison() {
  const result = $('result'); result.replaceChildren();
  if (!data || data.vocabulary_version !== vocabulary.version) { result.append(text('p', 'Market comparison is unavailable until compatible statistics are available.')); return; }
  const counts = new Map(data.skills.map(s => [s.id, s]));
  const matched = vocabulary.skills.filter(s => selected.has(s.id) && (counts.get(s.id)?.postings || 0) > 0);
  const missing = vocabulary.skills.filter(s => !selected.has(s.id) && (counts.get(s.id)?.postings || 0) > 0);
  const p = text('p', ''); p.append(text('strong', 'Matched in this sample: '), document.createTextNode(matched.map(s => s.label).join(', ') || 'None')); result.append(p);
  const q = text('p', ''); q.append(text('strong', 'Mentioned in the sample, not selected: '), document.createTextNode(missing.map(s => s.label).join(', ') || 'None')); result.append(q);

}
const labels=Object.fromEntries(vocabulary.skills.map(s=>[s.id,s.label]));
for (const [id,defaultValue] of [['trend-1','python'],['trend-2','sql'],['trend-3','aws']]) {
  const select=$(id); const none=document.createElement('option'); none.value=''; none.textContent='None'; select.append(none);
  for(const skill of [...vocabulary.skills].sort((a,b)=>a.label.localeCompare(b.label))) {const option=document.createElement('option');option.value=skill.id;option.textContent=skill.label;select.append(option);}
  select.value=defaultValue; select.addEventListener('change',drawTrend);
}
function drawTrend() {
  if (!data) return;
  const selected=[...new Set(['trend-1','trend-2','trend-3'].map(id=>$(id).value).filter(Boolean))];
  renderTrend({groups:data.groups,selected,labels,chart:$('trend-chart'),legend:$('trend-legend'),table:$('trend-table'),details:$('trend-details'),status:$('trend-status'),mode:$('trend-mode').value});
}
function showData() {
  if (!rawSnapshot) return;
  const filters={role:$('role').value,industry:$('industry').value,country:$('country').value,status:$('posting-status').value,from:$('date-from').value,to:$('date-to').value};
  if(filters.from && filters.to && filters.from>filters.to) {data=null;$('status').hidden=false;$('status').textContent='The start date must be on or before the end date.';$('summary').hidden=true;$('skills').replaceChildren();$('show-more').hidden=true;$('trend-chart').replaceChildren();$('trend-legend').replaceChildren();$('trend-details').hidden=true;$('trend-status').hidden=false;$('trend-status').textContent='Choose a valid date range.';$('salary-summary').replaceChildren();$('salary-chart').replaceChildren();$('salary-roles').replaceChildren();$('salary-months').replaceChildren();$('salary-chart-status').textContent='Choose a valid date range.';renderComparison();return;}
  data=filterSnapshot(rawSnapshot,vocabulary,filters);
  const section=$('skill-section').value;
  if(section !== 'all') {
    const groups=data.groups.map(g=>({...g,skills:g.sections[section]}));
    const counts=new Map(); for(const g of groups) for(const [id,n] of Object.entries(g.skills)) counts.set(id,(counts.get(id)||0)+n);
    data.groups=groups; data.skills=vocabulary.skills.map(s=>({id:s.id,label:s.label,postings:counts.get(s.id)||0})).sort((a,b)=>b.postings-a.postings || a.label.localeCompare(b.label));
  }
  const generated=new Date(data.generated_at);const stale=!Number.isFinite(generated.getTime()) || Date.now()-generated.getTime()>36*60*60*1000;
  $('freshness').textContent=generated.getUTCFullYear() < 2000 ? 'Source freshness unknown · some data may be stale' : `${stale?'Possibly stale · ':''}Oldest statistics-only source check: ${generated.toLocaleString()}`;
  $('status').hidden=data.denominator.postings>0;$('status').textContent='No collected postings match these filters.';
  const summary=$('summary');summary.replaceChildren();summary.hidden=!data.denominator.postings;
  for(const [value,label] of [[data.denominator.postings,'collected postings'],[data.coverage.classified,'postings with recognized sections'],[data.coverage.with_skills,'postings with a detected skill in any section'],[data.coverage.unknown_dates,'postings without a publication date']]) {const box=text('div','','metric');box.append(text('strong',String(value)),text('span',label));summary.append(box);}
  drawSkills();drawTrend();drawSalary();renderComparison();
}
function drawSkills() {
  $('skills').replaceChildren();
  const all=data.skills.filter(s=>s.postings>0); const visible=showAllSkills?all:all.slice(0,12);
  for(const skill of visible) {const row=text('div','','skill-row');const bar=document.createElement('progress');bar.className='bar';bar.max=data.denominator.postings;bar.value=skill.postings;bar.setAttribute('aria-label',`${skill.label} share of postings`);row.append(text('strong',skill.label),bar,text('small',`${skill.postings} postings`));$('skills').append(row);}
  $('show-more').hidden=all.length<=12;$('show-more').textContent=showAllSkills?'Show fewer skills':`Show all ${all.length} skills`;
}
$('trend-mode').addEventListener('change',drawTrend);
$('show-more').addEventListener('click',()=>{showAllSkills=!showAllSkills;drawSkills();});
function salaryTable(target, headings, rows) {
  target.replaceChildren(); const head=document.createElement('thead'), hr=document.createElement('tr');
  for(const value of headings){const th=text('th',value);th.scope='col';hr.append(th);} head.append(hr);target.append(head);
  const body=document.createElement('tbody');for(const values of rows){const tr=document.createElement('tr');for(const value of values)tr.append(text('td',String(value)));body.append(tr);}target.append(body);
}
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n);
function drawSalary() {
  const total=salarySummary(data.groups); const summary=$('salary-summary');summary.replaceChildren();
  for(const [value,label] of [[total.count?money(total.midpoint):'—','average range midpoint'],[total.count,'postings with annual USD ranges'],[data.denominator.postings,'postings in sample']]){const box=text('div','','metric');box.append(text('strong',String(value)),text('span',label));summary.append(box);}
  const roles=['engineering','data','design','sales','operations','unknown'];
  const roleRows=roles.map(role=>[role,salarySummary(data.groups.filter(g=>g.role===role))]).filter(([,s])=>s.count).map(([role,s])=>[role[0].toUpperCase()+role.slice(1),money(s.midpoint),s.count]);
  salaryTable($('salary-roles'),['Role','Average midpoint','Postings'],roleRows);
  const months=monthlySalary(data.groups).filter(s=>s.count);
  salaryTable($('salary-months'),['Published month','Average midpoint','Postings'],months.map(s=>[s.month,money(s.midpoint),s.count]));
  const chart=$('salary-chart');chart.replaceChildren();$('salary-chart-status').textContent=months.length<2?'At least two months with salary data are needed for a chart.':'Points show months with salary data; missing months are not zero.';
  if(months.length>=2){
    const ns='http://www.w3.org/2000/svg', el=(tag,attrs)=>{const e=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));return e;};
    const svg=el('svg',{viewBox:'0 0 900 300',role:'img','aria-label':'Average published annual salary range midpoint by month. Exact values are in the monthly table.'});
    const first=Date.parse(months[0].month+'-01T00:00:00Z'),last=Date.parse(months.at(-1).month+'-01T00:00:00Z'),max=Math.max(...months.map(s=>s.midpoint))*1.1;
    for(let i=0;i<=4;i++){const val=max*i/4,y=255-val/max*230;svg.append(el('line',{x1:85,y1:y,x2:880,y2:y,stroke:'#e1e9e2'}));const label=el('text',{x:78,y:y+4,'text-anchor':'end'});label.textContent=money(val);svg.append(label);}
    for(let i=1;i<months.length;i++){const a=months[i-1],b=months[i],ad=new Date(a.month+'-01T00:00:00Z'),next=new Date(ad);next.setUTCMonth(next.getUTCMonth()+1);if(next.toISOString().slice(0,7)===b.month){const x=m=>85+(Date.parse(m.month+'-01T00:00:00Z')-first)/(last-first)*795,y=m=>255-m.midpoint/max*230;svg.append(el('line',{x1:x(a),y1:y(a),x2:x(b),y2:y(b),stroke:'#2e7759','stroke-width':3}));}}
    for(const m of months){const x=85+(Date.parse(m.month+'-01T00:00:00Z')-first)/(last-first)*795,y=255-m.midpoint/max*230;const dot=el('circle',{cx:x,cy:y,r:4,fill:'#2e7759'});const title=el('title',{});title.textContent=`${m.month}: ${money(m.midpoint)} (${m.count} postings)`;dot.append(title);svg.append(dot);}
    for(const [i,anchor] of [[0,'start'],[months.length-1,'end']]){const label=el('text',{x:i?880:85,y:285,'text-anchor':anchor});label.textContent=months[i].month;svg.append(label);}chart.append(svg);
  }
}
async function load() {
  try {
    for (const url of ['/snapshot.json','/fallback-snapshot.json']) {
      try { const response=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer'});if(!response.ok) continue;const snapshot=await response.json();if(snapshot.schema_version===3 && snapshot.vocabulary_version===vocabulary.version){rawSnapshot=snapshot;break;} } catch { /* Try bundled fallback. */ }
    }
    if(!rawSnapshot) throw new Error('No compatible snapshot available');
    const countrySelect=$('country');
    const regionNames=typeof Intl.DisplayNames==='function'?new Intl.DisplayNames(['en'],{type:'region'}):null;
    const countries=[...new Set(rawSnapshot.groups.filter(g=>g.postings>0 && /^[A-Z]{2}$/.test(g.country)).map(g=>g.country))]
      .map(code=>({code,label:regionNames?.of(code)||code})).sort((a,b)=>a.label.localeCompare(b.label));
    countrySelect.replaceChildren();
    for(const {code,label} of [{code:'all',label:'All countries'},...countries,{code:'unknown',label:'Unknown country'}]) {
      const option=document.createElement('option');option.value=code;option.textContent=label;countrySelect.append(option);
    }
    const coverage=rawSnapshot.coverage;
    $('coverage-summary').textContent=coverage?coverage.platforms.map(p=>`${p.platform}: ${p.boards} collected boards, ${p.postings.toLocaleString()} open postings, ${p.issues} source warnings`).join(' · '):'Coverage tracking is not available in this snapshot.';
    if(coverage) salaryTable($('coverage-history'),['Date (UTC)','Collected boards','Open postings'],coverage.history.map(h=>[h.date,h.boards,h.postings]));
    showData();
  } catch(err) {$('status').textContent=`Statistics are currently unavailable (${err.message}). Please try again later.`;$('freshness').textContent='No current statistics';$('trend-status').textContent='Trend data is unavailable.';}
}
async function fileText(file) {
  if (file.size > 10 * 1024 * 1024) throw new Error('Choose a file smaller than 10 MB.');
  const bytes = await file.arrayBuffer();
  if (file.name.toLowerCase().endsWith('.pdf')) {
    const pdfjs = await import('pdfjs-dist'); pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;
    const task = pdfjs.getDocument({data:bytes, isEvalSupported:false, disableFontFace:true, useSystemFonts:true});
    try { const doc = await task.promise; if (doc.numPages > 100) throw new Error('PDFs must have 100 pages or fewer.'); const pages=[]; for(let i=1;i<=doc.numPages;i++) { const page=await doc.getPage(i); const content=await page.getTextContent(); pages.push(content.items.map(item=>item.str || '').join(' ')); } return pages.join('\n'); }
    finally { await task.destroy(); }
  }
  if (file.name.toLowerCase().endsWith('.docx')) { const mammoth = await import('mammoth/mammoth.browser'); return (await mammoth.extractRawText({arrayBuffer:bytes})).value; }
  throw new Error('Choose a PDF or .docx file.');
}
$('file').addEventListener('change', async () => {
  const file = $('file').files[0]; if (!file) return; const sequence = ++fileSequence;
  $('parse-status').textContent = 'Reading on your device…';
  try { const content = await fileText(file); if (sequence !== fileSequence) return; if (content.length > 500000) throw new Error('Extracted text is too large.'); $('resume').value = content; $('parse-status').textContent = content.trim() ? 'Text extracted locally. Review it or detect skills.' : 'No text found. The file may require OCR.'; }
  catch (err) { if (sequence === fileSequence) $('parse-status').textContent = `Could not read this file: ${err.message}`; }
  finally { if (sequence === fileSequence) $('file').value = ''; }
});
$('detect').addEventListener('click', () => { selected = new Set(detectSkills($('resume').value, vocabulary)); $('comparison').hidden = false; renderChecks(); renderComparison(); });
$('clear').addEventListener('click', () => { fileSequence++; $('resume').value=''; $('file').value=''; selected.clear(); $('comparison').hidden=true; $('checks').replaceChildren(); $('result').replaceChildren(); $('parse-status').textContent='Résumé cleared from this page.'; });
for (const id of ['role','industry','country','posting-status','date-from','date-to','skill-section']) $(id).addEventListener('change',showData);
load();
