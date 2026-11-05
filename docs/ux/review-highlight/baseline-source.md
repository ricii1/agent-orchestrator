# Scoped source baseline, before task #3 edits

These are the relevant fragments observed from the current unstaged checkout before the review-highlight edits. They intentionally omit surrounding app/model code owned by concurrent work.

## `web/app.ts`

```ts
const reviewCount=state.tasks.filter(t=>t.parentId&&inWorkspace(t,workspace,state.tasks)&&['failed','interrupted'].includes(t.status)).length;if(reviewCount)controls.append(button('Perlu ditinjau · '+reviewCount,historyDialog,'quiet'));
```

```ts
const problemTasks=state.tasks.filter(t=>t.parentId&&inWorkspace(t,workspace,state.tasks)&&['failed','interrupted'].includes(t.status));
if(problemTasks.length){const attention=el('div','attention');for(const t of problemTasks)attention.append(button(`Tinjau lalu lanjutkan · ${roleOf(t)} · ${statusText[t.status]}`,()=>openTask(t.id),'attention-link'));main.append(attention);}
```

```ts
function historyDialog(){
  const d=dialog('Riwayat pekerjaan'),tasks=[...pmHistory(state.tasks,workspace),...archive(state.tasks,workspace)];
  if(!tasks.length)d.append(el('p','empty','Pekerjaan yang selesai, gagal, terputus, atau dihentikan akan tersimpan di sini.'));
  for(const task of tasks){const row=button('',()=>{d.close();return openTask(task.id);},'history-row'),text=el('div');text.append(el('strong','',task.title),el('small','',`${task.kind==='pm'?'PM':roleOf(task)} · ${task.provider} · ${task.model||'model default'} · ${task.id.slice(0,8)} · ${new Date(task.updatedAt).toLocaleString('id-ID')}`));row.append(text,badge(task));d.append(row);}
}
```

## `web/model.ts`

No review-specific predicate or reason helper existed. Count and attention independently embedded equivalent status/workspace expressions in `app.ts`.
