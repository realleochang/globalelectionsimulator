const fs=require('fs');
const rows=require('./data_in_parsed.json');
const NDA=new Set(['Bharatiya Janata Party','Telugu Desam Party','Janata Dal (United)','Shiv Sena','Lok Janshakti Party (Ram Vilas)','Jana Sena Party','Janata Dal (Secular)','Rashtriya Lok Dal',"United People's Party Liberal",'United People’s Party Liberal','Asom Gana Parishad','Hindustani Awam Morcha','All Jharkhand Students Union','Nationalist Congress Party','Sikkim Krantikari Morcha','Apna Dal (Soneylal)']);
const INDIA=new Set(['Indian National Congress','Samajwadi Party','All India Trinamool Congress','Dravida Munnetra Kazhagam','Shiv Sena (Uddhav Balasaheb Thackeray)','Nationalist Congress Party (Sharadchandra Pawar)','Rashtriya Janata Dal','Communist Party of India (Marxist)','Jharkhand Mukti Morcha','Indian Union Muslim League','Aam Aadmi Party','Communist Party of India (Marxist–Leninist) Liberation','Jammu & Kashmir National Conference','Viduthalai Chiruthaigal Katchi','Communist Party of India','Kerala Congress','Revolutionary Socialist Party (India)','Marumalarchi Dravida Munnetra Kazhagam','Bharat Adivasi Party','Rashtriya Loktantrik Party']);
const alliance=p=>!p?'OTH':NDA.has(p)?'NDA':INDIA.has(p)?'INDIA':'OTH';
const stKey=w=>{let s=w.toUpperCase().replace(/ ISLANDS$/,'').replace(/ AND /g,' & ').trim();return s==='DADRA & NAGAR HAVELI & DAMAN & DIU'?'DADRANAGARHAVELI DAMANDIU':s;};
const CATS=['NDA','INDIA','OTH'];
const out={}; let wT=0; const wSum={NDA:0,INDIA:0,OTH:0}; const seats={NDA:0,INDIA:0,OTH:0};
for(const r of rows){
  const key=stKey(r.state)+'#'+r.no;
  const winCat=alliance(r.winParty), runCat=alliance(r.runParty);
  let total, shares={NDA:0,INDIA:0,OTH:0};
  if(r.unopposed||!r.winPct){ total=r.winVotes||0; shares[winCat]=100; }
  else{
    total=r.winVotes/(r.winPct/100);
    const runVotes=r.margin!=null?Math.max(0,r.winVotes-r.margin):0;
    const runPct=total>0?runVotes/total*100:0;
    shares[winCat]+=r.winPct;
    if(runCat!==winCat) shares[runCat]+=runPct; else shares[winCat]+=runPct;
    // remainder to the third category (the one not win/runner); if win==run, to remaining cats
    const used=new Set([winCat,runCat]); const rem=Math.max(0,100-r.winPct-runPct);
    const third=CATS.filter(c=>!used.has(c));
    if(third.length===1) shares[third[0]]+=rem; else if(third.length===2){shares[third[0]]+=rem/2;shares[third[1]]+=rem/2;}
  }
  // normalize to 100
  const s=shares.NDA+shares.INDIA+shares.OTH; if(s>0)for(const c of CATS)shares[c]=+(shares[c]/s*100).toFixed(2);
  seats[winCat]++;
  for(const c of CATS) wSum[c]+=shares[c]*total; wT+=total;
  // win-vs-runner percentage-point margin drives the swing model (FPTP, top-2 contenders).
  // The seat ALWAYS goes to the real winner at baseline; OTH (a catch-all of many separate
  // candidates) can only hold/flip seats where it was an actual top-2 contender.
  const winPctV=r.unopposed||!r.winPct?100:r.winPct;
  const marginPct=total>0&&r.margin!=null?+(r.margin/total*100).toFixed(2):(r.unopposed?100:0);
  const runnerPct=+Math.max(0,winPctV-marginPct).toFixed(2);
  let runCat2=runCat; if(runCat2===winCat) runCat2 = winCat==='NDA'?'INDIA':'NDA';
  out[key]={state:stKey(r.state),no:r.no,pc_name:r.name,win:winCat,runner:runCat2,
    winPct:+winPctV.toFixed(2),runnerPct,marginPct,margin:r.margin,totalVotes:Math.round(total),shares};
}
const nat={}; for(const c of CATS) nat[c]=+(wSum[c]/wT).toFixed(2);
const payload={nat2024:nat, seats2024:seats, results:out};
fs.writeFileSync('public/india-results-2024.json', JSON.stringify(payload));
console.log('seats:',JSON.stringify(seats),'| national vote share (weighted):',JSON.stringify(nat));
console.log('total constituencies:',Object.keys(out).length);
console.log('sample:',JSON.stringify(out['UTTAR PRADESH#1']));
