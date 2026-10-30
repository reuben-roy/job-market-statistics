/** Small chart kit. Charts are drawn at the real pixel width so text stays legible on phones. */
const NS='http://www.w3.org/2000/svg';
export const el=(tag,value='',cls='')=>{const e=document.createElement(tag);e.textContent=value;if(cls)e.className=cls;return e;};
const svgEl=(tag,attrs={})=>{const e=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));return e;};
export const percent=(part,whole,digits=0)=>whole?`${(100*part/whole).toFixed(digits)}%`:'0%';
export const compact=n=>new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(n);
export const monthLabel=month=>new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-US',{month:'short',year:'numeric',timeZone:'UTC'}).replace(/ \d\d(\d\d)$/,' ’$1');

/** One ranked row. The value is always printed, so nothing depends on hover. */
export function barRow({label,value,detail='',share,tone='',note=''}) {
  const row=el('div','',`bar-row ${tone}`.trim()),name=el('span',label,'bar-name'),track=el('span','','bar-track'),fill=el('span','','bar-fill'),figure=el('span',value,'bar-value');
  fill.style.width=`${Math.max(share>0?1.5:0,Math.min(100,share*100))}%`;track.append(fill);
  if(note)name.append(el('span',note,'bar-note'));
  row.append(name,track,figure);if(detail)figure.append(el('small',detail));
  return row;
}
export function dataTable(headings,rows) {
  const wrapper=el('div','','table-wrap'),t=el('table'),head=el('thead'),hr=el('tr');
  for(const h of headings){const th=el('th',h);th.scope='col';hr.append(th);}head.append(hr);t.append(head);
  const body=el('tbody');for(const row of rows){const tr=el('tr');for(const cell of row)tr.append(el('td',String(cell)));body.append(tr);}t.append(body);wrapper.append(t);return wrapper;
}
export function fillTable(target,headings,rows) {target.replaceChildren(...dataTable(headings,rows).firstChild.childNodes);}

