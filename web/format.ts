export interface MessagePart {kind:'text'|'strong'|'code'|'block';text:string;}
// A deliberately small formatter: emphasis and code only. All output is built
// with DOM text nodes, so assistant text cannot inject HTML into the app.
export function messageParts(source:string):MessagePart[]{
  const pattern=/```(?:[^`\n]*\n)?([\s\S]*?)```|`([^`\n]+)`|\*\*([^\n]+?)\*\*/g;
  const parts:MessagePart[]=[];let start=0,match:RegExpExecArray|null;
  while((match=pattern.exec(source))){
    if(match.index>start)parts.push({kind:'text',text:source.slice(start,match.index)});
    parts.push(match[1]!==undefined?{kind:'block',text:match[1]}:match[2]!==undefined?{kind:'code',text:match[2]}:{kind:'strong',text:match[3]});
    start=pattern.lastIndex;
  }
  if(start<source.length)parts.push({kind:'text',text:source.slice(start)});
  return parts;
}
export function renderMessage(target:HTMLElement,source:string):void{
  const doc=target.ownerDocument;
  for(const part of messageParts(source)){
    if(part.kind==='text'){target.append(doc.createTextNode(part.text));continue;}
    const node=doc.createElement(part.kind==='strong'?'strong':part.kind==='block'?'pre':'code');
    if(part.kind==='strong')renderMessage(node,part.text);
    else node.textContent=part.text;
    if(part.kind==='block')node.className='message-code';
    target.append(node);
  }
}
