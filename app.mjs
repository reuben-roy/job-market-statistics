import vocabulary from './vocabulary.json';
import {renderDemand,resetDemand} from './demand-view.mjs';
import {barRow,compact,el,fillTable,lineChart,monthLabel,percent} from './chart.mjs';
import {inferRole} from './demand.mjs';
import {CATEGORIES,GENERAL_SKILLS,detectResumeSkills} from './skills.mjs';
import { filterSnapshot, matchingGroups, salarySummary, monthlySalary } from './snapshot.mjs';
import { renderTrend } from './trend.mjs';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
const $ = id => document.getElementById(id);
const TABS=['match','skills','trends','salaries','about'];
const ROLE_LABELS={engineering:'Engineering',data:'Data',design:'Design',sales:'Sales',operations:'Operations',unknown:'Other'};
const SKILL_ROWS=12,MIN_CHART_SALARIES=3,CHART_SALARY_MONTHS=24;
let data = null;
let selected = new Set();
let rawSnapshot = null;
let showAllSkills = false;
let skillCategoryFilter = 'all';
let fileSequence = 0;
let hasResume = false;
let roleWasInferred = false;
let trendTouched = false;
let trendMode='share',trendMonths=12;
const regionNames=typeof Intl.DisplayNames==='function'?new Intl.DisplayNames(['en'],{type:'region'}):null;
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n);
const moneyShort=n=>`$${Math.round(n/1000)}K`;
if (window.isSecureContext) $('compare-panel').hidden = false;
else $('insecure-warning').hidden = false;

/* Navigation */
function currentTab(){const tab=location.hash.slice(1);return TABS.includes(tab)?tab:'match';}
function showTab({focus=false}={}) {
  const tab=currentTab();
  for(const name of TABS){$(`panel-${name}`).hidden=name!==tab;const link=document.querySelector(`[data-tab="${name}"]`);name===tab?link.setAttribute('aria-current','page'):link.removeAttribute('aria-current');}
  document.querySelector('[data-tab][aria-current]').scrollIntoView?.({inline:'center',block:'nearest'});
  syncFilterBar();
  if(tab==='trends'&&data)drawTrend();
  if(tab==='salaries'&&data)drawSalary();
  if(focus){window.scrollTo(0,0);$(`panel-${tab}`).focus({preventScroll:true});}
}
window.addEventListener('hashchange',()=>showTab({focus:true}));
function syncFilterBar(){const tab=currentTab();$('filter-bar').hidden=!rawSnapshot||tab==='about'||(tab==='match'&&!hasResume);}

/* Filters live in one element, moved into a sheet on small screens so the page never duplicates controls. */
const narrow=window.matchMedia('(max-width: 760px)');
function placeFilters(){(narrow.matches?$('sheet-body'):$('filters-home')).append($('filters'));if(!narrow.matches&&$('filter-sheet').open)$('filter-sheet').close();}
narrow.addEventListener('change',placeFilters);placeFilters();
$('open-filters').addEventListener('click',()=>$('filter-sheet').showModal());
$('close-filters').addEventListener('click',()=>$('filter-sheet').close());
$('apply-filters').addEventListener('click',()=>$('filter-sheet').close());
function isoDaysAgo(days){const date=new Date();date.setDate(date.getDate()-days);return date.toISOString().slice(0,10);}
function dateRange(){
  const posted=$('posted').value;
  if(posted==='any')return {from:'',to:''};
  if(posted==='custom')return {from:$('date-from').value,to:$('date-to').value};
  return {from:isoDaysAgo(Number(posted)),to:''};
}
function activeFilters(){return ['role','country','posted','posting-status','skill-section'].filter(id=>!['all','any'].includes($(id).value));}
function countryName(code){return code==='unknown'?'unknown country':regionNames?.of(code)||code;}
function cohortName(){
  const role=$('role').value,country=$('country').value;
  const base=role==='all'?'all postings':role==='unknown'?'other postings':`${ROLE_LABELS[role]} postings`;
  return country==='all'?base:`${base} in ${countryName(country)}`;
}
function updateFilterChrome(){
  const count=activeFilters().length;
  $('filter-count').hidden=!count;$('filter-count').textContent=String(count);$('reset-filters').hidden=!count;
  const postings=data?.denominator.postings??0;
  $('filter-summary').textContent=data?`${postings.toLocaleString()} ${cohortName()}`:'Check your filters';
  $('apply-filters').textContent=data?`Show ${postings.toLocaleString()} postings`:'Close';
}
function clearViews(message){
  $('status').hidden=false;$('status').textContent=message;
  for(const id of ['summary','skills','salary-summary','salary-roles','salary-chart','salary-months','trend-chart','trend-legend'])$(id).replaceChildren();
  $('show-more').hidden=true;$('trend-details').hidden=true;$('trend-status').hidden=false;$('trend-status').textContent=message;$('salary-chart-status').textContent=message;
}

