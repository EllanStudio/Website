import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
export const project = path.resolve(here, '../..');
const hash = b => createHash('sha256').update(b).digest('hex');
export const serialize = data => '/* Edited with the local Ellan Wiki editor. */\nwindow.ELLAN_WIKI = ' + JSON.stringify(data, null, 2) + ';\n';
export function parse(source) {
  const context = { window: {} };
  vm.runInNewContext(source, context, { timeout: 1000, contextCodeGeneration: { strings: false, wasm: false } });
  return JSON.parse(JSON.stringify(context.window.ELLAN_WIKI));
}
function inside(root, relative) {
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('文件路径超出工程范围');
  return target;
}
async function localFile(root, relative) {
  const candidate = inside(root, relative);
  const real = await fs.realpath(candidate);
  inside(root, path.relative(root, real));
  if (!(await fs.stat(real)).isFile()) throw new Error('文件不存在');
  return real;
}
const extensions = new Set(['.png','.jpg','.jpeg','.webp','.gif','.mp4','.webm']);
export async function validate(data, webRoot) {
  const errors = [];
  if (!data || !['articles','categories','commands','featured'].every(k => Array.isArray(data[k]))) return ['内容格式不完整'];
  const text = (v,label,required=false) => { if (typeof v !== 'string' || (required && !v.trim())) errors.push(`${label}需要填写文字`); };
  const unique = (items,label) => {
    const ids = new Set();
    for (const item of items) {
      if (!item || typeof item !== 'object' || !/^[a-z][a-z0-9-]*$/.test(item.id)) { errors.push(`${label} ID 只能使用小写字母、数字和短横线`); continue; }
      if (ids.has(item.id)) errors.push(`${label} ID 重复：${item.id}`);
      ids.add(item.id);
    }
    return ids;
  };
  const cats = unique(data.categories,'分类'), ids = unique(data.articles,'教程');
  for (const c of data.categories) { if (!c) continue; text(c.title,'分类名称',true); text(c.intro,'分类简介'); }
  const checkFile = async (value,label,imageOnly=false) => {
    if (typeof value !== 'string' || !value.startsWith('img/') || !extensions.has(path.extname(value).toLowerCase()) || (imageOnly && /\.(mp4|webm)$/i.test(value))) { errors.push(`${label}请选择图片或媒体文件`); return; }
    try { await localFile(webRoot,value); } catch { errors.push(`${label}文件不存在：${value}`); }
  };
  for (const a of data.articles) {
    if (!a) continue;
    const label = a.title || a.id || '教程';
    for (const k of ['title','summary','where','prepare','result','keywords','tag']) text(a[k],`${label}：${k}`,true);
    if (!cats.has(a.category)) errors.push(`${label}的分类不存在`);
    if (!Array.isArray(a.steps) || !a.steps.length) errors.push(`${label}至少需要一个步骤`);
    for (const group of ['steps','details','sources']) {
      if (a[group] !== undefined && !Array.isArray(a[group])) { errors.push(`${label}的${group}格式错误`); continue; }
      for (const pair of a[group] || []) {
        if (!Array.isArray(pair) || pair.length !== 2 || pair.some(v => typeof v !== 'string' || !v.trim())) errors.push(`${label}有未填写完整的${group}`);
        if (group === 'sources' && !/^https?:\/\//i.test(pair?.[1])) errors.push(`${label}的参考链接应以 https:// 开头`);
      }
    }
    if (!Array.isArray(a.related) || a.related.some(id => !ids.has(id) || id === a.id)) errors.push(`${label}的相关教程不存在或引用了自己`);
    for (const k of ['command','caution']) if (a[k] !== undefined) text(a[k],`${label}：${k}`);
    await checkFile('img/' + a.image,`${label}封面`,true);
    if (!a.media || typeof a.media.src !== 'string') errors.push(`${label}的演示媒体格式错误`);
    else { text(a.media.caption,`${label}演示说明`,true); if (a.media.src) await checkFile(a.media.src,`${label}演示`); }
  }
  if (data.featured.some(id => !ids.has(id)) || new Set(data.featured).size !== data.featured.length) errors.push('首页推荐教程有重复或失效引用');
  const commands = new Set();
  for (const c of data.commands) {
    if (!c) { errors.push('命令格式错误'); continue; }
    for (const k of ['group','command','label','note']) text(c[k],`命令${c.command || ''}：${k}`,k !== 'note');
    if (!c.command?.startsWith('/')) errors.push('命令需要以 / 开头');
    if (commands.has(c.command)) errors.push(`命令重复：${c.command}`);
    commands.add(c.command);
    if (!ids.has(c.related)) errors.push(`命令 ${c.command} 对应的教程不存在`);
  }
  return errors;
}
async function body(req, max=3*1024*1024) {
  const chunks=[]; let size=0;
  for await (const chunk of req) { size+=chunk.length; if (size>max) throw Object.assign(new Error('文件过大，媒体上限为 100 MB'),{status:413}); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
function mediaType(b) {
  if (b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return '.png';
  if (b[0]===255 && b[1]===216 && b[2]===255) return '.jpg';
  if (/^GIF8[79]a$/.test(b.toString('ascii',0,6))) return '.gif';
  if (b.toString('ascii',0,4)==='RIFF' && b.toString('ascii',8,12)==='WEBP') return '.webp';
  if (b.toString('ascii',4,8)==='ftyp') return '.mp4';
  if (b.subarray(0,4).equals(Buffer.from([26,69,223,163]))) return '.webm';
  throw new Error('仅支持 PNG、JPG、WebP、GIF、MP4 或 WebM 文件');
}
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.mp4':'video/mp4','.webm':'video/webm','.woff2':'font/woff2','.svg':'image/svg+xml'};

export async function createEditor({root=project}={}) {
  const webRoot=await fs.realpath(path.join(root,'website'));
  const dataFile=path.join(webRoot,'js/wiki-data.js');
  const stateDir=path.join(root,'.local/wiki-editor');
  const token=randomBytes(32).toString('hex');
  let draft=parse(await fs.readFile(dataFile,'utf8')), writing=false;
  const json=(res,status,value) => { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(value)); };
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Referrer-Policy','same-origin');
    try {
      const origin=`http://127.0.0.1:${server.address().port}`;
      if (req.headers.host !== new URL(origin).host || (req.headers['sec-fetch-site']==='cross-site')) return json(res,403,{error:'仅允许本机编辑器访问'});
      const url=new URL(req.url,origin), route=decodeURIComponent(url.pathname);
      if (req.method==='POST' && (req.headers.origin!==origin || req.headers['x-editor-token']!==token)) return json(res,403,{error:'请从编辑器页面执行此操作'});
      if (req.method==='GET' && route==='/api/health') return json(res,200,{app:'ellan-wiki-editor',root});
      if (req.method==='GET' && route==='/api/state') { const source=await fs.readFile(dataFile,'utf8'); return json(res,200,{data:parse(source),revision:hash(source),token,root}); }
      if (req.method==='GET' && route==='/api/assets') {
        const files=[];
        async function walk(dir) { for (const e of await fs.readdir(dir,{withFileTypes:true})) { if(e.isSymbolicLink()) continue; const p=path.join(dir,e.name); if(e.isDirectory()) await walk(p); else if(extensions.has(path.extname(p).toLowerCase())) files.push(path.relative(webRoot,p).split(path.sep).join('/')); } }
        await walk(path.join(webRoot,'img')); return json(res,200,{files});
      }
      if (req.method==='POST' && ['/api/preview','/api/save'].includes(route)) {
        const payload=JSON.parse((await body(req)).toString('utf8'));
        const errors=await validate(payload.data,webRoot);
        if(errors.length) return json(res,422,{error:errors.slice(0,10).join('\n'),errors});
        if (route==='/api/preview') { draft=payload.data; return json(res,200,{ok:true}); }
        if(writing) return json(res,409,{error:'正在保存，请稍后再试'});
        writing=true;
        try {
          const previous=await fs.readFile(dataFile,'utf8');
          if(hash(previous)!==payload.revision) return json(res,409,{error:'文件已被其他工具修改。请先导出当前草稿，再重新读取磁盘版本。'});
          const next=serialize(payload.data);
          let backup=null;
          if(next!==previous) {
            const dir=path.join(stateDir,'backups'); await fs.mkdir(dir,{recursive:true});
            backup=path.join(dir,`wiki-data-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomBytes(3).toString('hex')}.js`);
            await fs.writeFile(backup,previous,{flag:'wx'});
            const tmp=dataFile+'.'+randomBytes(6).toString('hex')+'.tmp';
            try { await fs.writeFile(tmp,next,{flag:'wx'}); await fs.rename(tmp,dataFile); } finally { await fs.rm(tmp,{force:true}); }
          }
          draft=payload.data; return json(res,200,{ok:true,revision:hash(next),backup});
        } finally { writing=false; }
      }
      if(req.method==='POST' && route==='/api/upload') {
        const bytes=await body(req,100*1024*1024), ext=mediaType(bytes);
        const name=`media-${hash(bytes).slice(0,20)}${ext}`, dir=path.join(webRoot,'img/wiki');
        await fs.mkdir(dir,{recursive:true});
        const target=inside(webRoot,path.relative(webRoot,await fs.realpath(dir)));
        try { await fs.writeFile(path.join(target,name),bytes,{flag:'wx'}); } catch(e) { if(e.code!=='EEXIST') throw e; }
        return json(res,200,{src:`img/wiki/${name}`});
      }
      if(req.method!=='GET' && req.method!=='HEAD') return json(res,405,{error:'不支持此操作'});
      if(route==='/preview/js/wiki-data.js') { res.writeHead(200,{'Content-Type':mime['.js']}); return res.end(serialize(draft)); }
      let filename;
      if(route.startsWith('/preview/')) filename=await localFile(webRoot,route.slice(9));
      else if(['/','/editor.js','/editor.css'].includes(route)) filename=path.join(here,route==='/'?'index.html':route.slice(1));
      else return json(res,404,{error:'页面不存在'});
      let bytes=await fs.readFile(filename);
      const type=mime[path.extname(filename)] || 'application/octet-stream';
      if(route==='/preview/css/main.css') bytes=Buffer.concat([bytes,Buffer.from('\n@view-transition { navigation: none; }\n')]);
      res.setHeader('Content-Type',type);
      // Native video controls seek with byte ranges.
      const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      if(range) {
        const start=Number(range[1]),end=Math.min(range[2]?Number(range[2]):bytes.length-1,bytes.length-1);
        if(start>end || start>=bytes.length) { res.writeHead(416,{'Content-Range':`bytes */${bytes.length}`}); return res.end(); }
        res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Content-Length':end-start+1,'Accept-Ranges':'bytes'}); return res.end(req.method==='HEAD'?undefined:bytes.subarray(start,end+1));
      }
      res.setHeader('Content-Length',bytes.length); res.end(req.method==='HEAD'?undefined:bytes);
    } catch(e) { if(!res.headersSent) json(res,e.status || (e.code==='ENOENT'?404:400),{error:e.message}); else res.end(); }
  });
  return server;
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const server=await createEditor(); let port=8877;
  while(true) {
    try { await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});}); break; }
    catch(e) { if(e.code!=='EADDRINUSE' || port>=8890) throw e; port++; }
  }
  const dir=path.join(project,'.local/wiki-editor'); await fs.mkdir(dir,{recursive:true});
  const url=`http://127.0.0.1:${port}`;
  await fs.writeFile(path.join(dir,'runtime.json'),JSON.stringify({pid:process.pid,url}));
  console.log(`Ellan Wiki editor: ${url}`);
}
