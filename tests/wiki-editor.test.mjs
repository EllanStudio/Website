import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEditor, serialize, parse, validate, project } from '../tools/wiki-editor/server.mjs';

test('current editorial data is accepted without rewriting it',async()=>{
  const root=path.join(project,'website');
  const source=await fs.readFile(path.join(root,'js/wiki-data.js'),'utf8');
  const data=parse(source);
  assert.deepEqual(await validate(data,root),[]);
  assert.deepEqual(parse(serialize(data)),data);
});

test('local editor isolates previews, protects saves, backs up originals and imports media',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ellan-wiki-editor-test-'));
  const website=path.join(root,'website');
  await fs.mkdir(path.join(website,'js'),{recursive:true});
  await fs.mkdir(path.join(website,'img'),{recursive:true});
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ9sAAAAASUVORK5CYII=','base64');
  await fs.writeFile(path.join(website,'img/test.png'),png);
  const data={categories:[{id:'start',title:'开始',intro:'开始'}],commands:[],featured:['hello'],articles:[{id:'hello',category:'start',title:'你好',summary:'简介',tag:'测试',keywords:'测试',where:'地点',prepare:'准备',result:'结果',image:'test.png',steps:[['步骤','内容']],related:[],media:{src:'',caption:'操作'}}]};
  const file=path.join(website,'js/wiki-data.js'),original=serialize(data);
  await fs.writeFile(file,original);
  const server=await createEditor({root});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const state=await (await fetch(base+'/api/state')).json();
    const post=(route,payload,extra={})=>fetch(base+route,{method:'POST',headers:{Origin:base,'X-Editor-Token':state.token,...extra},body:typeof payload==='string'||Buffer.isBuffer(payload)?payload:JSON.stringify(payload)});
    assert.equal((await fetch(base+'/api/state',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
    assert.equal((await fetch(base+'/api/save',{method:'POST',body:'{}'})).status,403);
    assert.equal((await post('/api/save',{}, {Origin:'https://other.example'})).status,403);
    data.articles[0].title='修改后的标题';
    assert.equal((await post('/api/preview',{data})).status,200);
    assert.equal(await fs.readFile(file,'utf8'),original);
    assert.match(await (await fetch(base+'/preview/js/wiki-data.js')).text(),/修改后的标题/);
    const save=await (await post('/api/save',{data,revision:state.revision})).json();
    assert.equal(await fs.readFile(save.backup,'utf8'),original);
    assert.equal(parse(await fs.readFile(file,'utf8')).articles[0].title,'修改后的标题');
    assert.equal((await post('/api/save',{data,revision:state.revision})).status,409);
    const uploaded=await (await post('/api/upload',png)).json();
    assert.match(uploaded.src,/^img\/wiki\/media-[a-f0-9]+\.png$/);
    assert.deepEqual(await fs.readFile(path.join(website,uploaded.src)),png);
    assert.equal((await post('/api/upload',Buffer.from('<html>not media</html>'))).status,400);
    data.articles[0].image='../js/wiki-data.js';
    assert.equal((await post('/api/save',{data,revision:save.revision})).status,422);
    assert.equal((await fetch(base+'/preview/%2e%2e%2fserver.mjs')).status,400);
  }finally{
    await new Promise(resolve=>server.close(resolve));
    assert.ok(root.startsWith(path.join(os.tmpdir(),'ellan-wiki-editor-test-')));
    await fs.rm(root,{recursive:true,force:true});
  }
});
