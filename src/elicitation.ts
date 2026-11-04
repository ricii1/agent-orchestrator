// Shared by the UI and Codex adapter: a form with no fields is a confirmation,
// not an invitation to type JSON. Accepting it sends an empty object.
export function isEmptyFormRequest(value:unknown):boolean {
  if(!value||typeof value!=='object')return false;
  const request=value as Record<string,unknown>;
  if(!['form','openai/form'].includes(String(request.mode)))return false;
  const schema=request.requestedSchema;
  if(!schema||typeof schema!=='object'||Array.isArray(schema))return false;
  const form=schema as Record<string,unknown>;
  if(form.type!=='object')return false;
  if(Object.keys(form).some(key=>!['type','properties','required','additionalProperties','title','description'].includes(key)))return false;
  if(form.properties!==undefined&&(!form.properties||typeof form.properties!=='object'||Array.isArray(form.properties)||Object.keys(form.properties).length>0))return false;
  if(form.required!==undefined&&(!Array.isArray(form.required)||form.required.length>0))return false;
  return true;
}
