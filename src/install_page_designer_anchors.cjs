const ts=require('typescript'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=process.cwd();const changed=[];
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(x=>x.isDirectory()?files(path.join(dir,x.name)):[path.join(dir,x.name)])}
for(const file of files(path.join(root,'src')).filter(x=>x.endsWith('.tsx'))){
 const relative=path.relative(root,file).replaceAll('\\','/');
 if(/(PageDesign|ScreenWordingPage|ScreenText|main)\.tsx$/.test(file))continue;
 const source=fs.readFileSync(file,'utf8');if(source.includes('// page-designer-instrumented')){changed.push(relative);continue;}
 const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),edits=[],counts={};
 const key=text=>{const h=crypto.createHash('sha256').update(relative+'\n'+text).digest('hex').slice(0,16);counts[h]=(counts[h]||0)+1;return 'copy.'+h+'.'+counts[h]};
 function inside(node,name){for(let p=node.parent;p;p=p.parent){if(ts.isJsxElement(p)&&p.openingElement.tagName.getText(tree)===name)return true;}return false}
 function walk(node){
  if(relative.endsWith('/AppShell.tsx')&&ts.isJsxExpression(node)&&node.expression&&ts.isIdentifier(node.expression)&&node.expression.text==='label'&&!ts.isJsxAttribute(node.parent)){edits.push({start:node.getStart(tree),end:node.end,text:'<PageWord instance id="'+key('navigation-label')+'">{label}</PageWord>'});}

  if(ts.isJsxOpeningElement(node)&&node.tagName.getText(tree)==='ScreenText'&&inside(node,'option')&&!node.attributes.properties.some(p=>ts.isJsxAttribute(p)&&p.name.getText(tree)==='plain'))edits.push({start:node.tagName.end,end:node.tagName.end,text:' plain'});

  if((ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))&&node.tagName.getText(tree)==='input'&&node.attributes.properties.some(p=>ts.isJsxAttribute(p)&&p.name.getText(tree)==='placeholder'&&p.initializer&&ts.isStringLiteral(p.initializer))&&!node.attributes.properties.some(p=>ts.isJsxAttribute(p)&&p.name.getText(tree)==='ref')){const placeholder=node.attributes.properties.find(p=>ts.isJsxAttribute(p)&&p.name.getText(tree)==='placeholder');edits.push({start:node.tagName.getStart(tree),end:node.tagName.end,text:'PageInput designId="'+key('placeholder:'+placeholder.initializer.text)+'"'});if(ts.isJsxOpeningElement(node)&&ts.isJsxElement(node.parent)){const close=node.parent.closingElement.tagName;edits.push({start:close.getStart(tree),end:close.end,text:'PageInput'});}}
  if(ts.isJsxOpeningElement(node)&&node.tagName.getText(tree)==='option'&&ts.isJsxElement(node.parent)&&node.parent.children.every(c=>ts.isJsxText(c)||(ts.isJsxElement(c)&&c.openingElement.tagName.getText(tree)==='ScreenText'))){const close=node.parent.closingElement.tagName;edits.push({start:node.tagName.getStart(tree),end:node.tagName.end,text:'PageOption designId="'+key('option:'+node.parent.children.map(c=>c.getText(tree)).join(''))+'"'});edits.push({start:close.getStart(tree),end:close.end,text:'PageOption'});}

  if(ts.isStringLiteral(node)&&ts.isConditionalExpression(node.parent)&&(node.parent.whenTrue===node||node.parent.whenFalse===node)&&!inside(node,'ScreenText')&&!inside(node,'PageWord')&&!inside(node,'option')){let p=node.parent;while(p&&(ts.isConditionalExpression(p)||ts.isParenthesizedExpression(p)))p=p.parent;if(p&&ts.isJsxExpression(p)&&!ts.isJsxAttribute(p.parent)){edits.push({start:node.getStart(tree),end:node.end,text:'<PageWord id="'+key(node.text)+'">{'+JSON.stringify(node.text)+'}</PageWord>'});}}

  if(ts.isJsxText(node)&&node.getText(tree).trim()&&!inside(node,'ScreenText')&&!inside(node,'PageWord')&&!inside(node,'option')&&!inside(node,'textarea')&&!inside(node,'style')&&!inside(node,'script')){
   const raw=node.getText(tree);edits.push({start:node.pos,end:node.end,text:'<PageWord id="'+key(raw.trim())+'">'+raw+'</PageWord>'});
  }
  // Layout blocks retain their React identity; reordering uses CSS, never DOM moves.
  if(ts.isJsxOpeningElement(node)&&/^(main|section|article|form|fieldset|label|header|footer|nav|div|h[1-6]|p|button)$/.test(node.tagName.getText(tree))&&!inside(node,'ScreenText')&&!node.attributes.properties.some(p=>ts.isJsxAttribute(p)&&p.name.getText(tree)==='data-design-block')){
   const tag=node.tagName.getText(tree),id=key('block:'+tag+':'+node.attributes.getText(tree));edits.push({start:node.tagName.end,end:node.tagName.end,text:' data-design-block="'+id+'"'});
  }
  ts.forEachChild(node,walk);
 }
 walk(tree);if(!edits.length)continue;
 let output=source;for(const e of edits.sort((a,b)=>b.start-a.start))output=output.slice(0,e.start)+e.text+output.slice(e.end);
 const imports=['PageWord','PageInput','PageOption'].filter(name=>edits.some(e=>e.text.includes(name)));if(imports.length){let imp=path.relative(path.dirname(file),path.join(root,'src/components/PageDesign')).replaceAll('\\','/');if(!imp.startsWith('.'))imp='./'+imp;output='import { '+imports.join(', ')+' } from '+JSON.stringify(imp)+'\n'+output;}
 fs.writeFileSync(file,'// page-designer-instrumented\n'+output);changed.push(relative);
}
fs.writeFileSync('page-designer-files.txt',changed.join('\n')+'\n');console.log('Added page editing anchors to '+changed.length+' files.');
