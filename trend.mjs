import {monthlySeries} from './snapshot.mjs';
const NS='http://www.w3.org/2000/svg';
const colors=['#2e7759','#bb7041','#5975a8'];
const element=(tag,attrs={})=>{const e=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs)) e.setAttribute(k,String(v));return e;};
export function renderTrend({groups,selected,labels,chart,legend,table,details,status,mode="count"}) {
  chart.replaceChildren();legend.replaceChildren();table.replaceChildren();details.hidden=true;
  if (!selected.length) {status.hidden=false;status.textContent='Choose at least one skill to compare.';return;}
  const series=monthlySeries(groups,selected,mode);
  if (!series.length) {status.hidden=false;status.textContent='No dated postings match these filters.';return;}
  status.hidden=true;
  const width=900,height=300,left=55,right=20,top=20,bottom=45,innerW=width-left-right,innerH=height-top-bottom;
  const max=Math.max(1,...series.flatMap(p=>selected.map(id=>p.values[id] ?? 0)));
  const x=i=>left+(series.length===1?innerW/2:i*innerW/(series.length-1));
  const y=n=>top+innerH-(n/max)*innerH;
  const svg=element('svg',{viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':`Monthly ${mode==='share'?'percentage of postings with recognized sections':'posting counts'} for ${selected.map(id=>labels[id]).join(', ')}. Exact values are in the monthly numbers table.`});
  for(let i=0;i<=4;i++){const value=max*i/4, yy=y(value);svg.append(element('line',{x1:left,y1:yy,x2:width-right,y2:yy,stroke:'#e1e9e2'}));const t=element('text',{x:left-8,y:yy+4,'text-anchor':'end'});t.textContent=mode==='share'?`${value.toFixed(1)}%`:Math.round(value).toLocaleString();svg.append(t);}
  const ticks=new Set([0,Math.floor((series.length-1)/4),Math.floor((series.length-1)/2),Math.floor(3*(series.length-1)/4),series.length-1]);
  for(const i of ticks){const t=element('text',{x:x(i),y:height-12,'text-anchor':i===0?'start':i===series.length-1?'end':'middle'});t.textContent=series[i].month;svg.append(t);}
  selected.forEach((id,j)=>{
    let segment=[];const draw=()=>{if(segment.length>1)svg.append(element('polyline',{points:segment.map(p=>p.join(',')).join(' '),fill:'none',stroke:colors[j],'stroke-width':3,'stroke-linecap':'round','stroke-linejoin':'round'}));else if(segment.length===1)svg.append(element('circle',{cx:segment[0][0],cy:segment[0][1],r:4,fill:colors[j]}));segment=[];};
    series.forEach((p,i)=>{if(p.values[id]===null)draw();else segment.push([x(i),y(p.values[id])]);});draw();
    const item=document.createElement('span');item.className=`series-${j}`;item.textContent=labels[id];legend.append(item);
  });
  chart.append(svg); const head=document.createElement('thead'), hr=document.createElement('tr');for(const label of ['Month','Recognized sections',...selected.map(id=>labels[id])]){const th=document.createElement('th');th.scope='col';th.textContent=label;hr.append(th);}head.append(hr);table.append(head);const body=document.createElement('tbody');for(const point of series){const row=document.createElement('tr');for(const value of [point.month,point.denominator,...selected.map(id=>point.values[id]===null?'—':mode==='share'?`${point.values[id].toFixed(1)}%`:point.values[id])]){const td=document.createElement('td');td.textContent=String(value);row.append(td);}body.append(row);}table.append(body);details.hidden=false;
}