/* Résumé results */
function renderComparison(){
  if(!hasResume)return;
  const result=$('result');
  if(data && data.vocabulary_version!==vocabulary.version){result.replaceChildren(el('p','Market comparison is unavailable until compatible statistics are available.','notice'));return;}
  const pay=data?salarySummary(data.groups):null;
  renderDemand({target:result,data,selected,vocabulary,section:$('skill-section').value,cohort:cohortName(),money:pay?.count?moneyShort(pay.midpoint):'',onChange:onSkillsChanged});
}
function onSkillsChanged(){if(data){drawSkills();if(!trendTouched)seedTrend();}}
function seedTrend(){
  if(!data)return;
  const top=data.skills.filter(s=>selected.has(s.id)&&!GENERAL_SKILLS.includes(s.id)).slice(0,3);
  if(top.length){['trend-1','trend-2','trend-3'].forEach((id,i)=>{$(id).value=top[i]?.id||'';});if(currentTab()==='trends')drawTrend();}
}
function showResults(name){
  hasResume=true;resetDemand();
  $('upload-view').hidden=true;$('results-view').hidden=false;
  $('resume-name').textContent=name;
  const role=$('role');
  roleWasInferred=false;
  if(role.value==='all'&&rawSnapshot){
    const inferred=inferRole(rawSnapshot.groups,vocabulary.skills.map(s=>s.id),selected);
    if(inferred){role.value=inferred;roleWasInferred=true;}
  }
  $('role-note').hidden=!roleWasInferred;
  $('role-note').textContent=roleWasInferred?`Showing ${ROLE_LABELS[role.value]} postings, the closest fit for your résumé. Change this in Filters.`:'';
  syncFilterBar();showData();
  if(!trendTouched)seedTrend();
  window.scrollTo(0,0);$('results-title').focus({preventScroll:true});
}
function setParseStatus(message){$('parse-status').hidden=!message;$('parse-status').textContent=message;}
function analyze(text,name){
  selected=detectResumeSkills(text,vocabulary);
  setParseStatus('');showResults(name);
}
function clearResume(){
  fileSequence++;resetDemand();$('resume').value='';$('file').value='';selected.clear();hasResume=false;
  if(roleWasInferred){$('role').value='all';roleWasInferred=false;}
  $('result').replaceChildren();$('role-note').hidden=true;$('results-view').hidden=true;$('upload-view').hidden=false;
  syncFilterBar();showData();
}

