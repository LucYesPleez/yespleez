const fs=require('fs');
const TurndownService=require('turndown');
const gfm=require('turndown-plugin-gfm');
const DIR='C:/Users/L-c/Documents/YesPleez App/YesPleez Scene App/YesPleez/docs/architecture/';

function banner(htmlName, ratified){
  return `> # ⚠ CONVENIENCE COPY — NOT AUTHORITATIVE
>
> **The canonical document is [\`${htmlName}\`](${htmlName}).** This Markdown is a
> mechanically-converted reading copy, for diff-review and GitHub navigation only.
>
> **If this file and \`${htmlName}\` disagree, \`${htmlName}\` is correct and this file is wrong.**
> Do not cite this file. Do not edit it by hand — it is regenerated from the HTML by script.
>
> Conversion is lossy by nature. Known losses: SVG diagrams are replaced by placeholders;
> callout semantics (rule / risk / decision / principle) survive only as their text labels;
> the sidebar table of contents is dropped. **No prose, rule number, or table cell was altered.**
>
> Status: ${ratified} · frozen. Rule numbers are a stable citation interface — never renumber.

`;
}

const td=new TurndownService({headingStyle:'atx',codeBlockStyle:'fenced',bulletListMarker:'-',emDelimiter:'*'});
td.use(gfm.gfm);
td.remove(['style','script','title']);
td.addRule('toc',{filter:n=>n.nodeName==='ASIDE'&&n.classList.contains('toc'),replacement:()=>''});
td.addRule('progress',{filter:n=>n.classList&&n.classList.contains('progress'),replacement:()=>''});
td.addRule('svg',{filter:'svg',replacement:(c,n)=>{
  const t=n.querySelector('title'), d=n.querySelector('desc');
  return `\n\n> **[Diagram — not reproducible in Markdown. See the canonical HTML.]**\n>\n> *${t?t.textContent:'Diagram'}* — ${d?d.textContent.replace(/\s+/g,' ').trim():'(no description)'}\n\n`;
}});
// sec-head: merge "A0" + <h2>Status & scope</h2> into one heading
td.addRule('secHead',{filter:n=>n.classList&&n.classList.contains('sec-head'),replacement:(c,n)=>{
  const num=n.querySelector('.sec-num'), h=n.querySelector('h2');
  return `\n\n## ${num?num.textContent.trim()+' — ':''}${h?h.textContent.trim():c.trim()}\n\n`;
}});
td.addRule('refid',{filter:n=>n.classList&&n.classList.contains('ref-id'),replacement:c=>`\`${c.replace(/\*/g,'').trim()}\` `});
td.addRule('calloutLabel',{filter:n=>n.classList&&n.classList.contains('label'),replacement:c=>`**${c.replace(/\*/g,'').replace(/\s+/g,' ').trim()}**\n\n`});
td.addRule('field',{filter:n=>n.classList&&n.classList.contains('field'),replacement:(c,n)=>{
  const f=n.querySelector('.fname'), d=n.querySelector('.fdesc');
  return `- \`${f?f.textContent.trim():''}\` — ${d?d.textContent.replace(/\s+/g,' ').trim():''}\n`;
}});
td.addRule('schemaHead',{filter:n=>n.classList&&n.classList.contains('schema-head'),replacement:c=>`\n**Schema — ${c.replace(/\s+/g,' ').trim()}**\n\n`});
td.addRule('callout',{filter:n=>n.classList&&n.classList.contains('callout'),replacement:c=>
  '\n\n'+c.trim().split('\n').map(l=>l.trim()?`> ${l}`:'>').join('\n')+'\n\n'});

for(const [html,md,rat] of [
  ['identity-v1.2.html','identity-v1.2.md','RATIFIED v1.2 — 18 Jul 2026'],
  ['identity-v1.1.html','identity-v1.1.md','RATIFIED v1.1 — 17 Jul 2026'],
  ['architecture-v1.0.html','architecture-v1.0.md','CANONICAL v1.0 — 10 Jul 2026'],
]){
  const src=fs.readFileSync(DIR+html,'utf8');
  let out=td.turndown(src);
  out=out.replace(/\n{4,}/g,'\n\n\n').replace(/^\s+/,'');
  fs.writeFileSync(DIR+md, banner(html,rat)+out+'\n','utf8');
  console.log(md,'->',(banner(html,rat)+out).length,'bytes');
}
