import {test} from 'node:test';
import assert from 'node:assert/strict';
import {messageParts} from '../web/format.ts';
test('PM message formatting preserves prose while rendering bold domain and inline code',()=>{
 assert.deepEqual(messageParts('Saran alamat: **http://kantor.test**. Alternatif: `office.test` atau `markas.test`.'),[
  {kind:'text',text:'Saran alamat: '},{kind:'strong',text:'http://kantor.test'},{kind:'text',text:'. Alternatif: '},{kind:'code',text:'office.test'},{kind:'text',text:' atau '},{kind:'code',text:'markas.test'},{kind:'text',text:'.'},
 ]);
 assert.deepEqual(messageParts('**belum selesai'),[{kind:'text',text:'**belum selesai'}]);
 assert.deepEqual(messageParts('baris satu\nbaris dua'),[{kind:'text',text:'baris satu\nbaris dua'}]);
});
test('code keeps literal emphasis and HTML-like text is only returned as text',()=>{
 assert.deepEqual(messageParts('`**literal**`'),[{kind:'code',text:'**literal**'}]);
 assert.deepEqual(messageParts('```sh\necho "**literal**"\n```'),[{kind:'block',text:'echo "**literal**"\n'}]);
 assert.deepEqual(messageParts('**<img src=x onerror=alert(1)>**'),[{kind:'strong',text:'<img src=x onerror=alert(1)>'}]);
});