/* Market views */
function drawPreview(){
  const source=filterSnapshot(rawSnapshot,vocabulary,{role:'all',industry:'all',country:'all',status:'all',from:'',to:''});
  const top=source.skills.filter(s=>!GENERAL_SKILLS.includes(s.id)).slice(0,6),peak=top[0]?.postings||1;
  $('landing-count').textContent=source.denominator.postings.toLocaleString();
  $('preview-skills').replaceChildren(...top.map(s=>barRow({label:s.label,value:percent(s.postings,source.denominator.postings),share:s.postings/peak,tone:'is-have'})));
}
function showData() {
  if (!rawSnapshot) return;
  const {from,to}=dateRange();
  const filters={role:$('role').value,industry:'all',country:$('country').value,status:$('posting-status').value,from,to};
  if(from && to && from>to) {data=null;clearViews('The start date must be on or before the end date.');updateFilterChrome();renderComparison();return;}
  data=filterSnapshot(rawSnapshot,vocabulary,filters);
  const section=$('skill-section').value;
  if(section !== 'all') {
    const groups=data.groups.map(g=>({...g,skills:g.sections[section]}));
    const counts=new Map(); for(const g of groups) for(const [id,n] of Object.entries(g.skills)) counts.set(id,(counts.get(id)||0)+n);
    data.groups=groups; data.skills=vocabulary.skills.map(s=>({id:s.id,label:s.label,postings:counts.get(s.id)||0})).sort((a,b)=>b.postings-a.postings || a.label.localeCompare(b.label));
  }
  drawFreshness();
  $('status').hidden=data.denominator.postings>0;$('status').textContent='No collected postings match these filters.';
  updateFilterChrome();
  const summary=$('summary');summary.replaceChildren();
  $('skills-sub').textContent=`Most-mentioned skills across ${data.denominator.postings.toLocaleString()} ${cohortName()}.`;
  if(data.denominator.postings)for(const [value,label] of [[compact(data.denominator.postings),'Postings'],[percent(data.coverage.classified,data.denominator.postings),'With readable sections'],[percent(data.coverage.with_skills,data.denominator.postings),'Mention a tracked skill']])summary.append(statTile(value,label));
  drawSkills();drawTrend();drawSalary();renderComparison();
}
function statTile(value,label){const box=el('div','','stat');box.append(el('strong',String(value)),el('span',label));return box;}
function drawFreshness(){
  const generated=new Date(rawSnapshot.generated_at),latest=rawSnapshot.coverage?.history.at(-1)?.date;
  const known=generated.getUTCFullYear()>=2000,stale=!Number.isFinite(generated.getTime())||Date.now()-generated.getTime()>36*60*60*1000;
  const refreshed=latest?new Date(`${latest}T00:00:00Z`).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'}):'';
  $('freshness').textContent=known?`${stale?'Possibly stale. ':''}Every source was checked after ${generated.toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'})}.`:`${refreshed?`Last refreshed ${refreshed}. `:''}Some sources can’t confirm their freshness, so parts of this data may be stale.`;
}
function drawCategoryTabs(){
  const options=[['all','All'],...CATEGORIES.map(c=>[c.id,c.label])];
  const group=el('div','','pill-row');group.setAttribute('role','group');group.setAttribute('aria-label','Skill area');
  for(const [id,label] of options){const button=el('button',label,'pill');button.type='button';button.setAttribute('aria-pressed',String(id===skillCategoryFilter));button.addEventListener('click',()=>{skillCategoryFilter=id;showAllSkills=false;drawCategoryTabs();drawSkills();group.parentNode.querySelector('[aria-pressed="true"]').focus();});group.append(button);}
  $('category-tabs').replaceChildren(group);
}
function drawSkills() {
  const scope=skillCategoryFilter==='all'?null:CATEGORIES.find(c=>c.id===skillCategoryFilter).skills;
  const all=data.skills.filter(s=>s.postings>0&&(!scope||scope.includes(s.id)));
  const visible=showAllSkills?all:all.slice(0,SKILL_ROWS),peak=all[0]?.postings||1;
  $('skills').replaceChildren(...visible.map(skill=>barRow({label:skill.label,note:hasResume&&selected.has(skill.id)?'Yours':'',value:percent(skill.postings,data.denominator.postings),detail:skill.postings.toLocaleString(),share:skill.postings/peak,tone:hasResume&&!selected.has(skill.id)?'is-muted':'is-have'})));
  $('show-more').hidden=all.length<=SKILL_ROWS;$('show-more').textContent=showAllSkills?'Show fewer':`Show all ${all.length}`;
}
$('show-more').addEventListener('click',()=>{showAllSkills=!showAllSkills;drawSkills();});

