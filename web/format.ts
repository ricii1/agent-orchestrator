export interface MessagePart {kind:'text'|'strong'|'code'|'block'|'link';text:string;href?:string;}
// A deliberately small formatter. All output is built
// with DOM text nodes, so assistant text cannot inject HTML into the app.
export function messageParts(source:string,workspace=''):MessagePart[]{
  const pattern=/```(?:[^`\n]*\n)?([\s\S]*?)```|`([^`\n]+)`|\[([^\]\n]+)\]\(([^()\s]+)\)|\*\*([^\n]+?)\*\*/g;
  const parts:MessagePart[]=[];let start=0,match:RegExpExecArray|null;
  while((match=pattern.exec(source))){
    if(match.index>start)parts.push({kind:'text',text:source.slice(start,match.index)});
    if(match[1]!==undefined)parts.push({kind:'block',text:match[1]});
    else if(match[2]!==undefined)parts.push({kind:'code',text:match[2]});
    else if(match[3]!==undefined){const href=safeHref(match[4],workspace);parts.push(href?{kind:'link',text:match[3],href}:{kind:'text',text:match[0]});}
    else parts.push({kind:'strong',text:match[5]});
    start=pattern.lastIndex;
  }
  if(start<source.length)parts.push({kind:'text',text:source.slice(start)});
  return parts;
}
function safeHref(destination:string,workspace:string):string|null{
  if(/[\u0000-\u0020\u007f\\]/.test(destination)||destination.startsWith('//'))return null;
  if(/^https?:\/\//i.test(destination)){try{const u=new URL(destination);return ['http:','https:'].includes(u.protocol)?u.href:null;}catch{return null;}}
  if(/^[a-z][a-z0-9+.-]*:/i.test(destination))return null;
  let decoded:string;try{decoded=decodeURIComponent(destination);}catch{return null;}
  if(!decoded||decoded.split(/[\/]/).includes('..')||/(^|[\/])(?:\.data|\.git|\.env|[^/]*(?:secret|credential|private.?key|\.key|\.pem|\.log)[^/]*)(?:[\/]|$)/i.test(decoded))return null;
  if(!workspace)return null;
  return `/api/previews?workspace=${encodeURIComponent(workspace)}&path=${encodeURIComponent(decoded)}`;
}
export function renderMessage(target:HTMLElement,source:string,workspace=''):void{
  const doc=target.ownerDocument;
  for(const part of messageParts(source,workspace)){
    if(part.kind==='text'){target.append(doc.createTextNode(part.text));continue;}
    if(part.kind==='link'){const node=doc.createElement('a');node.href=part.href!;if(isDocumentLink(part.href!)){node.textContent=`Buka di aplikasi lokal · ${part.text}`;node.dataset.localDocument='true';node.removeAttribute('target');}else{node.textContent=part.text;node.target='_blank';node.rel='noopener noreferrer';}target.append(node);continue;}
    const node=doc.createElement(part.kind==='strong'?'strong':part.kind==='block'?'pre':'code');
    if(part.kind==='strong')renderMessage(node,part.text,workspace);
    else node.textContent=part.text;
    if(part.kind==='block')node.className='message-code';
    target.append(node);
  }
}
export function isDocumentLink(href:string){try{const url=new URL(href,'http://local');return url.origin==='http://local'&&url.pathname==='/api/previews'&&/\.(?:md|markdown|txt|text|csv|json|ya?ml|toml)$/i.test(url.searchParams.get('path')||'');}catch{return false;}}
