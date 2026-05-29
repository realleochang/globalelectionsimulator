const fs=require('fs');
const wt=fs.readFileSync('data_in_main.wikitext','utf8');
const sIdx=wt.indexOf('Results by Constituency ==');
const tStart=wt.indexOf('{|', sIdx), tEnd=wt.indexOf('\n|}', tStart);
const stripRefAll=s=>s.replace(/<ref[^>]*\/>/gi,'').replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi,'');
const table=stripRefAll(wt.slice(tStart, tEnd));
function cellValue(line){let s=line.replace(/^\|/,'');let dc=0,db=0;for(let i=0;i<s.length;i++){if(s[i]==='{'&&s[i+1]==='{'){dc++;i++;continue;}if(s[i]==='}'&&s[i+1]==='}'){dc--;i++;continue;}if(s[i]==='['&&s[i+1]==='['){db++;i++;continue;}if(s[i]===']'&&s[i+1]===']'){db--;i++;continue;}if(s[i]==='|'&&dc===0&&db===0)return s.slice(i+1).trim();}return s.trim();}
const linkText=c=>{const m=c.match(/\[\[([^\]]+)\]\]/);if(!m)return c.replace(/'''/g,'').trim();const p=m[1].split('|');return (p[1]||p[0]).trim();};
const isTplParty=c=>/\{\{\s*Party name with color/i.test(c);
const isIndLink=c=>/\[\[\s*Independent politician/i.test(c)||/\|\s*IND\s*\]\]/.test(c);
function partyOf(c){let m=c.match(/\{\{\s*Party name with color\s*\|\s*([^}|]+)/i);if(m){const p=m[1].trim();return /independent/i.test(p)?'Independent':p;}if(isIndLink(c))return 'Independent';m=c.match(/\[\[([^\]|]+)/);if(m)return m[1].trim();return c.replace(/[|']/g,'').trim();}
const num=c=>{if(c==null)return null;const m=String(c).replace(/,/g,'').match(/-?\d+(\.\d+)?/);return m?parseFloat(m[0]):null;};
const blocks=table.split(/\n\|-/); const rows=[]; let curState=null;
for(const b of blocks){
  const lines=b.split('\n').filter(l=>/^\|/.test(l)&&!/^\|[}+-]/.test(l));
  const cells=lines.map(cellValue);
  if(cells.length<4) continue;
  let off=0;
  if(/'''/.test(lines[0]||'')&&/\[\[/.test(lines[0]||'')){ curState=linkText(cells[0]); off=1; }
  const no=num(cells[off+0]); const name=linkText(cells[off+1]||'');
  // winner party = first template-party cell
  let wi=-1; for(let i=0;i<cells.length;i++){ if(isTplParty(cells[i])){wi=i;break;} }
  if(wi<0){ for(let i=off+3;i<cells.length;i++){ if(isIndLink(cells[i])){wi=i;break;} } }
  if(no==null||!name||wi<0) continue;
  const winParty=partyOf(cells[wi]);
  const winPct=num(cells[wi+1]);
  const winVotes=cells.length>=11?num(cells[wi+2]):null;
  // runner party = next party-ish cell after winner
  let runParty=null; for(let i=wi+1;i<cells.length;i++){ if(isTplParty(cells[i])||isIndLink(cells[i])){runParty=partyOf(cells[i]);break;} }
  const margin=cells.length>=11?num(cells[cells.length-1]):null;
  rows.push({state:curState,no,name,winParty,winPct,winVotes,runParty,margin,unopposed:cells.length<11});
}
fs.writeFileSync('data_in_parsed.json', JSON.stringify(rows));
const withPct=rows.filter(r=>r.winPct!=null).length, withRunner=rows.filter(r=>r.runParty).length;
console.log('rows:',rows.length,'| with winPct:',withPct,'| with runnerParty:',withRunner);
const pc={};for(const r of rows)pc[r.winParty]=(pc[r.winParty]||0)+1;
console.log('BJP:',pc['Bharatiya Janata Party'],'INC:',pc['Indian National Congress'],'| unopposed:',rows.filter(r=>r.unopposed).length);