const labels=Object.fromEntries(vocabulary.skills.map(s=>[s.id,s.label]));
for (const [id,defaultValue] of [['trend-1','python'],['trend-2','sql'],['trend-3','aws']]) {
  const select=$(id); select.append(Object.assign(el('option','None'),{value:''}));
  for(const skill of [...vocabulary.skills].sort((a,b)=>a.label.localeCompare(b.label))) select.append(Object.assign(el('option',skill.label),{value:skill.id}));
  select.value=defaultValue; select.addEventListener('change',()=>{trendTouched=true;drawTrend();});
}
function drawTrend() {
  if (!data) return;
  const picks=['trend-1','trend-2','trend-3'].map((id,slot)=>({id:$(id).value,slot})).filter(p=>p.id);
  const unique=picks.filter((p,i)=>picks.findIndex(q=>q.id===p.id)===i);
  renderTrend({groups:data.groups,selected:unique.map(p=>p.id),slots:unique.map(p=>p.slot),labels,chart:$('trend-chart'),legend:$('trend-legend'),table:$('trend-table'),details:$('trend-details'),status:$('trend-status'),mode:trendMode,months:trendMonths});
}
function bindSegmented(id,onPick){
  const group=$(id);
  group.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    for(const other of group.querySelectorAll('button'))other.setAttribute('aria-pressed',String(other===button));
    onPick(button.dataset.value);drawTrend();
  });
}
bindSegmented('trend-mode',value=>{trendMode=value;});
bindSegmented('trend-range',value=>{trendMonths=Number(value);});

function drawSalary() {
  const total=salarySummary(data.groups),summary=$('salary-summary');summary.replaceChildren();
  for(const [value,label] of [[total.count?money(total.midpoint):'—','Average range midpoint'],[total.count.toLocaleString(),'Postings with annual USD ranges'],[percent(total.count,data.denominator.postings),'Of postings list a salary']])summary.append(statTile(value,label));
  // Roles compare against each other, so this one chart ignores the role filter and marks the chosen role.
  const {from,to}=dateRange(),everyRole=matchingGroups(rawSnapshot,{role:'all',industry:'all',country:$('country').value,status:$('posting-status').value,from,to});
  const roles=Object.keys(ROLE_LABELS).map(role=>[role,salarySummary(everyRole.filter(g=>g.role===role))]).filter(([,s])=>s.count).sort((a,b)=>b[1].midpoint-a[1].midpoint);
  const peak=roles[0]?.[1].midpoint||1,chosen=$('role').value;
  $('salary-roles').replaceChildren(...roles.map(([role,s])=>barRow({label:ROLE_LABELS[role],value:moneyShort(s.midpoint),detail:`${s.count.toLocaleString()} postings`,share:s.midpoint/peak,tone:chosen==='all'||chosen===role?'is-have':'is-muted'})));
  const months=monthlySalary(data.groups).filter(s=>s.count);
  fillTable($('salary-months'),['Month','Average midpoint','Postings'],months.map(s=>[monthLabel(s.month),money(s.midpoint),s.count.toLocaleString()]));
  const chartable=months.filter(s=>s.count>=MIN_CHART_SALARIES).slice(-CHART_SALARY_MONTHS);
  $('salary-chart').replaceChildren();
  $('salary-chart-status').textContent=chartable.length<2?'Not enough dated salary data to chart these filters.':'Average midpoint. Thin months are left out.';
  if(chartable.length>=2)lineChart({host:$('salary-chart'),points:chartable,series:[{slot:0,label:'Average midpoint',values:chartable.map(s=>s.midpoint)}],format:money,axisFormat:compactMoney,pointNote:p=>` · ${p.count.toLocaleString()} postings`,description:'Average posted annual salary range midpoint by month. Exact values are in the monthly table.'});
}
function compactMoney(n){return n?`$${compact(n)}`:'$0';}