function niceTop(max) {
  const step=10**Math.floor(Math.log10(max||1));
  for(const m of [1,1.5,2,2.5,3,4,5,6,8,10])if(m*step>=max)return m*step;
  return 10*step;
}
const observers=new WeakMap();
/** Line chart with a snapping crosshair; pointer, touch and arrow keys all drive one readout. */
export function lineChart({host,points,series,format,axisFormat=format,description,pointNote=()=>''}) {
  let observer=observers.get(host);
  if(observer)observer.disconnect();
  const draw=()=>drawLines({host,points,series,format,axisFormat,description,pointNote});
  observer=new ResizeObserver(()=>{if(host.clientWidth && host.clientWidth!==Number(host.dataset.width))draw();});
  observers.set(host,observer);observer.observe(host);draw();
}
function drawLines({host,points,series,format,axisFormat,description,pointNote}) {
  host.replaceChildren();
  const width=host.clientWidth;host.dataset.width=width;
  if(!width)return;
  const narrow=width<520,height=narrow?220:280,top=14,bottom=28;
  const last=points.length-1,ends=series.map(s=>({s,value:s.values.findLast(v=>v!==null)})).filter(e=>e.value!==undefined);
  const labelled=!narrow && series.length>1;
  const right=labelled?Math.min(120,12+7*Math.max(...ends.map(e=>e.s.label.length))):16;
  const peak=niceTop(Math.max(0,...series.flatMap(s=>s.values.map(v=>v??0)))||1);
  // Tick text sets the gutter, so long money labels are never clipped.
  const left=14+7*Math.max(...[0,1,2,3,4].map(i=>axisFormat(peak*i/4).length));
  const innerW=width-left-right,innerH=height-top-bottom;
  const x=i=>left+(last?i*innerW/last:innerW/2),y=v=>top+innerH-(v/peak)*innerH;
  const svg=svgEl('svg',{width,height,viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':description,tabindex:0});
  for(let i=0;i<=4;i++){const value=peak*i/4,yy=Math.round(y(value))+.5;svg.append(svgEl('line',{x1:left,y1:yy,x2:width-right,y2:yy,class:i?'grid':'axis'}));const t=svgEl('text',{x:left-8,y:yy+4,'text-anchor':'end',class:'tick'});t.textContent=axisFormat(value);svg.append(t);}
  const tickCount=Math.min(narrow?3:6,points.length);
  for(let n=0;n<tickCount;n++){const i=tickCount>1?Math.round(n*last/(tickCount-1)):0,t=svgEl('text',{x:x(i),y:height-8,'text-anchor':!i&&last?'start':i===last&&last?'end':'middle',class:'tick'});t.textContent=monthLabel(points[i].month);svg.append(t);}
  series.forEach(s=>{
    let run=[];
    const flush=()=>{if(run.length>1)svg.append(svgEl('polyline',{points:run.join(' '),class:`line series-${s.slot}`}));else if(run.length)svg.append(svgEl('circle',{cx:run[0][0],cy:run[0][1],r:4,class:`dot series-${s.slot}`}));run=[];};
    s.values.forEach((v,i)=>{if(v===null)flush();else run.push([x(i),y(v)]);});flush();
    const end=s.values.findLastIndex(v=>v!==null);
    if(end>=0)svg.append(svgEl('circle',{cx:x(end),cy:y(s.values[end]),r:4,class:`dot series-${s.slot}`}));
  });
  // End labels only when they cannot collide; the legend always carries identity.
  if(labelled){
    const placed=ends.map(e=>y(e.value)).sort((a,b)=>a-b);
    if(placed.every((v,i)=>!i||v-placed[i-1]>=15))for(const e of ends){const t=svgEl('text',{x:width-right+10,y:y(e.value)+4,class:'end-label'});t.textContent=e.s.label;svg.append(t);}
  }
  const cross=svgEl('line',{y1:top,y2:top+innerH,class:'crosshair',visibility:'hidden'}),marks=series.map(s=>svgEl('circle',{r:5,class:`dot ring series-${s.slot}`,visibility:'hidden'}));
  svg.append(cross,...marks);
  const tip=el('div','','chart-tip');tip.hidden=true;host.append(svg,tip);
  let current=-1;
  const show=i=>{
    current=Math.max(0,Math.min(last,i));
    cross.setAttribute('x1',x(current));cross.setAttribute('x2',x(current));cross.setAttribute('visibility','visible');
    tip.replaceChildren(el('strong',`${monthLabel(points[current].month)}${pointNote(points[current])}`));
    series.forEach((s,j)=>{
      const v=s.values[current],mark=marks[j],row=el('span','','tip-row'),key=el('i','',`key series-${s.slot}`);
      row.append(key,el('b',v===null?'—':format(v)),document.createTextNode(` ${s.label}`));tip.append(row);
      if(v===null)mark.setAttribute('visibility','hidden');else{mark.setAttribute('cx',x(current));mark.setAttribute('cy',y(v));mark.setAttribute('visibility','visible');}
    });
    tip.hidden=false;
    const px=x(current),room=tip.offsetWidth+16;
    tip.style.left=`${px+room>width?px-room+8:px+8}px`;
  };
  const hide=()=>{current=-1;tip.hidden=true;cross.setAttribute('visibility','hidden');marks.forEach(m=>m.setAttribute('visibility','hidden'));};
  const nearest=event=>{const box=svg.getBoundingClientRect();return last?Math.round((event.clientX-box.left-left)/innerW*last):0;};
  svg.addEventListener('pointermove',event=>show(nearest(event)));
  svg.addEventListener('pointerdown',event=>show(nearest(event)));
  svg.addEventListener('pointerleave',event=>{if(event.pointerType==='mouse')hide();});
  svg.addEventListener('blur',hide);
  svg.addEventListener('keydown',event=>{
    if(event.key==='ArrowRight'){event.preventDefault();show(current<0?0:current+1);}
    else if(event.key==='ArrowLeft'){event.preventDefault();show(current<0?last:current-1);}
    else if(event.key==='Escape')hide();
  });
}
export function legend(target,series) {
  target.replaceChildren();
  if(series.length<2)return;
  for(const s of series){const item=el('span',s.label);item.prepend(el('i','',`key series-${s.slot}`));target.append(item);}
}
