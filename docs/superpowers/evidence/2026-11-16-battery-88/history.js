(function(root,factory){
 'use strict';
 var api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root){root.BatteryHistory=api;if(root.document&&root.document.querySelector('[data-battery-history]'))api.mount(root.document,root);}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 var columns=['ts_iso','ts','soc','voltage_mv','current_ma','power_w','temp_c','status'];
 var usbColumns=['usb_online','input_voltage_mv','input_current_ma','input_power_w'];
 var maxGap=120;
 function number(value){
  if(value===null||value===undefined||String(value).trim()==='')return null;
  var s=String(value).trim();if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(s))return null;
  var n=Number(s);return Number.isFinite(n)?n:null;
 }
 function validIso(s){
  var m=/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if(!m)return false;
  var v=m.slice(1).map(Number),d=new Date(Date.UTC(v[0],v[1]-1,v[2],v[3],v[4],v[5]));
  return d.getUTCFullYear()===v[0]&&d.getUTCMonth()+1===v[1]&&d.getUTCDate()===v[2]&&d.getUTCHours()===v[3]&&d.getUTCMinutes()===v[4]&&d.getUTCSeconds()===v[5];
 }
 function csvCells(text){
  var lines=[],row=[],cell='',quoted=false,closed=false;
  text=String(text).replace(/^\ufeff/,'');
  function finish(){row.push(cell);cell='';closed=false;}
  for(var i=0;i<text.length;i++){
   var ch=text[i];
   if(quoted){if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=ch;continue;}
   if(ch==='"'){if(cell!==''||closed)throw Error('CSV 引号格式不完整');quoted=true;}
   else if(ch===','){finish();}
   else if(ch==='\n'||ch==='\r'){finish();if(row.some(function(x){return x!=='';}))lines.push(row);row=[];if(ch==='\r'&&text[i+1]==='\n')i++;}
   else{if(closed)throw Error('CSV 引号后有多余字符');cell+=ch;}
  }
  if(quoted)throw Error('CSV 引号格式不完整');
  if(cell!==''||row.length){finish();if(row.some(function(x){return x!=='';}))lines.push(row);}
  return lines;
 }
 function parseCSV(text){
  var lines=csvCells(text),header=lines.shift()||[],hasUSB=usbColumns.every(function(c){return header.indexOf(c)>=0;});
  if(header.some(function(c,i){return header.indexOf(c)!==i;})||columns.some(function(c){return header.indexOf(c)<0;})||(header.length!==8&&header.length!==12)||(header.length===12&&!hasUSB)||(header.length===8&&hasUSB))throw Error('CSV 表头不完整或有重复字段');
  if(!lines.length)throw Error('CSV 暂无数据记录');
  var indexes=columns.map(function(c){return header.indexOf(c);}),usbIndexes=usbColumns.map(function(c){return header.indexOf(c);}),invalid=0;
  var rows=lines.map(function(cells){
   var r={iso:cells[indexes[0]]||'',status:cells[indexes[7]]||''};
   for(var j=1;j<7;j++)r[columns[j]]=number(cells[indexes[j]]);
   for(var u=0;u<usbColumns.length;u++)r[usbColumns[u]]=hasUSB?number(cells[usbIndexes[u]]):null;
   if(r.usb_online!==0&&r.usb_online!==1)r.usb_online=null;
   usbColumns.slice(1).forEach(function(k){if(r[k]!==null&&r[k]<0)r[k]=null;});
   // A rolling-log upgrade can temporarily pair the extended header with old eight-cell records.
   var rowLengthOK=cells.length===header.length||(hasUSB&&cells.length===8&&columns.every(function(c,i){return header[i]===c;}));
   if(!rowLengthOK||!validIso(r.iso)||r.ts===null||r.ts<=0||!Number.isInteger(r.ts)){r.ts=null;}
   if(r.soc!==null&&(r.soc<0||r.soc>100))r.soc=null;
   if(r.voltage_mv!==null&&r.voltage_mv<=0)r.voltage_mv=null;
   if(!usable(r))invalid++;
   return r;
  });
  return {rows:rows,invalidRows:invalid,hasUSBColumns:hasUSB};
 }
 function usbSample(row,key){
  if(!row||!Number.isFinite(row.ts)||row.ts<=0||row.usb_online!==1||usbColumns.indexOf(key)<=0||!Number.isFinite(row[key])||row[key]<0)return null;
  return row[key];
 }
 function chartSample(row,key){
  if(!row)return null;
  return usbColumns.indexOf(key)>0?usbSample(row,key):Number.isFinite(row[key])?row[key]:null;
 }
 function usbInfo(rows){
  var first=-1;
  for(var i=0;i<rows.length;i++)if(Number.isFinite(rows[i].ts)&&(rows[i].usb_online===0||rows[i].usb_online===1)){first=i;break;}
  var last=rows[rows.length-1],online=last&&Number.isFinite(last.ts)&&(last.usb_online===0||last.usb_online===1)?last.usb_online:null;
  return {first_record_iso:first>=0?rows[first].iso:null,unrecorded_before:first>=0?first:rows.length,latest_online:online};
 }
 function connected(a,b){return a&&b&&a.ts!==null&&b.ts!==null&&Number.isFinite(a.ts)&&Number.isFinite(b.ts)&&b.ts>a.ts&&b.ts-a.ts<=maxGap;}
 function usable(r){return r&&Number.isFinite(r.ts)&&r.ts>0&&['soc','voltage_mv','current_ma','power_w','temp_c'].every(function(k){return Number.isFinite(r[k]);});}
 function kind(r){
  if(!usable(r))return null;
  if(r.status==='Discharging'&&r.power_w<=0.05)return 'discharge';
  if(r.status==='Charging'&&r.power_w>=-0.05)return 'charge';
  return null;
 }
 function corrected(a,b){
  if(!connected(a,b)||!Number.isFinite(a.soc)||!Number.isFinite(b.soc))return false;
  var delta=b.soc-a.soc,k=kind(a);
  if((k==='discharge'&&delta>0.05)||(k==='charge'&&delta< -0.05))return true;
  // Broad anomaly bound uses this gauge's 8780 mAh software scale, not a cell-health measurement.
  var expected=Number.isFinite(a.current_ma)&&Number.isFinite(b.current_ma)?Math.abs((a.current_ma+b.current_ma)/2)*(b.ts-a.ts)/3600/8780*100:0;
  return Math.abs(delta)>Math.max(0.5,expected*3+0.15);
 }
 function seriesSegments(rows,key){
  var out=[],segment=null,previous=null;
  rows.forEach(function(r){
   if(!Number.isFinite(r.ts)||!Number.isFinite(chartSample(r,key))){segment=null;previous=r;return;}
   if(!segment||!connected(previous,r)||(key==='soc'&&corrected(previous,r))){segment=[];out.push(segment);}
   segment.push(r);previous=r;
  });
  return out;
 }
 function summarizeSegments(rows,minSeconds){
  if(minSeconds===undefined)minSeconds=1800;
  var out=[],s=null,prev=null;
  function close(){if(s&&s.duration_s>=minSeconds&&s.count>=2){s.soc_delta=s.soc_corrected?null:s.end_soc-s.start_soc;out.push(s);}s=null;}
  rows.forEach(function(r){
   var k=kind(r);
   if(!k){close();prev=r;return;}
   if(!s||s.kind!==k||!connected(prev,r)){
    close();s={kind:k,start_iso:r.iso,end_iso:r.iso,start_ts:r.ts,end_ts:r.ts,start_soc:r.soc,end_soc:r.soc,duration_s:0,energy_wh:0,count:1,soc_corrected:false};
   }else{
    s.energy_wh+=(prev.power_w+r.power_w)/2*(r.ts-prev.ts)/3600;
    s.soc_corrected=s.soc_corrected||corrected(prev,r);s.duration_s=r.ts-s.start_ts;s.end_ts=r.ts;s.end_iso=r.iso;s.end_soc=r.soc;s.count++;
   }
   prev=r;
  });close();return out;
 }
 function interpolate(a,b,ts){
  var ratio=(ts-a.ts)/(b.ts-a.ts),r={iso:a.iso,status:b.status,ts:ts};
  ['soc','voltage_mv','current_ma','power_w','temp_c'].forEach(function(k){r[k]=a[k]+(b[k]-a[k])*ratio;});return r;
 }
 function estimateRuntime(rows){
  if(!rows.length||kind(rows[rows.length-1])!=='discharge')return null;
  var last=rows[rows.length-1],first=rows.length-1;
  while(first>0&&kind(rows[first-1])==='discharge'&&connected(rows[first-1],rows[first])&&!corrected(rows[first-1],rows[first]))first--;
  var tail=rows.slice(first),duration=last.ts-tail[0].ts;
  if(duration<3600||tail.length<31)return null;
  var start=Math.max(tail[0].ts,last.ts-7200),j=0;
  while(j+1<tail.length&&tail[j+1].ts<=start)j++;
  if(tail[j].ts<start)tail=[interpolate(tail[j],tail[j+1],start)].concat(tail.slice(j+1));else tail=tail.slice(j);
  duration=last.ts-tail[0].ts;var drop=tail[0].soc-last.soc,energy=0;
  for(var i=1;i<tail.length;i++)energy-=(tail[i-1].power_w+tail[i].power_w)/2*(tail[i].ts-tail[i-1].ts)/3600;
  if(drop<0.2||energy<0.05)return null;
  return {duration_s:duration,soc_drop:drop,mean_output_w:energy/(duration/3600),hours_to_20:Math.max(0,(last.soc-20)/(drop/(duration/3600)))};
 }
 function selectRange(rows,hours){
  if(!hours)return rows.slice();
  var end=null;for(var j=rows.length-1;j>=0;j--)if(Number.isFinite(rows[j].ts)){end=rows[j].ts;break;}
  if(end===null)return rows.slice();var start=end-hours*3600,index=-1;
  for(var i=0;i<rows.length;i++)if(Number.isFinite(rows[i].ts)&&rows[i].ts>=start&&rows[i].ts<=end){index=i;break;}
  if(index<0)return [];
  return rows.slice(index).map(function(r){return Number.isFinite(r.ts)&&(r.ts<start||r.ts>end)?Object.assign({},r,{ts:null}):r;});
 }
 function createRefreshController(options){
  var schedule=options.schedule||setTimeout,cancel=options.cancel||clearTimeout,now=options.now||Date.now;
  var visible=options.isVisible||function(){return true;},timer=null,inflight=null,stopped=false;
  var state={busy:false,data:null,error:null,readAt:null,storage:null};
  function publish(){if(options.onState)options.onState(state);}
  function clear(){if(timer!==null){cancel(timer);timer=null;}}
  function later(){clear();if(!stopped&&visible())timer=schedule(function(){timer=null;refresh();},60000);}
  function refresh(){
   if(stopped||!visible())return Promise.resolve(false);if(inflight)return inflight;clear();state.busy=true;state.error=null;publish();
   var operation=(async function(){
    try{
     var loaded=await options.load(),data=parseCSV(typeof loaded==='string'?loaded:loaded.csv);
     if(!stopped){state.data=data;state.storage=typeof loaded==='string'?null:loaded.storage||null;state.readAt=now();state.error=null;if(options.onData)options.onData(data,state.storage);}
    }catch(error){if(!stopped)state.error=error&&error.message||'读取失败';}
    finally{state.busy=false;inflight=null;if(!stopped){publish();later();}}
    return !state.error;
   })();inflight=operation;operation.then(function(){if(inflight===operation)inflight=null;});return operation;
  }
  return {state:state,refresh:refresh,visibilityChanged:function(){clear();if(!stopped&&visible())refresh();},stop:function(){stopped=true;clear();}};
 }
 function mount(doc,win){
  var byId=function(id){return doc.getElementById(id);},data=null,range=24,hover=null,plots=[];
  var fmt=function(n,d){return Number.isFinite(n)?n.toFixed(d):'—';};
  var statusNames={Discharging:'放电',Charging:'充电',Full:'已满', 'Not charging':'未充电'};
  var definitions=[{key:'soc',name:'软件电量',unit:'%',color:'#18ad67',digits:1},{key:'power_w',name:'电池净功率',unit:'W',color:'#327cc1',digits:2},{key:'voltage_mv',name:'电池电压',unit:'V',color:'#b9821d',digits:3,scale:0.001},{key:'temp_c',name:'电池温度',unit:'℃',color:'#a86285',digits:1},{key:'input_voltage_mv',name:'USB 输入电压',unit:'V',color:'#b9821d',digits:3,scale:0.001},{key:'input_current_ma',name:'USB 输入电流',unit:'A',color:'#327cc1',digits:3,scale:0.001},{key:'input_power_w',name:'USB 输入功率',unit:'W',color:'#138a77',digits:2}];
  function write(id,text){var el=byId(id);if(el)el.textContent=text;}
  function chartRows(){return data?selectRange(data.rows,range):[];}
  function draw(){
   var rows=chartRows(),known=rows.filter(function(r){return Number.isFinite(r.ts);});
   var min=known.length?Math.min.apply(null,known.map(function(r){return r.ts;})):0,max=known.length?Math.max.apply(null,known.map(function(r){return r.ts;})):1;if(min===max)max=min+60;
   plots.forEach(function(plot){
    var c=plot.canvas,w=c.clientWidth||300,h=c.clientHeight||190,dpr=Math.min(win.devicePixelRatio||1,2),ctx=c.getContext('2d'),def=plot.def;
    c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);
    var left=42,right=12,top=12,bottom=27,plotW=w-left-right,plotH=h-top-bottom,scale=def.scale||1;
    var values=rows.filter(function(r){return Number.isFinite(r.ts)&&Number.isFinite(chartSample(r,def.key));}).map(function(r){return chartSample(r,def.key)*scale;});
    var lo=values.length?Math.min.apply(null,values):0,hi=values.length?Math.max.apply(null,values):1;
    if(def.key==='power_w'){lo=Math.min(lo,0);hi=Math.max(hi,0);}
    var pad=Math.max((hi-lo)*0.12,def.key==='soc'?1:def.unit==='V'||def.unit==='A'?0.01:0.1);lo-=pad;hi+=pad;if(def.key==='soc'){lo=Math.max(0,lo);hi=Math.min(100,hi);}if(lo===hi)hi=lo+1;
    var px=function(t){return left+(t-min)/(max-min)*plotW;},py=function(v){return top+(hi-v)/(hi-lo)*plotH;};
    ctx.font='10px system-ui,"Microsoft YaHei",sans-serif';ctx.fillStyle='#7b818a';ctx.textAlign='right';ctx.textBaseline='middle';
    for(var n=0;n<4;n++){var y=top+plotH*n/3;ctx.strokeStyle='#e9edeb';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();ctx.fillText((hi-(hi-lo)*n/3).toFixed(def.unit==='V'||def.unit==='A'?2:1),left-7,y);}
    if(def.key==='power_w'&&lo<0&&hi>0){ctx.strokeStyle='#c4ceca';ctx.beginPath();ctx.moveTo(left,py(0));ctx.lineTo(w-right,py(0));ctx.stroke();}
    ctx.save();ctx.beginPath();ctx.rect(left,top,plotW,plotH);ctx.clip();
    seriesSegments(rows,def.key).forEach(function(segment){
     ctx.strokeStyle=def.color;ctx.fillStyle=def.color;ctx.lineWidth=1.8;ctx.beginPath();segment.forEach(function(r,i){var x=px(r.ts),y=py(r[def.key]*scale);if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.stroke();
     if(segment.length===1){ctx.beginPath();ctx.arc(px(segment[0].ts),py(segment[0][def.key]*scale),2,0,Math.PI*2);ctx.fill();}
    });
    if(hover&&Number.isFinite(hover.ts)&&hover.ts>=min&&hover.ts<=max){ctx.strokeStyle='#858e89';ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(px(hover.ts),top);ctx.lineTo(px(hover.ts),top+plotH);ctx.stroke();ctx.setLineDash([]);if(Number.isFinite(chartSample(hover,def.key))){ctx.fillStyle=def.color;ctx.beginPath();ctx.arc(px(hover.ts),py(chartSample(hover,def.key)*scale),3,0,Math.PI*2);ctx.fill();}}
    ctx.restore();ctx.fillStyle='#7b818a';ctx.textBaseline='top';
    [0,0.5,1].forEach(function(f){if(!known.length)return;var t=min+(max-min)*f,nearest=known.reduce(function(a,b){return Math.abs(b.ts-t)<Math.abs(a.ts-t)?b:a;});ctx.textAlign=f===0?'left':f===1?'right':'center';ctx.fillText(nearest.iso.slice(5,16),left+plotW*f,top+plotH+10);});
    var valueRow=hover||data&&data.rows[data.rows.length-1],value=chartSample(valueRow,def.key);if(plot.value)plot.value.textContent=fmt(value===null?null:value*scale,def.digits)+' '+def.unit;
    if(usbColumns.indexOf(def.key)>0&&!values.length){ctx.fillStyle='#737d77';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(data&&!data.hasUSBColumns?'旧数据未记录USB 输入':'该时段无在线有效读数',left+plotW/2,top+plotH/2);}
    c.setAttribute('aria-label',def.name+'历史曲线；'+(known.length?known[0].iso+'至'+known[known.length-1].iso:'暂无有效记录'));
    plot.find=function(clientX){var rect=c.getBoundingClientRect(),t=min+Math.max(0,Math.min(1,(clientX-rect.left-left)/plotW))*(max-min);return known.length?known.reduce(function(a,b){return Math.abs(b.ts-t)<Math.abs(a.ts-t)?b:a;}):null;};
   });
   var selected=hover||data&&data.rows[data.rows.length-1],online=selected&&Number.isFinite(selected.ts)?selected.usb_online:null,usbState=online===1?'已连接':online===0?'未连接':'未知 / 未记录';
   write('usb-status',(hover?'选中记录 · ':'最后记录 · ')+usbState);
   var statusEl=byId('usb-status');if(statusEl)statusEl.classList.toggle('usb-online',online===1);
   write('cursor-time',hover?'选中记录 '+hover.iso:'轻触曲线查看同一时刻的电池与USB 输入数值');
  }
  function storageText(s){
   if(!s){write('storage','缓存用量暂不可读');return;}
   var percent=number(s.cache_percent),limit=number(s.limit_percent),bytes=number(s.log_bytes);
   var message='缓存 '+fmt(percent,1)+'% / 上限 '+fmt(limit,0)+'% · 日志 '+(bytes===null?'—':(bytes/1024).toFixed(0)+' KiB')+' · 最多8000条 / 1 MiB';
   if(s.logging_paused===true)message+='。历史记录暂停，实时页继续可用';
   if(s.checkpoint_paused===true)message+='。持久检查点暂停';
   write('storage',message);byId('storage').classList.toggle('pressure',s.logging_paused===true||s.checkpoint_paused===true);
  }
  function render(newData,storage){
   data=newData;hover=null;var rows=data.rows,last=rows[rows.length-1],known=rows.filter(function(r){return Number.isFinite(r.ts);}),first=known[0];
   write('last-time','记录截至 '+(last.ts!==null?last.iso:'—（末条时间无效）'));
   write('latest-soc',fmt(last.soc,1)+'%');write('latest-status',statusNames[last.status]||'状态未知');
   var usb=usbInfo(rows),usbCoverage;
   if(usb.first_record_iso)usbCoverage='本日志首条 USB 输入记录：'+usb.first_record_iso+(usb.unrecorded_before?' · 此前 '+usb.unrecorded_before.toLocaleString()+' 条旧记录未记录USB 输入':'');
   else usbCoverage=data.hasUSBColumns?'本日志暂无USB 输入记录；空白值表示未知或未记录，不表示未连接。':'旧数据未记录USB 输入；本日志尚无USB 输入记录。';
   write('usb-coverage',usbCoverage);
   write('coverage',(first?first.iso:'—')+' — '+(last.ts!==null?last.iso:'—')+' · '+rows.length.toLocaleString()+' 条');
   var gaps=0;for(var i=1;i<rows.length;i++)if(!connected(rows[i-1],rows[i]))gaps++;
   write('quality','断线处不连接：超过120秒的缺口、逆序或无效读数；软件电量校正不作为充电依据。'+(data.invalidRows?' '+data.invalidRows+' 条含无效读数。':'')+(gaps?' '+gaps+' 处时间中断。':''));
   var runtime=estimateRuntime(rows);
   write('runtime',runtime?fmt(runtime.hours_to_20,1)+' 小时':'—');
   write('runtime-note',runtime?'截至该条记录，按最近 '+Math.round(runtime.duration_s/60)+' 分钟的负载，下降 '+fmt(runtime.soc_drop/(runtime.duration_s/3600),2)+' 个百分点/小时；未来负载变化会改变结果。':'需要最近至少1小时连续、有效且无电量校正的放电数据；最多取2小时。');
   var body=byId('segments');while(body.firstChild)body.removeChild(body.firstChild);
   var summaries=summarizeSegments(rows).slice(-12).reverse();
   if(!summaries.length){var tr=doc.createElement('tr'),td=doc.createElement('td');td.colSpan=5;td.textContent='暂无至少30分钟的连续充放电记录';tr.appendChild(td);body.appendChild(tr);}
   summaries.forEach(function(s){
    var tr=doc.createElement('tr'),hours=s.duration_s/3600,cellTexts=[s.kind==='discharge'?'放电':'充电',s.start_iso.slice(5,16)+' → '+s.end_iso.slice(5,16),hours.toFixed(2)+' h',Math.abs(s.energy_wh).toFixed(2)+' Wh',s.soc_corrected?'含软件校正':(s.soc_delta>=0?'+':'')+s.soc_delta.toFixed(2)+'%'];
    cellTexts.forEach(function(text){var td=doc.createElement('td');td.textContent=text;tr.appendChild(td);});body.appendChild(tr);
   });storageText(storage);draw();
  }
  definitions.forEach(function(def){
   var canvas=byId('chart-'+def.key);if(!canvas)return;var plot={def:def,canvas:canvas,value:byId('value-'+def.key)};plots.push(plot);
   canvas.addEventListener('pointermove',function(event){hover=plot.find?plot.find(event.clientX):null;draw();});
   canvas.addEventListener('pointerdown',function(event){hover=plot.find?plot.find(event.clientX):null;draw();});
   canvas.addEventListener('pointerleave',function(){hover=null;draw();});
  });
  doc.querySelectorAll('[data-hours]').forEach(function(button){button.addEventListener('click',function(){range=Number(button.getAttribute('data-hours'));hover=null;doc.querySelectorAll('[data-hours]').forEach(function(b){b.setAttribute('aria-pressed',String(b===button));});draw();});});
  async function request(url,type){
   var abort=new win.AbortController(),timer=win.setTimeout(function(){abort.abort();},15000);
   try{var response=await win.fetch(url,{cache:'no-store',signal:abort.signal});if(!response.ok)throw Error('HTTP '+response.status);return await response[type]();}finally{win.clearTimeout(timer);}
  }
  var controller=createRefreshController({isVisible:function(){return !doc.hidden;},load:async function(){var csv=await request('./battery-log.csv','text'),storage=null;try{storage=await request('/storage.json','json');}catch(error){}return {csv:csv,storage:storage};},onData:render,onState:function(s){
   byId('refresh').disabled=s.busy;byId('refresh').textContent=s.busy?'刷新中…':'刷新';
   var end=s.data&&s.data.rows[s.data.rows.length-1],message;
   if(s.error)message=s.data?'刷新失败 · 仍显示截至 '+(end.ts!==null?end.iso:'未知时间')+' 的旧记录':'日志读取失败，请稍后刷新或下载CSV';
   else if(s.busy)message=s.data?'正在刷新，仍显示已读取的记录':'正在读取CSV日志…';
   else message='已读取日志 · 可见页面每60秒刷新';
   write('connection',message);byId('connection').classList.toggle('failed',Boolean(s.error));
  }});
  byId('refresh').addEventListener('click',function(){controller.refresh();});
  doc.addEventListener('visibilitychange',function(){controller.visibilityChanged();});win.addEventListener('pageshow',function(event){if(event.persisted)controller.visibilityChanged();});
  var pendingResize=false;function redraw(){if(pendingResize)return;pendingResize=true;win.requestAnimationFrame(function(){pendingResize=false;draw();});}
  win.addEventListener('resize',redraw);if(win.ResizeObserver){var observer=new win.ResizeObserver(redraw);plots.forEach(function(p){observer.observe(p.canvas);});}
  draw();controller.refresh();return controller;
 }
 return {parseCSV:parseCSV,usbSample:usbSample,usbInfo:usbInfo,seriesSegments:seriesSegments,summarizeSegments:summarizeSegments,estimateRuntime:estimateRuntime,selectRange:selectRange,createRefreshController:createRefreshController,mount:mount};
});