async function load() {
  try {
    for (const url of ['/snapshot.json','/fallback-snapshot.json']) {
      try { const response=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer'});if(!response.ok) continue;const snapshot=await response.json();if([3,4].includes(snapshot.schema_version) && snapshot.vocabulary_version===vocabulary.version){rawSnapshot=snapshot;break;} } catch { /* Try bundled fallback. */ }
    }
    if(!rawSnapshot) throw new Error('No compatible snapshot available');
    const countrySelect=$('country');
    const countries=[...new Set(rawSnapshot.groups.filter(g=>g.postings>0 && /^[A-Z]{2}$/.test(g.country)).map(g=>g.country))]
      .map(code=>({code,label:regionNames?.of(code)||code})).sort((a,b)=>a.label.localeCompare(b.label));
    countrySelect.replaceChildren();
    for(const {code,label} of [{code:'all',label:'All countries'},...countries,{code:'unknown',label:'Unknown country'}]) countrySelect.append(Object.assign(el('option',label),{value:code}));
    const coverage=rawSnapshot.coverage;
    if(coverage){
      const peak=Math.max(1,...coverage.platforms.map(p=>p.postings));
      const name=p=>({greenhouse:'Greenhouse',ashby:'Ashby',lever:'Lever',workday:'Workday',smartrecruiters:'SmartRecruiters'}[p]||p);
      const list=el('div','','bar-list');
      for(const p of [...coverage.platforms].sort((a,b)=>b.postings-a.postings))list.append(barRow({label:name(p.platform),value:p.postings.toLocaleString(),detail:`${p.boards} boards${p.issues?` · ${p.issues} warnings`:''}`,share:p.postings/peak,tone:'is-have'}));
      $('coverage-summary').replaceChildren(list);
      fillTable($('coverage-history'),['Date (UTC)','Boards','Open postings'],coverage.history.map(h=>[h.date,h.boards,h.postings.toLocaleString()]));
    } else $('coverage-summary').textContent='Coverage tracking is not available in this snapshot.';
    drawPreview();drawCategoryTabs();syncFilterBar();showData();
  } catch(err) {$('status').hidden=false;$('status').textContent=`Statistics are currently unavailable (${err.message}). Please try again later.`;$('freshness').textContent='No current statistics';$('trend-status').hidden=false;$('trend-status').textContent='Trend data is unavailable.';$('preview-sub').textContent='Unavailable right now';}
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
async function readFile(file) {
  if (!file) return; const sequence = ++fileSequence;
  setParseStatus('Reading on your device…');$('drop').classList.add('is-busy');
  try {
    const content = await fileText(file); if (sequence !== fileSequence) return;
    if (content.length > 500000) throw new Error('Extracted text is too large.');
    if (!content.trim()) {setParseStatus('No text found. This looks like a scanned file, so try running OCR first or paste the text instead.');return;}
    $('resume').value = content; analyze(content,file.name);
  }
  catch (err) { if (sequence === fileSequence) setParseStatus(`Could not read this file: ${err.message}`); }
  finally { if (sequence === fileSequence) {$('file').value = '';$('drop').classList.remove('is-busy');} }
}
$('file').addEventListener('change', () => readFile($('file').files[0]));
const drop=$('drop');
for(const type of ['dragenter','dragover'])drop.addEventListener(type,event=>{event.preventDefault();drop.classList.add('is-over');});
for(const type of ['dragleave','drop'])drop.addEventListener(type,event=>{event.preventDefault();drop.classList.remove('is-over');});
drop.addEventListener('drop',event=>readFile(event.dataTransfer.files[0]));
$('detect').addEventListener('click', () => {const text=$('resume').value;if(!text.trim()){setParseStatus('Paste your résumé text first.');return;}analyze(text,'Pasted résumé');});
$('clear').addEventListener('click', clearResume);
$('replace').addEventListener('click', () => $('file').click());
for (const id of ['role','country','posted','posting-status','date-from','date-to','skill-section']) $(id).addEventListener('change',()=>{
  if(id==='role'&&roleWasInferred){roleWasInferred=false;$('role-note').hidden=true;}
  if(id==='posted'){$('from-field').hidden=$('to-field').hidden=$('posted').value!=='custom';}
  showData();
});
$('reset-filters').addEventListener('click',()=>{
  for(const id of ['role','country','posting-status','skill-section'])$(id).value='all';
  $('posted').value='any';$('date-from').value='';$('date-to').value='';$('from-field').hidden=$('to-field').hidden=true;
  roleWasInferred=false;$('role-note').hidden=true;showData();
});
showTab();
load();
