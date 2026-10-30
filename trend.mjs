import {monthlySeries} from './snapshot.mjs';
import {legend as drawLegend,lineChart,monthLabel,fillTable,compact} from './chart.mjs';
// Share lines swing wildly on a handful of postings, so thin months are left as gaps.
const MIN_MONTH_POSTINGS=20;
export function renderTrend({groups,selected,slots,labels,chart,legend,table,details,status,mode='share',months=12}) {
  chart.replaceChildren();legend.replaceChildren();table.replaceChildren();details.hidden=true;
  if (!selected.length) {status.hidden=false;status.textContent='Choose at least one skill to compare.';return;}
  const full=monthlySeries(groups,selected,mode);
  if (!full.length) {status.hidden=false;status.textContent='No dated postings match these filters.';return;}
  status.hidden=true;
  const points=months?full.slice(-months):full;
  const current=new Date().toISOString().slice(0,7);
  const series=selected.map((id,i)=>({id,slot:slots?.[i]??i,label:labels[id],values:points.map(p=>mode==='share'&&p.denominator<MIN_MONTH_POSTINGS?null:p.values[id])}));
  const format=mode==='share'?v=>`${v.toFixed(1)}%`:v=>Math.round(v).toLocaleString();
  lineChart({host:chart,points,series,format,axisFormat:mode==='share'?v=>`${Math.round(v*10)/10}%`:compact,pointNote:p=>p.month===current?' (so far)':'',description:`Monthly ${mode==='share'?'share of postings with recognized sections':'posting counts'} for ${series.map(s=>s.label).join(', ')}. Exact values are in the monthly numbers table.`});
  drawLegend(legend,series);
  fillTable(table,['Month','Postings with sections',...series.map(s=>s.label)],points.map((p,i)=>[monthLabel(p.month),p.denominator.toLocaleString(),...series.map(s=>s.values[i]===null?'—':format(s.values[i]))]));
  details.hidden=false;
}
