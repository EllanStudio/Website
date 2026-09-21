(() => {
  'use strict';
  const $=s=>document.querySelector(s), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon=name=>`<i data-lucide="${name}" aria-hidden="true"></i>`;
  const icons=()=>window.lucide?.createIcons();
  let data,revision,token,saved,history=[],cursor=0,selected=0,section='articles',assets=[],assetKind='media',assetPage=0;
  let previewTimer,historyTimer,toastTimer,previewVersion=0,previewBusy=false,requestedPreview=null,pinHome=false,saving=false;
  const current=()=>data[section]?.[selected];
  const snapshot=()=>JSON.stringify(data);
  const dirty=()=>data && snapshot()!==saved;
  function notice(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4500);}
  function error(message){$('#error').hidden=!message;$('#error').textContent=message;}
  async function api(url,payload,raw=false){
    const options=payload===undefined?{}:{method:'POST',headers:{'X-Editor-Token':token,'Content-Type':raw?'application/octet-stream':'application/json'},body:raw?payload:JSON.stringify(payload)};
    const response=await fetch(url,options), result=await response.json();
    if(!response.ok) throw new Error(result.error || '操作失败'); return result;
  }
  function status(){
    $('#save-status').textContent=saving?'正在保存…':dirty()?'有未保存的修改':'已与工程同步';
    $('#save').disabled=!dirty()||saving;$('#undo').disabled=cursor===0;$('#redo').disabled=cursor===history.length-1;
  }
  function checkpoint(){clearTimeout(historyTimer);const s=snapshot();if(history[cursor]===s)return;history=history.slice(0,cursor+1);history.push(s);if(history.length>60)history.shift();cursor=history.length-1;status();}
  function changed(immediate=false){error('');status();clearTimeout(historyTimer);if(immediate)checkpoint();else historyTimer=setTimeout(checkpoint,550);renderList();schedulePreview();}
  function options(items,value,key='id',label='title'){return items.map(a=>`<option value="${esc(a[key])}" ${a[key]===value?'selected':''}>${esc(a[label])}</option>`).join('');}
  function field(label,key,value,{area=false,select=null,type='text'}={}) {
    const control=select?`<select data-field="${key}">${select}</select>`:area?`<textarea data-field="${key}" rows="3">${esc(value)}</textarea>`:`<input type="${type}" data-field="${key}" value="${esc(value)}">`;
    return `<label>${label}${control}</label>`;
  }
  function pairRows(key,title,labels){
    return `<section class="field-section"><h2>${title}</h2><div data-pairs="${key}">${(current()[key]||[]).map((pair,i)=>`<div class="pair" data-pair="${key}" data-index="${i}"><div class="pair-head"><span class="drag-handle" draggable="true" title="拖动调整顺序">${icon('grip-vertical')} ${i+1}</span><button type="button" class="icon-button" data-move="${key}" data-index="${i}" data-direction="-1" title="上移" aria-label="上移${title}${i+1}" ${i===0?'disabled':''}>${icon('arrow-up')}</button><button type="button" class="icon-button" data-move="${key}" data-index="${i}" data-direction="1" title="下移" aria-label="下移${title}${i+1}" ${i===current()[key].length-1?'disabled':''}>${icon('arrow-down')}</button><button type="button" class="icon-button danger" data-remove="${key}" data-index="${i}" title="删除这一项" aria-label="删除${title}${i+1}">${icon('x')}</button></div><label>${labels[0]}<input data-pair-key="${key}" data-index="${i}" data-part="0" value="${esc(pair[0])}"></label><label>${labels[1]}<textarea data-pair-key="${key}" data-index="${i}" data-part="1" rows="3">${esc(pair[1])}</textarea></label></div>`).join('')}</div><button type="button" class="add-row" data-add-pair="${key}">${icon('plus')}添加${title}</button></section>`;
  }
  function mediaBox(kind){const a=current(),src=kind==='cover'?'img/'+a.image:a.media.src;
    const visual=src?(/\.(mp4|webm)$/i.test(src)?`<video src="/preview/${esc(src)}" controls preload="metadata"></video>`:`<img src="/preview/${esc(src)}" alt="${kind==='cover'?'封面':'演示'}预览">`):'<p>选择文件，或拖入图片、GIF、视频</p>';
    return `<div class="media-box" data-drop-media="${kind}">${visual}<div class="media-actions"><button type="button" data-choose="${kind}">${icon('images')}媒体库</button><button type="button" data-upload="${kind}">${icon('upload')}导入文件</button>${kind==='media'&&src?`<button type="button" data-clear-media>${icon('x')}移除</button>`:''}</div><small class="media-path">${esc(src || '尚未添加演示')}</small></div>`;
  }
  function renderList(){
    const q=$('#filter').value.trim().toLowerCase();
    if(section==='featured'){$('#entries').innerHTML='<p class="empty">首页“今天，想做点什么？”中的教程顺序。</p>';$('#add').hidden=true;return;}
    $('#add').hidden=false;$('#add span').textContent={articles:'新增教程',commands:'新增命令',categories:'新增分类'}[section];
    $('#entries').innerHTML=data[section].map((a,i)=>({a,i})).filter(({a})=>JSON.stringify(a).toLowerCase().includes(q)).map(({a,i})=>`<button type="button" data-entry="${i}" class="${i===selected?'selected':''}" ${i===selected?'aria-current="true"':''}><strong>${esc(a.title||a.label||'未命名')}</strong><small>${esc(section==='articles'?data.categories.find(c=>c.id===a.category)?.title:section==='commands'?a.command:a.id)}</small></button>`).join('');
  }
  function render(){
    renderList();$('#delete').hidden=section==='featured'||!current();
    const a=current();
    if(section==='featured') {
      $('#entry-id').textContent='HOME';$('#entry-title').textContent='首页推荐教程';
      $('#fields').innerHTML=data.featured.map((id,i)=>`<div class="featured-row"><span>${esc(data.articles.find(a=>a.id===id)?.title||id)}</span><button type="button" class="icon-button" data-feature-move="${i}" data-direction="-1" title="上移" ${i===0?'disabled':''}>${icon('arrow-up')}</button><button type="button" class="icon-button" data-feature-move="${i}" data-direction="1" title="下移" ${i===data.featured.length-1?'disabled':''}>${icon('arrow-down')}</button><button type="button" class="icon-button danger" data-feature-remove="${i}" title="移出推荐">${icon('x')}</button></div>`).join('')+`<label>添加推荐<select id="feature-add"><option value="">选择教程…</option>${options(data.articles.filter(a=>!data.featured.includes(a.id)),'')}</select></label>`;
    } else if(!a) {$('#entry-id').textContent='';$('#entry-title').textContent='暂无内容';$('#fields').innerHTML='';}
    else if(section==='articles') {
      $('#entry-id').textContent=a.id;$('#entry-title').textContent=a.title;
      $('#fields').innerHTML=field('教程名称','title',a.title)+field('所属分类','category',a.category,{select:options(data.categories,a.category)})+field('简短介绍','summary',a.summary,{area:true})+field('小标签','tag',a.tag)+field('搜索关键词','keywords',a.keywords)+
      `<section class="field-section"><h2>封面配图</h2>${mediaBox('cover')}</section>`+
      `<section class="field-section"><h2>上手准备</h2>${field('去哪里','where',a.where)}${field('准备什么','prepare',a.prepare)}${field('完成后','result',a.result)}</section>`+
      pairRows('steps','操作步骤',['步骤标题','具体操作'])+field('注意事项','caution',a.caution||'',{area:true})+field('可复制的提问模板（可留空）','helpTemplate',a.helpTemplate||'',{area:true})+pairRows('details','补充说明',['问题 / 小标题','说明'])+
      `<section class="field-section"><h2>操作演示</h2>${mediaBox('media')}${field('演示说明','media.caption',a.media.caption)}</section>`+
      field('可复制的命令（可留空）','command',a.command||'')+`<label><input type="checkbox" data-field="planned" ${a.planned?'checked':''}>此玩法还在开发中</label>`+
      `<label><input type="checkbox" id="featured-check" ${data.featured.includes(a.id)?'checked':''}>推荐到手册首页</label>`+
      `<section class="field-section"><h2>相关教程</h2><div class="related-list">${data.articles.filter(b=>b.id!==a.id).map(b=>`<label><input type="checkbox" data-related="${esc(b.id)}" ${a.related.includes(b.id)?'checked':''}>${esc(b.title)}</label>`).join('')}</div></section>`+pairRows('sources','参考链接',['链接名称','网址']);
    } else if(section==='commands') {
      $('#entry-id').textContent='COMMAND';$('#entry-title').textContent=a.label;
      $('#fields').innerHTML=field('命令名称','label',a.label)+field('命令','command',a.command)+field('所属分组','group',a.group)+field('补充说明','note',a.note,{area:true})+field('关联教程','related',a.related,{select:options(data.articles,a.related)});
    } else {
      $('#entry-id').textContent=a.id;$('#entry-title').textContent=a.title;
      $('#fields').innerHTML=field('分类名称','title',a.title)+field('分类介绍','intro',a.intro,{area:true})+field('分类图标','icon',a.icon,{select:['footprints','coins','sprout','swords','coffee','circle-help','book-open','compass','cooking-pot','fish','house','scroll-text'].map(v=>`<option ${a.icon===v?'selected':''}>${v}</option>`).join('')});
    }
    icons();status();schedulePreview();
  }
  function route(){if(pinHome||section==='featured')return '#home';if(section==='commands')return '#commands';if(section==='categories')return '#category-'+(current()?.id||'all');return '#guide-'+(current()?.id||'first-login');}
  function schedulePreview(){clearTimeout(previewTimer);const version=++previewVersion;previewTimer=setTimeout(()=>{requestedPreview={data:JSON.parse(snapshot()),route:route(),version};updatePreview();},450);}
  async function updatePreview(){
    if(previewBusy||!requestedPreview)return;previewBusy=true;const request=requestedPreview;requestedPreview=null;
    try {
      $('#preview-status').textContent='更新中…';await api('/api/preview',{data:request.data});
      if(request.version===previewVersion){const frame=$('#preview'),next='/preview/wiki.html?editor='+Date.now()+request.route;let scroll=0;try{if(frame.contentWindow.location.hash===request.route)scroll=frame.contentWindow.scrollY;}catch{}
        frame.onload=()=>{if(request.version!==previewVersion)return;try{frame.contentWindow.scrollTo(0,scroll);}catch{}$('#preview-status').textContent='已更新';};frame.src=next;
      }
    }catch(e){$('#preview-status').textContent='待补全内容';$('#preview-status').title=e.message;}
    finally{previewBusy=false;if(requestedPreview)updatePreview();}
  }
  async function load(){const result=await api('/api/state');data=result.data;token=result.token;revision=result.revision;saved=snapshot();history=[saved];cursor=0;selected=Math.min(selected,Math.max(0,(data[section]?.length||1)-1));assets=(await api('/api/assets')).files;error('');render();}
  $('#fields').addEventListener('submit',e=>e.preventDefault());
  $('#fields').addEventListener('input',e=>{
    const t=e.target,a=current();if(!a)return;
    if(t.dataset.field){if(t.dataset.field==='media.caption')a.media.caption=t.value;else a[t.dataset.field]=t.type==='checkbox'?t.checked:t.value;if(t.dataset.field==='title'||t.dataset.field==='label')$('#entry-title').textContent=t.value;changed();}
    else if(t.dataset.pairKey){a[t.dataset.pairKey][Number(t.dataset.index)][Number(t.dataset.part)]=t.value;changed();}
    else if(t.dataset.related){a.related=t.checked?[...a.related,t.dataset.related]:a.related.filter(id=>id!==t.dataset.related);changed(true);}
    else if(t.id==='featured-check'){data.featured=t.checked?[...data.featured,a.id]:data.featured.filter(id=>id!==a.id);changed(true);}
  });
  $('#fields').addEventListener('change',e=>{if(e.target.id==='feature-add'&&e.target.value){data.featured.push(e.target.value);changed(true);render();}});
  $('#entries').addEventListener('click',e=>{const b=e.target.closest('[data-entry]');if(!b)return;checkpoint();selected=Number(b.dataset.entry);pinHome=false;render();$('.editor').scrollTop=0;});
  $('#filter').addEventListener('input',renderList);
  $('#section').addEventListener('change',()=>{checkpoint();section=$('#section').value;selected=0;pinHome=false;render();$('.editor').scrollTop=0;});
  function reorder(key,from,to){const list=key==='featured'?data.featured:current()[key];if(to<0||to>=list.length)return;list.splice(to,0,list.splice(from,1)[0]);changed(true);render();}
  $('#fields').addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;const d=b.dataset;
    if(d.addPair){(current()[d.addPair]??=[]).push(['','']);changed(true);render();}
    else if(d.remove){current()[d.remove].splice(Number(d.index),1);changed(true);render();}
    else if(d.move)reorder(d.move,Number(d.index),Number(d.index)+Number(d.direction));
    else if(d.featureMove!==undefined)reorder('featured',Number(d.featureMove),Number(d.featureMove)+Number(d.direction));
    else if(d.featureRemove!==undefined){data.featured.splice(Number(d.featureRemove),1);changed(true);render();}
    else if(d.choose){assetKind=d.choose;assetPage=0;$('#asset-filter').value='';renderAssets();$('#asset-dialog').showModal();}
    else if(d.upload)chooseUpload(d.upload);
    else if(b.hasAttribute('data-clear-media')){current().media.src='';changed(true);render();}
  });
  let dragging=null;
  $('#fields').addEventListener('dragstart',e=>{const handle=e.target.closest('.drag-handle'),row=handle?.closest('[data-pair]');if(!row)return;dragging={key:row.dataset.pair,index:Number(row.dataset.index)};e.dataTransfer.setData('text/plain','step');e.dataTransfer.effectAllowed='move';row.classList.add('dragging');});
  $('#fields').addEventListener('dragover',e=>{const row=e.target.closest('[data-pair]'),box=e.target.closest('[data-drop-media]');if((dragging&&row?.dataset.pair===dragging.key)||box){e.preventDefault();(box||row).classList.add('over');}});
  $('#fields').addEventListener('dragleave',e=>e.target.closest('.over')?.classList.remove('over'));
  $('#fields').addEventListener('dragend',()=>{dragging=null;document.querySelectorAll('.over,.dragging').forEach(el=>el.classList.remove('over','dragging'));});
  $('#fields').addEventListener('drop',e=>{const row=e.target.closest('[data-pair]'),box=e.target.closest('[data-drop-media]');if(box&&e.dataTransfer.files.length){e.preventDefault();upload(e.dataTransfer.files[0],box.dataset.dropMedia);box.classList.remove('over');}else if(dragging&&row?.dataset.pair===dragging.key){e.preventDefault();reorder(dragging.key,dragging.index,Number(row.dataset.index));dragging=null;}});
  function renderAssets(){const q=$('#asset-filter').value.toLowerCase(),list=assets.filter(p=>(assetKind!=='cover'||! /\.(mp4|webm)$/i.test(p))&&p.toLowerCase().includes(q)),pages=Math.max(1,Math.ceil(list.length/40));assetPage=Math.min(assetPage,pages-1);$('#asset-list').innerHTML=list.slice(assetPage*40,assetPage*40+40).map(src=>`<button type="button" data-asset="${esc(src)}" title="${esc(src)}">${/\.(mp4|webm)$/i.test(src)?icon('film'):`<img src="/preview/${esc(src)}" alt="" loading="lazy">`}<span>${esc(src.slice(4))}</span></button>`).join('')||'<p class="empty">没有匹配的文件</p>';$('#asset-count').textContent=`${list.length} 个文件 · ${assetPage+1} / ${pages}`;$('#asset-prev').disabled=assetPage===0;$('#asset-next').disabled=assetPage>=pages-1;icons();}
  $('#asset-filter').addEventListener('input',()=>{assetPage=0;renderAssets();});$('#asset-prev').onclick=()=>{assetPage--;renderAssets();};$('#asset-next').onclick=()=>{assetPage++;renderAssets();};
  $('#asset-list').onclick=e=>{const b=e.target.closest('[data-asset]');if(!b)return;assignMedia(current(),assetKind,b.dataset.asset);$('#asset-dialog').close();};
  function assignMedia(article,kind,src){if(kind==='cover')article.image=src.slice(4);else article.media.src=src;changed(true);render();}
  function chooseUpload(kind){assetKind=kind;$('#file').accept=kind==='cover'?'image/png,image/jpeg,image/webp,image/gif':'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm';$('#file').value='';$('#file').click();}
  $('#upload-dialog').onclick=()=>chooseUpload(assetKind);
  $('#file').onchange=()=>{if($('#file').files[0])upload($('#file').files[0],assetKind);};
  async function upload(file,kind){const article=current();try{if(file.size>100*1024*1024)throw new Error('文件不能超过 100 MB');if(kind==='cover'&&!file.type.startsWith('image/'))throw new Error('封面请选择图片');notice('正在导入 '+file.name);const result=await api('/api/upload',file,true);if(!assets.includes(result.src))assets.push(result.src);assignMedia(article,kind,result.src);$('#asset-dialog').close();notice('媒体已导入，保存后用于官网内容');}catch(e){error(e.message);notice(e.message);}}
  $('#save').onclick=async()=>{checkpoint();const next=JSON.parse(snapshot()),snapshotToSave=JSON.stringify(next);saving=true;status();try{const result=await api('/api/save',{data:next,revision});revision=result.revision;saved=snapshotToSave;error('');notice(result.backup?'已保存，旧版本已自动备份':'已保存');}catch(e){error(e.message);}finally{saving=false;status();}};
  $('#undo').onclick=()=>{checkpoint();if(cursor>0){data=JSON.parse(history[--cursor]);selected=Math.min(selected,Math.max(0,(data[section]?.length||1)-1));render();}};
  $('#redo').onclick=()=>{if(cursor<history.length-1){data=JSON.parse(history[++cursor]);selected=Math.min(selected,Math.max(0,(data[section]?.length||1)-1));render();}};
  $('#reload').onclick=async()=>{if(dirty()&&!confirm('放弃未保存的修改，重新读取工程？'))return;try{await load();notice('已重新读取工程');}catch(e){error(e.message);}};
  $('#export').onclick=()=>{const url=URL.createObjectURL(new Blob(['window.ELLAN_WIKI = '+JSON.stringify(data,null,2)+';\n'],{type:'text/javascript;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='wiki-data-draft.js';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  $('#add').onclick=()=>{
    checkpoint();if(section==='articles'){$('#new-form').reset();$('#new-form select').innerHTML=options(data.categories,data.categories[0]?.id);$('#new-dialog').showModal();return;}
    if(section==='commands')data.commands.push({group:'常用功能',command:'/new-command',label:'新命令',note:'',related:data.articles[0].id});
    else data.categories.push({id:'category-'+Date.now(),title:'新分类',intro:'',icon:'book-open'});
    selected=data[section].length-1;changed(true);render();
  };
  $('#new-form').onsubmit=e=>{e.preventDefault();const values=Object.fromEntries(new FormData(e.target));if(data.articles.some(a=>a.id===values.id)){notice('链接 ID 已存在');return;}data.articles.push({id:values.id,title:values.title,category:values.category,summary:'',tag:'新教程',keywords:'',image:data.articles[0]?.image||'hero-world-hd.webp',where:'',prepare:'',result:'',steps:[['','']],details:[],related:[],media:{src:'',caption:'操作演示'}});selected=data.articles.length-1;$('#new-dialog').close();changed(true);render();};
  $('#delete').onclick=()=>{const a=current();if(!a)return;if(section==='categories'&&data.articles.some(b=>b.category===a.id)){notice('请先把该分类的教程移动到其他分类');return;}if(section==='articles'&&data.commands.some(c=>c.related===a.id)){notice('请先修改关联到这篇教程的常用命令');return;}if(!confirm(`从当前草稿删除“${a.title||a.label}”？保存前可以撤销。`))return;checkpoint();if(section==='articles'){data.featured=data.featured.filter(id=>id!==a.id);data.articles.forEach(b=>b.related=b.related.filter(id=>id!==a.id));}data[section].splice(selected,1);selected=Math.max(0,selected-1);changed(true);render();};
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.close).close());
  $('#desktop').onclick=()=>{$('#preview').classList.remove('phone');$('#desktop').classList.add('selected');$('#mobile').classList.remove('selected');};
  $('#mobile').onclick=()=>{$('#preview').classList.add('phone');$('#mobile').classList.add('selected');$('#desktop').classList.remove('selected');};
  $('#preview-home').onclick=()=>{pinHome=!pinHome;$('#preview-home').classList.toggle('selected',pinHome);schedulePreview();};
  window.addEventListener('beforeunload',e=>{if(dirty()){e.preventDefault();e.returnValue='';}});
  document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();if(!$('#save').disabled)$('#save').click();}});
  icons();load().catch(e=>{error(e.message);$('#save-status').textContent='读取失败';});
})();
