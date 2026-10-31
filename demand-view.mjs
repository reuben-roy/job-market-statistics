import {analyzeDemand,FIT_BANDS,MIN_SCORED_SKILLS,STRONG_FIT_LABEL} from './demand.mjs';
import {barRow,el,percent,radarChart} from './chart.mjs';
import {CATEGORIES,GENERAL_SKILLS,suggestible} from './skills.mjs';
const DEFAULT_ROWS=10,LEARN_ROWS=10,RADAR_AXES=8,MIN_RADAR_AXES=3;
let marketView='all',showAllMarket=false,showAllLearn=false,editing=false,combination=[],minShared=2,selectedKey='';
export function resetDemand(){marketView='all';showAllMarket=false;showAllLearn=false;editing=false;combination=[];minShared=2;selectedKey='';}
function card(title,subtitle='',cls=''){const section=el('section','',`card ${cls}`.trim());section.append(el('h2',title));if(subtitle)section.append(el('p',subtitle,'card-sub'));return section;}
function segmented(label,options,value,onChange){
  const group=el('div','','segmented');group.setAttribute('role','group');group.setAttribute('aria-label',label);
  for(const [id,name] of options){const button=el('button',name);button.type='button';button.dataset.key=`${label}:${id}`;button.setAttribute('aria-pressed',String(id===value));button.addEventListener('click',()=>onChange(id));group.append(button);}
  return group;
}
function fitCard({analysis,data,cohort,money}){
  const {bands,scored,strong,median}=analysis.fit,section=el('section','','card fit-card');
  const summary=el('div','','fit-summary');
  summary.append(el('p',`Compared with ${cohort}`,'eyebrow'));
  if(!scored){summary.append(el('p',`Too few of these postings list ${MIN_SCORED_SKILLS} or more tracked skills to score. Try broader filters.`));section.append(summary);return section;}
  const hero=el('p','','fit-hero');hero.append(el('strong',percent(strong,scored)),el('span','of these jobs are a strong match'));
  summary.append(hero,el('p',`You have at least ${STRONG_FIT_LABEL} of the listed skills in ${strong.toLocaleString()} of ${scored.toLocaleString()} postings we could score.`,'fit-copy'));
  const stats=el('dl','','fit-stats');
  const stat=(value,label)=>{const box=el('div');box.append(el('dt',label),el('dd',value));stats.append(box);};
  stat(`${Math.round(median*100)}%`,'Your typical match');
  stat(percent(analysis.any,data.denominator.postings),'Postings with your skills');
  if(money)stat(money,'Average posted pay');
  summary.append(stats);
  const chart=el('figure','','fit-chart'),peak=Math.max(...bands),columns=el('div','','fit-columns');
  chart.setAttribute('aria-label','How many postings fall into each match band');
  bands.forEach((count,i)=>{
    const column=el('div','',`fit-column${i>=3?' is-strong':''}`),bar=el('span','','fit-bar');
    bar.style.height=`${Math.max(count?3:0,peak?100*count/peak:0)}%`;
    column.title=`${FIT_BANDS[i]} of skills: ${count.toLocaleString()} postings`;
    column.append(el('span',percent(count,scored),'fit-value'),bar,el('span',FIT_BANDS[i],'fit-label'));
    columns.append(column);
  });
  columns.append(el('span','Strong match','fit-bracket'));
  chart.append(el('figcaption','Postings by share of their skills you have'),columns);
  section.append(summary,chart);return section;
}
function skillEditor({selected,vocabulary,labels,onChange}){
  const box=el('details','','card skill-editor');box.open=editing;box.addEventListener('toggle',()=>{editing=box.open;});
  const summary=el('summary'),title=el('span',`${selected.size} skills on your résumé`,'editor-title');
  summary.append(title,el('span','Add or remove','link-like'));box.append(summary);
  box.append(el('p','Fix anything we misread and every chart updates. We track '+vocabulary.skills.length+' common skills, so niche tools won’t appear.','card-sub'));
  for(const category of CATEGORIES){
    const mine=category.skills.filter(id=>selected.has(id));if(!mine.length)continue;
    const group=el('div','','chip-group');group.append(el('p',category.label,'chip-heading'));
    const chips=el('div','','chips');
    for(const id of mine){const chip=el('button','','chip');chip.type='button';chip.dataset.key=`chip:${id}`;chip.setAttribute('aria-label',`Remove ${labels[id]}`);chip.append(el('span',labels[id]),el('span','×','chip-x'));chip.addEventListener('click',()=>{selected.delete(id);onChange();});chips.append(chip);}
    group.append(chips);box.append(group);
  }
  const add=el('label','Add a skill','add-skill'),input=el('input'),list=el('datalist');
  input.type='text';input.placeholder='Start typing, e.g. Kubernetes';input.setAttribute('list','skill-options');input.dataset.key='add-skill';input.autocomplete='off';list.id='skill-options';
  const byLabel=new Map(vocabulary.skills.map(s=>[s.label.toLowerCase(),s.id]));
  for(const skill of [...vocabulary.skills].sort((a,b)=>a.label.localeCompare(b.label)))if(!selected.has(skill.id)){const option=el('option');option.value=skill.label;list.append(option);}
  const commit=()=>{const id=byLabel.get(input.value.trim().toLowerCase());if(id && !selected.has(id)){selected.add(id);onChange();}};
  input.addEventListener('change',commit);
  input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();commit();}});
  add.append(input,list);box.append(add);return box;
}
function marketCard({analysis,data,selected,labels,onChange}){
  const ranked=data.skills.filter(s=>s.postings>0&&!GENERAL_SKILLS.includes(s.id));
  const have=ranked.filter(s=>selected.has(s.id)),missing=ranked.filter(s=>!selected.has(s.id));
  const section=card('What employers ask for','The most-mentioned skills in these postings, set against your résumé. Tap a skill to mark it as yours or remove it.','market-card');
  const rerender=view=>{marketView=view;showAllMarket=false;onChange();};
  section.append(segmented('Skill list',[['all','All'],['have',`You have ${have.length}`],['missing','To add']],marketView,rerender));
  const rows={all:ranked,have,missing}[marketView],visible=showAllMarket?rows:rows.slice(0,DEFAULT_ROWS),peak=rows[0]?.postings||1;
  const list=el('div','','bar-list');
  for(const skill of visible){
    const mine=selected.has(skill.id),button=el('button','','bar-button');
    button.type='button';button.dataset.key=`market:${skill.id}`;button.setAttribute('aria-pressed',String(mine));
    button.setAttribute('aria-label',`${labels[skill.id]}, in ${percent(skill.postings,data.denominator.postings,1)} of postings. ${mine?'On your résumé; press to remove.':'Not on your résumé; press to add.'}`);
    button.append(barRow({label:labels[skill.id],note:mine?'':'To add',value:percent(skill.postings,data.denominator.postings),share:skill.postings/peak,tone:mine?'is-have':'is-missing'}));
    button.addEventListener('click',()=>{mine?selected.delete(skill.id):selected.add(skill.id);onChange();});
    list.append(button);
  }
  const bars=el('div','','market-bars'),key=el('p','','bar-key');
  for(const [tone,text] of [['have','On your résumé'],['missing','Not on your résumé']]){const item=el('span',text,'key-item');item.prepend(el('i','',`swatch ${tone}`));key.append(item);}
  bars.append(list,key);
  if(rows.length>DEFAULT_ROWS){const more=el('button',showAllMarket?'Show fewer':`Show all ${rows.length}`,'btn quiet');more.type='button';more.dataset.key='market-more';more.addEventListener('click',()=>{showAllMarket=!showAllMarket;onChange();});bars.append(more);}
  const split=el('div','','market-split');split.append(bars,demandRadar({rows,data,selected,labels}));
  section.append(split);return section;
}
function demandRadar({rows,data,selected,labels}){
  const figure=el('figure','','radar');
  if(rows.length<MIN_RADAR_AXES){figure.append(el('p',`The radar needs at least ${MIN_RADAR_AXES} skills.`,'empty'));return figure;}
  const shown=rows.slice(0,RADAR_AXES),host=el('div','','radar-chart'),share=value=>`${Math.round(value)}%`;
  const axes=shown.map(s=>({label:labels[s.id],value:100*s.postings/data.denominator.postings,mine:selected.has(s.id)}));
  const peak=radarChart({host,axes,format:share,description:`Radar of the top ${axes.length} skills by share of postings. Exact values are in the list beside it.`});
  figure.append(host,el('figcaption',`The top ${axes.length} skills from the list. The outer ring is ${share(peak)} of postings, the outline is demand, and the filled shape is what your résumé covers.`));
  return figure;
}
function learnCard({analysis,selected,labels,onChange,onThreshold}){
  const section=card('What to learn next','Ranked by how many more postings become a strong match if you add the skill.');
  const options=suggestible(analysis.recommendations,selected),visible=showAllLearn?options:options.slice(0,LEARN_ROWS);
  if(!visible.length)section.append(el('p',selected.size<minShared?'Add more skills to see suggestions.':'No skills in your fields meet this overlap. Try broader filters or a lower overlap.','empty'));
  const peak=Math.max(1,...visible.map(r=>r.gain)),list=el('ol','','learn-list');
  for(const item of visible){
    const row=el('li'),add=el('button','I have it','btn outline small');add.type='button';add.dataset.key=`learn:${item.id}`;add.setAttribute('aria-label',`I have ${labels[item.id]}`);
    add.addEventListener('click',()=>{selected.add(item.id);onChange();});
    row.append(barRow({label:labels[item.id],value:item.gain?`+${item.gain.toLocaleString()} jobs`:'',detail:`in ${percent(item.related,analysis.lane)} of similar jobs`,share:item.gain/peak,tone:'is-gain'}),add);list.append(row);
  }
  section.append(list);
  const footer=el('div','','card-foot');
  if(options.length>LEARN_ROWS){const more=el('button',showAllLearn?'Show fewer':`Show all ${options.length}`,'btn quiet');more.type='button';more.dataset.key='learn-more';more.addEventListener('click',()=>{showAllLearn=!showAllLearn;onChange();});footer.append(more);}
  const threshold=el('label','Similar jobs share at least','inline-select'),select=el('select');
  select.setAttribute('aria-label','Minimum shared skills');select.dataset.key='min-shared';
  for(let n=1;n<=Math.min(Math.max(selected.size,1),5);n++){const option=el('option',`${n} of your skills`);option.value=String(n);select.append(option);}
  select.value=String(minShared);select.addEventListener('change',()=>{minShared=Number(select.value);onThreshold();});
  threshold.append(select);footer.append(threshold);section.append(footer);
  return section;
}
function strengthCard({data,selected}){
  const section=card('Where you’re strongest','Your share of the demand for tracked skills in each area.'),list=el('div','','bar-list');
  const rows=CATEGORIES.filter(c=>c.id!=='general').map(c=>{
    const skills=data.skills.filter(s=>c.skills.includes(s.id)),total=skills.reduce((n,s)=>n+s.postings,0),mine=skills.filter(s=>selected.has(s.id)).reduce((n,s)=>n+s.postings,0);
    return {label:c.label,total,share:total?mine/total:0};
  }).filter(r=>r.share>0).sort((a,b)=>b.share-a.share||b.total-a.total);
  for(const row of rows)list.append(barRow({label:row.label,value:percent(row.share,1),share:row.share,tone:'is-have'}));
  section.append(list);return section;
}
function pairsCard({analysis,data,labels,skills,onChange}){
  const section=card('Your skills that travel together','The combinations from your résumé that appear in the same posting most often.'),list=el('div','','bar-list');
  const bundles=analysis.bundles.slice(0,5),peak=bundles[0]?.count||1;
  for(const bundle of bundles)list.append(barRow({label:bundle.ids.map(id=>labels[id]).join(' + '),value:bundle.count.toLocaleString(),share:bundle.count/peak,tone:'is-have'}));
  if(bundles.length)section.append(list);else section.append(el('p','None of your skills appear together in these postings.','empty'));
  const explore=el('details','','explore');explore.open=combination.length>0;
  explore.append(el('summary','Check a specific combination'));
  const pickers=el('div','','picker-row');
  for(let index=0;index<3;index++){
    const label=el('label',`Skill ${index+1}`),select=el('select');select.setAttribute('aria-label',`Combination skill ${index+1}`);select.dataset.key=`combo:${index}`;
    for(const [id,name] of [['','None'],...skills.map(s=>[s.id,s.label])]){const option=el('option',name);option.value=id;select.append(option);}
    select.value=combination[index]||'';
    select.addEventListener('change',()=>{const next=[...combination];next[index]=select.value;combination=[...new Set(next.filter(Boolean))];onChange();});
    label.append(select);pickers.append(label);
  }
  explore.append(pickers);
  const names=combination.map(id=>labels[id]).join(' + ');
  explore.append(el('p',names?`${analysis.all.toLocaleString()} postings mention ${combination.length>1?'all of ':''}${names} (${percent(analysis.all,data.denominator.postings,1)}). Other skills may also be mentioned.`:'Pick up to three skills to count the postings that mention all of them.','fine'));
  if(combination.length===2){const first=analysis.counts.get(combination[0])||0;explore.append(el('p',first?`${percent(analysis.all,first,1)} of postings mentioning ${labels[combination[0]]} also mention ${labels[combination[1]]}.`:`No postings mention ${labels[combination[0]]} here.`,'fine'));}
  section.append(explore);return section;
}
function methodNote(){
  const note=el('details','','method');note.append(el('summary','How this is calculated'));
  const list=el('ul');
  for(const line of [
    `A posting is scored when it lists ${MIN_SCORED_SKILLS} or more tracked skills. Its match is the share of those skills on your résumé; ${STRONG_FIT_LABEL} or more counts as strong.`,
    'General traits such as communication and leadership are left out of the score, because most postings mention them and most résumés don’t.',
    'Suggestions stay within fields your résumé already touches and only count postings that share your chosen number of skills.',
    'Skills are matched literally and some are inferred, for example PostgreSQL implies SQL. A match reflects keywords, not proficiency, eligibility or the chance of being hired.',
    'Counts describe this retained sample of employer boards, and small numbers are only exploratory.'
  ])list.append(el('li',line));
  note.append(list);return note;
}
export function renderDemand({target,data,selected,vocabulary,section='all',cohort='these postings',money='',onChange=()=>{}}) {
  const labels=Object.fromEntries(vocabulary.skills.map(s=>[s.id,s.label]));
  const rerender=()=>{onChange();renderDemand({target,data,selected,vocabulary,section,cohort,money,onChange});};
  // Rebuilding the view must not drop keyboard focus on the control just used.
  const focusKey=target.contains?.(document.activeElement)?document.activeElement.dataset?.key:'';
  target.replaceChildren();
  if(!data){target.append(el('p','Choose a valid filter range to view your match.','notice'));return;}
  const editor=skillEditor({selected,vocabulary,labels,onChange:rerender});
  if(!selected.size){editor.open=true;editing=true;target.append(el('p','We couldn’t find any tracked skills. Add a few below to see your match.','notice'),editor);return;}
  if(!data.denominator.postings){target.append(el('p','No postings match these filters.','notice'),editor);return;}
  const skills=data.skills.filter(s=>selected.has(s.id));
  const nextKey=[...selected].sort().join(',');
  if(nextKey!==selectedKey){combination=combination.filter(id=>selected.has(id));selectedKey=nextKey;}
  minShared=Math.min(Math.max(1,minShared),Math.max(selected.size,1));
  const analysis=analyzeDemand(data.groups,vocabulary.skills.map(s=>s.id),selected,{section,combination,minShared,general:GENERAL_SKILLS});
  if(!analysis.available){target.append(editor,marketCard({analysis,data,selected,labels,onChange:rerender}),el('p','Match scores and suggestions need a newer data snapshot. Individual demand counts are still shown.','notice'));return;}
  const next=el('div','','card-grid even'),stack=el('div','','card-stack');
  stack.append(strengthCard({data,selected}),pairsCard({analysis,data,labels,skills,onChange:rerender}));
  next.append(learnCard({analysis,selected,labels,onChange:rerender,onThreshold:rerender}),stack);
  target.append(fitCard({analysis,data,cohort,money}),editor,marketCard({analysis,data,selected,labels,onChange:rerender}),next,methodNote());
  if(focusKey)target.querySelector?.(`[data-key="${focusKey}"]`)?.focus();
}
