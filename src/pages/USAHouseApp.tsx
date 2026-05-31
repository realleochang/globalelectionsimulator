import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { hsl } from 'd3';
import { fetchWikiPhoto } from '../lib/wikiPhotos';
import { GlobeLogo } from './HomePage';

// ─────────────────────────────────────────────────────────────────────────────
// 2026 U.S. House of Representatives simulator.
//   • 435 single-member districts (2024 lines), first-past-the-post: the plurality
//     winner takes the seat. 218 for a majority.
//   • Parties: Democratic / Republican / Independent. Each district carries its real
//     2024 result + the two nominees (= most-likely 2026 nominees; incumbent flagged).
//   • Scenarios: 2024 Result (actual) · 2026 (national generic-ballot swing) · Blank Map.
// Data: public/usa-house-data.json (built in us_src/ from each state's 2024 results),
//       public/usa-house-districts.geojson (Census 119th-Congress boundaries).
// ─────────────────────────────────────────────────────────────────────────────

type PartyId = 'D' | 'R' | 'I';
type Preset = 'baseline' | 'swing2026' | 'blank';
type US_Party = { id: PartyId; name: string; full: string; color: string; leader: string; wiki?: string };
const US_PARTIES: US_Party[] = [
  { id:'D', name:'Dem',  full:'Democratic',  color:'#1F6FE5', leader:'Hakeem Jeffries', wiki:'Hakeem_Jeffries' },
  { id:'I', name:'Ind',  full:'Independent', color:'#8A8D94', leader:'Independents' },
  { id:'R', name:'GOP',  full:'Republican',  color:'#DD2B2B', leader:'Mike Johnson',    wiki:'Mike_Johnson_(Louisiana_politician)' },
];
const US_LR_ORDER: PartyId[] = ['D','I','R'];
const US_PARTY_MAP = Object.fromEntries(US_PARTIES.map(p=>[p.id,p])) as Record<PartyId,US_Party>;
const US_TOTAL_SEATS = 435;
const US_MAJORITY = 218;

interface District {
  id: string; st: string; state: string; num: string; name: string;
  validVotes: number;
  results2024: Partial<Record<PartyId, number>>;
  winner2024: PartyId;
  dNominee: string | null; rNominee: string | null;
  incumbent: string | null; incParty: PartyId | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtN(n:number):string{if(n>=1_000_000)return(n/1_000_000).toFixed(2)+'M';if(n>=1_000)return Math.round(n/1_000)+'K';return String(Math.round(n));}
function hexToRgba(hex:string,a:number):string{const h=hex.replace('#','');const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);return `rgba(${r},${g},${b},${a})`;}
function partyColor(id:PartyId):string{return US_PARTY_MAP[id]?.color??'#888';}
function vivid(hex:string,dark:boolean):string{ if(!dark) return hex; const c=hsl(hex); if(!Number.isNaN(c.l)&&c.l<0.6)c.l=0.63; return c.formatHex(); }
function winnerOf(r:Partial<Record<PartyId,number>>):PartyId|null{
  let best:PartyId|null=null,bv=-1; for(const id of US_LR_ORDER){const v=r[id]??0; if(v>bv){bv=v;best=id;}} return bv>0?best:null;
}
// Uniform national two-party swing (>0 favours Democrats) applied to a district's 2024 result.
function swungResults(d:District, swing:number):Partial<Record<PartyId,number>>{
  const D=d.results2024.D??0, R=d.results2024.R??0, I=d.results2024.I??0;
  if(D>0 && R>0){ const tp=D+R; const dF=Math.max(0,Math.min(1, D/tp + swing)); return { D:Math.round(dF*tp), R:Math.round((1-dF)*tp), ...(I?{I}:{}) }; }
  return { ...d.results2024 };
}
function districtResults(d:District, preset:Preset, swing:number, override?:Partial<Record<PartyId,number>>):Partial<Record<PartyId,number>>{
  if(override && Object.keys(override).length) return override;
  if(preset==='baseline') return d.results2024;
  if(preset==='swing2026') return swungResults(d, swing);
  return {};
}

type TT = { x:number;y:number; id:string; name:string;
  rows:{id:PartyId;name:string|null;votes:number;pct:number}[]; winner:PartyId|null; reportingPct?:number; incumbent?:string|null } | null;

// ── Scoreboard ────────────────────────────────────────────────────────────────
function ScoreTile({ partyId, seats, pct, rawVotes, isLeader, isWinner, dark }:{
  partyId:PartyId; seats:number; pct:number; rawVotes?:number; isLeader:boolean; isWinner:boolean; dark?:boolean;
}){
  const party=US_PARTY_MAP[partyId];
  const [photo,setPhoto]=useState<string|null>(null);
  useEffect(()=>{ if(!party.wiki){setPhoto(null);return;} let c=false; fetchWikiPhoto(party.wiki).then(u=>{if(!c)setPhoto(u);}); return()=>{c=true;}; },[party.wiki]);
  const color=vivid(partyColor(partyId),!!dark);
  return(
    <div className={`cand-col${isLeader?' is-leader':''}${isWinner?' is-winner':''}`}
      style={{'--cand-color':color,'--cand-color-alpha':hexToRgba(color,0.13),borderColor:(isLeader||isWinner)?color:hexToRgba(color,0.30)}as React.CSSProperties}>
      <div style={{position:'relative'}}>
        <div className="cand-circle-frame">{photo?<img src={photo} alt={party.leader} onError={()=>setPhoto(null)}/>:<span className="cand-initials">{party.name}</span>}</div>
        {isWinner&&(<span className="called-tick"><svg width="17" height="17" viewBox="0 0 17 17" fill="none"><circle cx="8.5" cy="8.5" r="8.5" fill={color}/><path d="M4.5 8.5l2.8 2.8L12.5 5.5" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"/></svg></span>)}
      </div>
      <span className="cand-leader-name" title={party.leader}>{party.leader.split(' ').slice(-1)[0]}</span>
      <span className="cand-party-abbrev">{party.name}</span>
      <span className="cand-seats">{seats}</span>
      <span className="cand-party-name" title={party.full}>{party.full}</span>
      <div style={{width:'100%',display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:1}}>
        <span style={{fontSize:6,fontFamily:'"JetBrains Mono",monospace',fontWeight:600,color:hexToRgba(color,0.5),letterSpacing:'0.1em',textTransform:'uppercase'}}>{seats>=US_MAJORITY?'majority':'of 435'}</span>
        <span style={{fontSize:11,fontFamily:'"JetBrains Mono",monospace',fontWeight:700,color}}>{pct.toFixed(1)}%</span>
      </div>
      {rawVotes!=null&&(<div style={{width:'100%',display:'flex',justifyContent:'flex-end',marginBottom:2}}>
        <span className="cand-votes-full" style={{fontSize:8.5,fontFamily:'"JetBrains Mono",monospace',color:hexToRgba(color,0.65)}}>{rawVotes.toLocaleString()}</span>
        <span className="cand-votes-compact" style={{fontSize:8.5,fontFamily:'"JetBrains Mono",monospace',color:hexToRgba(color,0.65)}}>{fmtN(rawVotes)}</span>
      </div>)}
      <div className="cand-bar-track" style={{width:'100%',height:3,borderRadius:2,background:'var(--bar-track)'}}>
        <div className="cand-bar-fill" style={{height:'100%',borderRadius:2,background:color,width:`${Math.min(seats/250*100,100)}%`,transition:'width .3s ease'}}/>
      </div>
    </div>
  );
}
function Scoreboard({ seats, votePct, rawVotes, dark }:{ seats:Record<PartyId,number>; votePct:Record<PartyId,number>; rawVotes:Record<PartyId,number>; dark?:boolean; }){
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{const el=ref.current;if(!el)return;const h=(e:WheelEvent)=>{if(Math.abs(e.deltaX)>Math.abs(e.deltaY))return;e.preventDefault();el.scrollLeft+=e.deltaY;};el.addEventListener('wheel',h,{passive:false});return()=>el.removeEventListener('wheel',h);},[]);
  const lead=useMemo(()=>{let b:PartyId|null=null,bs=-1;for(const id of US_LR_ORDER){if((seats[id]??0)>bs){bs=seats[id]??0;b=id;}}return bs>0?b:null;},[seats]);
  const hasMaj=lead!=null&&(seats[lead]??0)>=US_MAJORITY;
  const visible=US_LR_ORDER.filter(id=>(seats[id]??0)>0||(votePct[id]??0)>=1);
  return(<div className="shrink-0 border-b border-default bg-canvas select-none z-[45]"><div ref={ref} className="overflow-x-auto scroll-none">
    <div className="flex gap-1.5 px-3 pt-2 pb-2 mx-auto w-fit items-stretch">
      {visible.map(id=><ScoreTile key={id} partyId={id} seats={seats[id]??0} pct={votePct[id]??0} rawVotes={rawVotes[id]??0} isLeader={id===lead&&!hasMaj} isWinner={id===lead&&hasMaj} dark={dark}/>)}
    </div></div></div>);
}

// ── Map ───────────────────────────────────────────────────────────────────────
function MapController({}:{}){const map=useMap();useEffect(()=>{const ro=new ResizeObserver(()=>map.invalidateSize());ro.observe(map.getContainer());return()=>ro.disconnect();},[map]);return null;}
function districtFill(r:Partial<Record<PartyId,number>>, dark:boolean):string{
  const sorted=US_LR_ORDER.map(id=>[id,r[id]??0] as [PartyId,number]).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
  if(sorted.length===0) return dark?'#2a3344':'#E5E7EB';
  const total=sorted.reduce((s,[,v])=>s+v,0)||1;
  const margin=((sorted[0][1]-(sorted[1]?.[1]??0))/total)*100;
  const c=hsl(partyColor(sorted[0][0])); c.l = dark? 0.56-Math.min(margin/55,1)*0.30 : 0.80-Math.min(margin/55,1)*0.42;
  return c.formatHex();
}
function showTip(e:L.LeafletMouseEvent,id:string,r:Partial<Record<PartyId,number>>,frac:number|undefined,containerRef:React.RefObject<HTMLDivElement|null>,setTooltip:(t:TT)=>void,meta?:{name?:string;inc?:string|null;dN?:string|null;rN?:string|null}){
  const rect=containerRef.current?.getBoundingClientRect(); if(!rect) return;
  const total=US_LR_ORDER.reduce((s,p)=>s+(r[p]??0),0)||1;
  const rows=US_LR_ORDER.map(p=>({id:p,name:p==='D'?meta?.dN??null:p==='R'?meta?.rN??null:null,votes:r[p]??0,pct:(r[p]??0)/total*100})).filter(x=>x.votes>0).sort((a,b)=>b.votes-a.votes);
  setTooltip({x:e.originalEvent.clientX-rect.left,y:e.originalEvent.clientY-rect.top,id,name:meta?.name??id,rows,winner:rows[0]?.id??null,reportingPct:frac!=null?Math.round(frac*100):undefined,incumbent:meta?.inc});
}
function zoomScale(z:number):number{return Math.max(0.3,Math.min(2.4,(z-3)/(8-3)+0.45));}
function BubbleLayer({ geoData, resultsOf, fracOf, declaredOnly, setTooltip, onSelect, containerRef, districtMap, refresh }:{
  geoData:any; resultsOf:(id:string)=>Partial<Record<PartyId,number>>; fracOf:(id:string)=>number|undefined; declaredOnly?:Set<string>|null;
  setTooltip:(t:TT)=>void; onSelect:(id:string)=>void; containerRef:React.RefObject<HTMLDivElement|null>; districtMap:Record<string,District>; refresh?:number;
}){
  const map=useMap(); const markersRef=useRef<{m:L.CircleMarker;r:number}[]>([]);
  const resRef=useRef(resultsOf);resRef.current=resultsOf; const fracRef=useRef(fracOf);fracRef.current=fracOf; const dmRef=useRef(districtMap);dmRef.current=districtMap;
  useEffect(()=>{const onZoom=()=>{const s=zoomScale(map.getZoom());for(const{m,r}of markersRef.current)m.setRadius(r*s);};map.on('zoomend',onZoom);return()=>{map.off('zoomend',onZoom);};},[map]);
  useEffect(()=>{
    for(const{m}of markersRef.current)m.remove(); markersRef.current=[];
    const s=zoomScale(map.getZoom());
    L.geoJSON(geoData).eachLayer((layer:L.Layer)=>{
      const id=(layer as any).feature?.properties?.id; if(!id) return; if(declaredOnly&&!declaredOnly.has(id)) return;
      const r=resRef.current(id); const sorted=US_LR_ORDER.map(p=>[p,r[p]??0]as[PartyId,number]).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
      if(sorted.length===0)return; const b=(layer as any).getBounds?.(); if(!b?.isValid())return;
      const margin=sorted[0][1]-(sorted[1]?.[1]??0); const base=Math.min(26,3+0.02*Math.sqrt(Math.max(0,margin))); const col=partyColor(sorted[0][0]);
      const m=L.circleMarker(b.getCenter(),{radius:base*s,color:col,fillColor:col,fillOpacity:0.7,weight:0.8,opacity:0.9}).addTo(map);
      m.on('click',()=>{setTooltip(null);onSelect(id);});
      m.on('mousemove',(e:L.LeafletMouseEvent)=>{const d=dmRef.current[id];showTip(e,id,resRef.current(id),fracRef.current(id),containerRef,setTooltip,{name:d?.name,inc:d?.incumbent,dN:d?.dNominee,rN:d?.rNominee});});
      m.on('mouseout',()=>setTooltip(null));
      markersRef.current.push({m,r:base});
    });
    return()=>{for(const{m}of markersRef.current)m.remove();markersRef.current=[];};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[map,geoData,declaredOnly,refresh]);
  return null;
}
function MapView({ geoData, districtMap, resultsOf, fracOf, declaredOnly, blankProjected, selected, onSelect, dark, bubbleMap, simActive, refresh }:{
  geoData:any; districtMap:Record<string,District>; resultsOf:(id:string)=>Partial<Record<PartyId,number>>; fracOf:(id:string)=>number|undefined;
  declaredOnly?:Set<string>|null; blankProjected?:Set<string>|null; selected:string|null; onSelect:(id:string)=>void; dark:boolean; bubbleMap:boolean; simActive?:boolean; refresh?:number;
}){
  const containerRef=useRef<HTMLDivElement>(null); const layerRef=useRef<L.GeoJSON|null>(null); const [tooltip,setTooltip]=useState<TT>(null);
  const resRef=useRef(resultsOf);resRef.current=resultsOf; const fracRef=useRef(fracOf);fracRef.current=fracOf;
  const onSelRef=useRef(onSelect);onSelRef.current=onSelect; const declRef=useRef(declaredOnly);declRef.current=declaredOnly;
  const blankRef=useRef(blankProjected);blankRef.current=blankProjected; const simRef=useRef(simActive);simRef.current=simActive; const dmRef=useRef(districtMap);dmRef.current=districtMap;
  const style=useCallback((feature:any):L.PathOptions=>{
    const id=feature?.properties?.id; const isSel=id===selected; const border=dark?'rgba(255,255,255,0.16)':'rgba(0,0,0,0.22)';
    if(bubbleMap) return { fillOpacity:0, weight:0.3, color:border, opacity:0.5 };
    const shown=(!declaredOnly||declaredOnly.has(id))&&(!blankProjected||blankProjected.has(id));
    if(!shown) return { fillColor:dark?'#1b2231':'#d8dbe0', fillOpacity:0.55, weight:isSel?1.6:0.3, color:isSel?'#c8a020':border, opacity:1 };
    return { fillColor:districtFill(resultsOf(id),dark), fillOpacity:0.9, weight:isSel?1.8:0.35, color:isSel?'#c8a020':border, opacity:1 };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[selected,dark,bubbleMap,declaredOnly,blankProjected,resultsOf,refresh]);
  useEffect(()=>{layerRef.current?.setStyle((f:any)=>style(f));},[style]);
  useEffect(()=>{
    fetch(`${import.meta.env.BASE_URL}usa-house-districts.geojson`); // warm cache no-op safety
  },[]);
  const onEach=useCallback((feature:any,layer:L.Layer)=>{
    const id=feature?.properties?.id; if(!id)return;
    layer.on('click',()=>onSelRef.current(id));
    layer.on('mousemove',(e:L.LeafletMouseEvent)=>{
      const shown=(!declRef.current||declRef.current.has(id))&&(!blankRef.current||blankRef.current.has(id));
      const d=dmRef.current[id];
      if(!shown){const rect=containerRef.current?.getBoundingClientRect();if(!rect)return;
        setTooltip({x:e.originalEvent.clientX-rect.left,y:e.originalEvent.clientY-rect.top,id,name:d?.name??id,rows:[],winner:null,reportingPct:simRef.current?0:undefined,incumbent:d?.incumbent});return;}
      showTip(e,id,resRef.current(id),fracRef.current(id),containerRef,setTooltip,{name:d?.name,inc:d?.incumbent,dN:d?.dNominee,rN:d?.rNominee});
    });
    layer.on('mouseout',()=>setTooltip(null));
  },[]);
  const tc=dark?{bg:'rgba(17,23,40,0.97)',bd:'rgba(255,255,255,0.10)',ti:'rgba(255,255,255,0.93)',sub:'rgba(255,255,255,0.42)',body:'rgba(255,255,255,0.86)'}
    :{bg:'rgba(255,255,255,0.98)',bd:'rgba(0,0,0,0.09)',ti:'rgba(0,0,0,0.86)',sub:'rgba(0,0,0,0.45)',body:'rgba(0,0,0,0.79)'};
  return(
    <div ref={containerRef} className="relative w-full h-full">
      <MapContainer center={[39.5,-96]} zoom={4} minZoom={3} style={{width:'100%',height:'100%'}} zoomControl worldCopyJump={false}>
        <TileLayer key={dark?'d':'l'} url={dark?'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png':'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'} attribution='&copy; OpenStreetMap &copy; CARTO' subdomains="abcd" maxZoom={18}/>
        <MapController/>
        {geoData&&<GeoJSON ref={layerRef as any} data={geoData} style={(f:any)=>style(f)} onEachFeature={onEach} {...({smoothFactor:0.7}as any)}/>}
        {geoData&&bubbleMap&&<BubbleLayer geoData={geoData} resultsOf={resultsOf} fracOf={fracOf} declaredOnly={declaredOnly} setTooltip={setTooltip} onSelect={onSelect} containerRef={containerRef} districtMap={districtMap} refresh={refresh}/>}
      </MapContainer>
      {tooltip&&(()=>{const cw=containerRef.current?.clientWidth??9999;const TW=240;const left=tooltip.x+18+TW>cw?tooltip.x-TW-10:tooltip.x+18;const d=districtMap[tooltip.id];
        return(<div className="absolute pointer-events-none z-[1000]" style={{left,top:Math.max(6,tooltip.y-20),width:TW}}>
          <div style={{background:tc.bg,borderRadius:10,border:`1px solid ${tc.bd}`,boxShadow:'0 6px 28px rgba(0,0,0,0.3)',backdropFilter:'blur(12px)',padding:'11px 13px'}}>
            <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',gap:6}}><div style={{fontSize:12.5,fontWeight:700,color:tc.ti,lineHeight:1.2}}>{tooltip.name}</div><div style={{fontSize:9,fontFamily:'"JetBrains Mono",monospace',color:tc.sub}}>{tooltip.id}</div></div>
            {(()=>{const rp=tooltip.reportingPct;if(rp==null)return <div style={{fontSize:9,fontFamily:'"JetBrains Mono",monospace',color:tc.sub,marginTop:2}}>2024 result</div>;const live=rp<100;return(<div className={live?'animate-pulse':''} style={{fontSize:9.5,fontFamily:'"JetBrains Mono",monospace',fontWeight:800,marginTop:2,color:live?'#FFCC00':'#16a34a',display:'flex',alignItems:'center',gap:5}}>{live&&<span style={{width:6,height:6,borderRadius:99,background:'#ef4444',boxShadow:'0 0 6px #ef4444'}}/>}{rp===0?'AWAITING RESULTS':live?`${rp}% REPORTING`:'✓ 100% REPORTING'}</div>);})()}
            <div style={{marginTop:8,display:'flex',flexDirection:'column',gap:4}}>
              {tooltip.rows.map(row=>{const col=vivid(partyColor(row.id),dark);return(<div key={row.id} style={{display:'flex',alignItems:'center',gap:6}}>
                <span style={{width:7,height:7,borderRadius:2,flexShrink:0,background:col}}/><span style={{flex:1,fontSize:10.5,color:tc.body,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{row.name??US_PARTY_MAP[row.id].full}</span>
                <span style={{fontSize:9,fontFamily:'"JetBrains Mono",monospace',color:tc.sub}}>{row.votes.toLocaleString()}</span>
                <span style={{fontSize:10.5,fontFamily:'"JetBrains Mono",monospace',fontWeight:700,color:col,minWidth:42,textAlign:'right'}}>{row.pct.toFixed(1)}%</span></div>);})}
              {tooltip.rows.length===0&&<div style={{fontSize:10,color:tc.sub}}>{d?.dNominee||d?.rNominee?`${d?.dNominee??'—'} (D) · ${d?.rNominee??'—'} (R)`:'No result yet'}</div>}
            </div>
            {tooltip.incumbent&&<div style={{fontSize:8.5,fontFamily:'"JetBrains Mono",monospace',color:tc.sub,marginTop:6}}>Incumbent: {tooltip.incumbent}</div>}
          </div></div>);})()}
      <div className="absolute bottom-2 right-2 text-[10px] text-ink-3 select-none z-[1000] font-mono">Scroll to zoom · Click a district</div>
    </div>
  );
}

// ── District panel ────────────────────────────────────────────────────────────
function DistrictPanel({ d, preset, swing, override, onOverride, onReset, onClose, isBlank, projected, reportingPct, onProject, onReportingChange, dark, baselineOpen, onToggleBaseline }:{
  d:District; preset:Preset; swing:number; override?:Partial<Record<PartyId,number>>;
  onOverride:(r:Partial<Record<PartyId,number>>)=>void; onReset:()=>void; onClose:()=>void;
  isBlank?:boolean; projected?:boolean; reportingPct?:number; onProject?:()=>void; onReportingChange?:(p:number)=>void; dark?:boolean; baselineOpen?:boolean; onToggleBaseline?:()=>void;
}){
  const basePct=useMemo(()=>{
    const r=isBlank?(override&&Object.keys(override).length?override:{D:34,I:0,R:33}):districtResults(d,preset,swing,override);
    const t=US_LR_ORDER.reduce((s,p)=>s+(r[p]??0),0)||1; const pct:Record<PartyId,number>={D:0,I:0,R:0}; for(const p of US_LR_ORDER)pct[p]=(r[p]??0)/t*100; return pct;
  },[d,preset,swing,override,isBlank]);
  const [draft,setDraft]=useState<Record<PartyId,number>>(basePct);
  const [rpt,setRpt]=useState(reportingPct??100);
  const [touched,setTouched]=useState(!!override&&Object.keys(override).length>0);
  useEffect(()=>{setDraft(basePct);setRpt(reportingPct??100);setTouched(!!override&&Object.keys(override).length>0);/* eslint-disable-next-line */},[d.id]);
  const valid=d.validVotes||100;
  const setVal=(id:PartyId,val:number)=>{
    const others=US_LR_ORDER.filter(p=>p!==id);const rem=100-val;const osum=others.reduce((s,p)=>s+draft[p],0);const next:Record<PartyId,number>={...draft,[id]:val};
    if(osum>0)for(const p of others)next[p]=draft[p]/osum*rem; else for(const p of others)next[p]=rem/others.length;
    setDraft(next);setTouched(true);
    if(!isBlank){const r:Partial<Record<PartyId,number>>={};for(const p of US_LR_ORDER)r[p]=Math.round(next[p]/100*valid);onOverride(r);}
  };
  const project=()=>{if(!touched)return;const r:Partial<Record<PartyId,number>>={};for(const p of US_LR_ORDER)r[p]=Math.round(draft[p]/100*valid*(isBlank?rpt/100:1));onOverride(r);onReportingChange?.(rpt);onProject?.();};
  const cur=isBlank?draft:basePct;
  const winner=winnerOf(Object.fromEntries(US_LR_ORDER.map(p=>[p,cur[p]])) as Partial<Record<PartyId,number>>);
  const has=!!override&&Object.keys(override).length>0; const track=dark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.07)';
  return(
    <aside className={`w-72 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0"><h2 className="text-[16px] font-bold text-ink leading-tight truncate">{d.name}</h2>
            <p className="text-[10px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">{d.id} · {isBlank?(projected?'projected':'blank'):has?'custom':preset==='swing2026'?'2026 swing':'2024 result'}</p></div>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0">×</button>
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <button onClick={onToggleBaseline} className={`text-[10px] font-mono px-2 py-1 rounded-[4px] border transition-colors shrink-0 ${baselineOpen?'bg-gold text-white border-gold':'border-default text-ink-3 hover:bg-hover hover:text-ink'}`}>📋 2024</button>
          <div className="flex-1 grid grid-cols-2 gap-1">
            {(['D','R'] as PartyId[]).map(p=>{const nm=p==='D'?d.dNominee:d.rNominee;const isInc=d.incParty===p;const col=vivid(partyColor(p),!!dark);return(
              <div key={p} className="px-2 py-1 rounded-[4px] min-w-0" style={{borderLeft:`3px solid ${col}`,background:dark?'rgba(255,255,255,0.04)':'#f7f7f5'}}>
                <div className="text-[9.5px] font-semibold text-ink truncate" title={nm??''}>{nm??'—'}</div>
                <div className="text-[7.5px] font-mono truncate" style={{color:col}}>{US_PARTY_MAP[p].full}{isInc?' · INC':''}</div></div>);})}
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto thin-scroll">
        {isBlank&&(<div className="px-3.5 pt-3 pb-3 border-b border-default">
          <div className="flex items-center justify-between mb-1.5"><span className="text-[8px] font-mono font-bold uppercase tracking-[0.14em]" style={{color:dark?'rgba(255,255,255,0.38)':'rgba(0,0,0,0.4)'}}>% Reporting</span>
            <span className="text-[13px] font-mono font-black tabular-nums" style={{color:rpt<50?'#ef4444':rpt<100?'#f59e0b':'#16a34a'}}>{rpt}%</span></div>
          <div style={{position:'relative',height:18,display:'flex',alignItems:'center'}}>
            <div style={{position:'absolute',left:0,right:0,height:4,borderRadius:4,background:track}}/><div style={{position:'absolute',left:0,width:`${rpt}%`,height:4,borderRadius:4,background:rpt<50?'#ef4444':rpt<100?'#f59e0b':'#16a34a'}}/>
            <input type="range" min={1} max={100} value={rpt} onChange={e=>{setRpt(+e.target.value);setTouched(true);}} className="br-party-slider w-full" style={{'--party-color':rpt<50?'#ef4444':rpt<100?'#f59e0b':'#16a34a','--pct':`${rpt}%`,position:'relative',zIndex:1}as React.CSSProperties}/></div>
          <div className="text-[8px] font-mono mt-0.5" style={{color:dark?'rgba(255,255,255,0.28)':'rgba(0,0,0,0.32)'}}>≈{Math.round(valid*rpt/100).toLocaleString()} votes counted</div></div>)}
        <div className="px-3.5 space-y-3 py-3">
          {US_LR_ORDER.map(id=>{const p=US_PARTY_MAP[id];const val=cur[id];const col=p.color;const raw=Math.round(val/100*valid*(isBlank?rpt/100:1));return(
            <div key={id}>
              <div className="flex items-center gap-1 mb-0.5"><span className="w-1.5 h-1.5 rounded-full shrink-0" style={{background:col}}/><span className="text-[10px] font-medium text-ink flex-1 truncate leading-none">{p.full}</span><span className="text-[10px] font-mono font-bold tabular-nums" style={{color:col}}>{val.toFixed(1)}%</span></div>
              <input type="range" min={0} max={100} step={0.1} value={val} onChange={e=>setVal(id,parseFloat(e.target.value))} className="br-party-slider w-full" style={{'--party-color':col,'--pct':`${val}%`}as React.CSSProperties}/>
              <div className="text-[8px] font-mono mt-0.5" style={{color:dark?'rgba(255,255,255,0.22)':'rgba(0,0,0,0.28)'}}>{raw.toLocaleString()} votes</div></div>);})}
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-[4px]" style={{borderLeft:`3px solid ${winner?partyColor(winner):'#888'}`,background:dark?'rgba(255,255,255,0.04)':'#f8f7f4'}}>
            <span className="text-[10px] font-medium text-ink flex-1">{winner?US_PARTY_MAP[winner].full+' wins':'—'}</span></div>
        </div>
      </div>
      {isBlank?(<div className="px-3.5 py-2.5 border-t border-default shrink-0 space-y-1.5">
        <button onClick={project} disabled={!touched} className={`w-full h-8 rounded-[4px] text-[11px] font-mono font-semibold uppercase tracking-wide transition-colors ${!touched?'border border-default text-ink-3 opacity-50 cursor-not-allowed':projected?'bg-emerald-600 text-white hover:bg-emerald-700':'bg-blue-600 text-white hover:bg-blue-700'}`}>{!touched?'Adjust a slider first':projected?'↻ Update Projection':'📍 Project Result'}</button>
        {has&&<button onClick={()=>{onReset();setTouched(false);setDraft(basePct);}} className="w-full h-6 rounded-[4px] border border-default text-ink-3 text-[9px] font-mono uppercase tracking-wide hover:bg-hover">Clear</button>}
      </div>):has?(<div className="px-3.5 py-2.5 border-t border-default shrink-0"><button onClick={onReset} className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover">Reset to scenario</button></div>):null}
    </aside>
  );
}

function BaselinePopup({ d, onClose, dark }:{ d:District; onClose:()=>void; dark?:boolean }){
  const total=US_LR_ORDER.reduce((s,p)=>s+(d.results2024[p]??0),0)||1;
  const rows=US_LR_ORDER.map(p=>({p,v:d.results2024[p]??0})).filter(x=>x.v>0).sort((a,b)=>b.v-a.v);
  const cardBg=dark?'rgba(255,255,255,0.04)':'rgba(0,0,0,0.03)';
  return(<aside className={`w-60 shrink-0 ${dark?'bg-[#0a1626]':'bg-[#fbfaf7]'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
    <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0 flex items-start justify-between"><div><h2 className="text-[13px] font-bold text-ink leading-tight">{d.name}</h2><p className="text-[8px] font-mono text-ink-3 mt-0.5 uppercase">2024 actual result</p></div><button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 text-base shrink-0">×</button></div>
    <div className="flex-1 overflow-y-auto thin-scroll px-3 py-3 space-y-1.5">
      {rows.map(({p,v})=>{const col=US_PARTY_MAP[p].color;const nm=p==='D'?d.dNominee:p==='R'?d.rNominee:'Other';return(<div key={p} style={{background:cardBg,borderRadius:5,padding:'5px 8px',borderLeft:`3px solid ${col}`}}><div className="flex items-center gap-2"><span className="text-[10px] font-semibold text-ink flex-1 truncate">{nm}</span><span className="text-[9px] font-mono text-ink-3">{v.toLocaleString()}</span><span className="text-[10px] font-mono font-bold" style={{color:col}}>{(v/total*100).toFixed(1)}%</span></div></div>);})}
      <div className="text-[8px] font-mono pt-1" style={{color:dark?'rgba(255,255,255,0.3)':'rgba(0,0,0,0.35)'}}>Winner: {US_PARTY_MAP[d.winner2024].full}{d.incumbent?` · inc. ${d.incumbent}`:''}</div></div>
  </aside>);
}

function HemicyclePanel({ seats, onClose, exiting, dark }:{ seats:Record<PartyId,number>; onClose:()=>void; exiting?:boolean; dark?:boolean }){
  const order=US_LR_ORDER; const total=order.reduce((s,p)=>s+(seats[p]??0),0);
  const flat:PartyId[]=[]; for(const p of order){const n=seats[p]??0;for(let i=0;i<n;i++)flat.push(p);}
  const ROWS=12,innerR=70,outerR=215; const rowR=Array.from({length:ROWS},(_,i)=>innerR+(outerR-innerR)*(i/(ROWS-1)));
  const arc=rowR.reduce((s,r)=>s+r*Math.PI,0); const perRow=rowR.map(r=>Math.max(1,Math.round((r*Math.PI/arc)*total)));
  let diff=total-perRow.reduce((s,n)=>s+n,0),idx=perRow.length-1; while(diff!==0){perRow[idx]+=diff>0?1:-1;diff+=diff>0?-1:1;idx=(idx-1+perRow.length)%perRow.length;}
  const slots:{x:number;y:number;a:number;r:number}[]=[];
  for(let row=0;row<ROWS;row++){const r=rowR[row];const c=perRow[row];for(let i=0;i<c;i++){const t=c===1?0.5:i/(c-1);const a=Math.PI-t*Math.PI;slots.push({x:250+Math.cos(a)*r,y:250-Math.sin(a)*r,a,r});}}
  slots.sort((a,b)=>(b.a-a.a)||(a.r-b.r));
  return(<aside className={`w-[480px] shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting?'panel-exit':'panel-slide'}`}>
    <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0"><div><h1 className="text-[14px] font-bold text-ink leading-none">U.S. House — Composition</h1><p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase">{total} of {US_TOTAL_SEATS} · majority {US_MAJORITY}</p></div><button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 text-base">×</button></div>
    <div className="flex-1 overflow-y-auto px-4 py-4 thin-scroll">
      <svg viewBox="0 0 500 270" width="100%" height="auto" style={{display:'block'}}>
        {slots.map((s,k)=><circle key={k} cx={s.x} cy={s.y} r={3.2} fill={partyColor(flat[k]??'I')} stroke={dark?'rgba(0,0,0,0.35)':'rgba(255,255,255,0.85)'} strokeWidth="0.5"/>)}
        <line x1="250" y1="22" x2="250" y2="58" stroke={dark?'rgba(255,255,255,0.35)':'rgba(0,0,0,0.45)'} strokeWidth="1" strokeDasharray="3 3"/><text x="250" y="16" textAnchor="middle" fontSize="9" fontFamily="JetBrains Mono, monospace" fill={dark?'rgba(255,255,255,0.55)':'rgba(0,0,0,0.55)'}>{US_MAJORITY}</text>
      </svg>
      <div className="mt-4 grid grid-cols-3 gap-2">{order.map(p=>{const n=seats[p]??0;if(n===0)return null;return(<div key={p} className="flex items-center gap-2 px-2 py-1.5 rounded-[4px] border border-default"><span style={{width:10,height:10,borderRadius:2,background:US_PARTY_MAP[p].color}}/><span className="text-[11px] font-semibold text-ink">{US_PARTY_MAP[p].name}</span><span className="ml-auto text-[11px] font-mono text-ink-2">{n}</span></div>);})}</div>
    </div>
  </aside>);
}

function BreakdownPanel({ districts, resultsOf, seats, votePct, onClose, exiting, dark }:{
  districts:District[]; resultsOf:(id:string)=>Partial<Record<PartyId,number>>; seats:Record<PartyId,number>; votePct:Record<PartyId,number>; onClose:()=>void; exiting?:boolean; dark?:boolean;
}){
  const ink3=dark?'rgba(255,255,255,0.25)':'rgba(0,0,0,0.25)'; const cardBg=dark?'rgba(255,255,255,0.04)':'rgba(0,0,0,0.03)';
  const totalS=US_LR_ORDER.reduce((s,p)=>s+(seats[p]??0),0);
  const closest=useMemo(()=>districts.map(d=>{const r=resultsOf(d.id);const sorted=US_LR_ORDER.map(p=>[p,r[p]??0]as[PartyId,number]).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);const tot=sorted.reduce((s,[,v])=>s+v,0)||1;const m=((sorted[0]?.[1]??0)-(sorted[1]?.[1]??0))/tot*100;return{d,win:sorted[0]?.[0],m};}).filter(x=>x.win&&x.m<100).sort((a,b)=>a.m-b.m).slice(0,8),[districts,resultsOf]);
  const byState=useMemo(()=>{const m:Record<string,Record<PartyId,number>>={};for(const d of districts){const w=winnerOf(resultsOf(d.id));if(!w)continue;(m[d.state]??=({D:0,I:0,R:0}as Record<PartyId,number>))[w]++;}return Object.entries(m).map(([s,t])=>({s,t,n:t.D+t.I+t.R})).sort((a,b)=>b.n-a.n);},[districts,resultsOf]);
  const totV=US_LR_ORDER.reduce((s,p)=>s+(votePct[p]??0),0)||1;
  function Sec({title,children}:{title:string;children:React.ReactNode}){return(<div><div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.18em] mb-2" style={{color:ink3}}>{title}</div><div className="space-y-1.5">{children}</div></div>);}
  return(<aside className={`w-80 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting?'panel-exit':'panel-slide'}`}>
    <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0"><div><h2 className="text-[13px] font-bold text-ink leading-none">Breakdown</h2><div className="text-[9px] font-mono text-ink-3 mt-0.5">U.S. House — nerd stats</div></div><button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 text-base">×</button></div>
    {totalS===0?<div className="flex items-center justify-center flex-1 text-[11px] font-mono text-ink-3 px-4 text-center">Load results or run a simulation first</div>:(
    <div className="flex-1 overflow-y-auto thin-scroll px-3.5 py-3.5 space-y-5">
      <Sec title="Seats">{US_LR_ORDER.filter(p=>(seats[p]??0)>0).sort((a,b)=>(seats[b]??0)-(seats[a]??0)).map(p=>{const n=seats[p]??0;return(
        <div key={p} style={{background:cardBg,borderRadius:5,padding:'6px 8px',borderLeft:`3px solid ${US_PARTY_MAP[p].color}`}}>
          <div className="flex items-center justify-between"><div className="text-[10px] font-bold text-ink">{US_PARTY_MAP[p].full}</div><div className="text-right"><span className="text-[18px] font-black font-mono" style={{color:US_PARTY_MAP[p].color}}>{n}</span><div className="text-[7.5px] font-mono" style={{color:n>=US_MAJORITY?'#16a34a':ink3}}>{n>=US_MAJORITY?'✓ majority':`${(n/US_TOTAL_SEATS*100).toFixed(1)}% of seats`}</div></div></div>
          <div className="mt-1.5 h-1.5 rounded-full overflow-hidden" style={{background:dark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.06)'}}><div style={{width:`${Math.min(n/US_TOTAL_SEATS*100*1.8,100)}%`,height:'100%',background:US_PARTY_MAP[p].color}}/></div></div>);})}</Sec>
      <Sec title="National popular vote → seats">{US_LR_ORDER.filter(p=>(votePct[p]??0)>=0.5).map(p=>{const vP=(votePct[p]??0)/totV*100;const sP=totalS>0?(seats[p]??0)/totalS*100:0;const diff=sP-vP;const col=US_PARTY_MAP[p].color;return(
        <div key={p} style={{background:cardBg,borderRadius:5,padding:'5px 8px'}}>
          <div className="flex items-center justify-between mb-1"><span className="text-[9.5px] font-medium text-ink">{US_PARTY_MAP[p].full}</span><span className="text-[8.5px] font-mono" style={{color:Math.abs(diff)<1?ink3:diff>0?'#16a34a':'#ef4444'}}>{diff>0?'+':''}{diff.toFixed(1)}% seat bonus</span></div>
          <div className="flex gap-1 items-center"><div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{background:dark?'rgba(255,255,255,0.07)':'rgba(0,0,0,0.06)'}}><div style={{width:`${Math.min(vP,100)}%`,height:'100%',background:hexToRgba(col,0.45)}}/></div><span className="text-[7.5px] font-mono text-ink-3 w-8 text-right">{vP.toFixed(0)}%v</span></div>
          <div className="flex gap-1 items-center mt-0.5"><div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{background:dark?'rgba(255,255,255,0.07)':'rgba(0,0,0,0.06)'}}><div style={{width:`${Math.min(sP,100)}%`,height:'100%',background:col}}/></div><span className="text-[7.5px] font-mono text-ink-3 w-8 text-right">{sP.toFixed(0)}%s</span></div></div>);})}</Sec>
      <Sec title="Closest races">{closest.map(({d,win,m})=><div key={d.id} style={{background:cardBg,borderRadius:5,padding:'5px 8px',display:'flex',alignItems:'center',gap:8,borderLeft:`3px solid ${partyColor(win!)}`}}><span className="text-[10px] font-medium text-ink flex-1 truncate">{d.id} · {d.name}</span><span className="text-[9px] font-mono font-bold" style={{color:partyColor(win!)}}>{US_PARTY_MAP[win!].name} +{m.toFixed(1)}</span></div>)}</Sec>
      <Sec title="Seats by state">{byState.map(({s,t,n})=><div key={s} style={{background:cardBg,borderRadius:5,padding:'5px 8px',display:'flex',alignItems:'center',gap:6}}><span className="text-[10px] font-medium text-ink flex-1 truncate">{s}</span><span className="text-[9px] font-mono text-ink-3">{n}</span><span className="text-[9px] font-mono font-bold" style={{color:partyColor('D')}}>{t.D}D</span><span className="text-[9px] font-mono font-bold" style={{color:partyColor('R')}}>{t.R}R</span>{t.I>0&&<span className="text-[9px] font-mono font-bold" style={{color:partyColor('I')}}>{t.I}I</span>}</div>)}</Sec>
    </div>)}
  </aside>);
}

// ── Simulation noise ──────────────────────────────────────────────────────────
function noisyPartial(final:Partial<Record<PartyId,number>>, lf:number, seed:number, exact:boolean):Partial<Record<PartyId,number>>{
  if(exact||lf>=1) return {...final};
  const D=final.D??0, R=final.R??0, I=final.I??0; const tp=D+R;
  if(tp<=0){const o:Partial<Record<PartyId,number>>={};for(const p of US_LR_ORDER){const v=final[p]??0;if(v)o[p]=Math.round(v*lf);}return o;}
  const dF=D/tp; const amp=0.11*(1-lf); const dFn=Math.max(0,Math.min(1,dF+amp*Math.sin(seed+lf*9)));
  const tpNow=tp*lf; const o:Partial<Record<PartyId,number>>={ D:Math.round(dFn*tpNow), R:Math.round((1-dFn)*tpNow) }; if(I)o.I=Math.round(I*lf); return o;
}

// ── Main app ──────────────────────────────────────────────────────────────────
export default function USAHouseApp(){
  const navigate=useNavigate();
  const [dark,setDark]=useState(()=>localStorage.getItem('darkMode')!=='false');
  useEffect(()=>{document.documentElement.classList.toggle('dark',dark);localStorage.setItem('darkMode',String(dark));},[dark]);

  const [districts,setDistricts]=useState<District[]>([]);
  const [geoData,setGeoData]=useState<any>(null);
  const districtMap=useMemo(()=>Object.fromEntries(districts.map(d=>[d.id,d])) as Record<string,District>,[districts]);
  useEffect(()=>{fetch(`${import.meta.env.BASE_URL}usa-house-data.json`).then(r=>r.json()).then(setDistricts).catch(console.error);},[]);
  useEffect(()=>{fetch(`${import.meta.env.BASE_URL}usa-house-districts.geojson`).then(r=>r.json()).then(setGeoData).catch(console.error);},[]);

  const [preset,setPreset]=useState<Preset>('swing2026');
  const [swing,setSwing]=useState(0.03);                       // +3 toward Democrats (2026 generic ballot)
  const [overrides,setOverrides]=useState<Record<string,Partial<Record<PartyId,number>>>>({});
  const [projected,setProjected]=useState<Set<string>>(new Set());
  const [reporting,setReporting]=useState<Record<string,number>>({});
  const [selected,setSelected]=useState<string|null>(null);
  const [baselineOpen,setBaselineOpen]=useState(false);

  const [simVotes,setSimVotes]=useState<Record<string,Partial<Record<PartyId,number>>>>({});
  const [simReported,setSimReported]=useState<Record<string,number>>({});
  const [simRunning,setSimRunning]=useState(false);
  const [simDone,setSimDone]=useState(false);
  const [simSwing,setSimSwing]=useState(0.03);
  const [simDuration,setSimDuration]=useState<60000|120000|300000|600000>(120000);
  const [simRefresh,setSimRefresh]=useState(0);
  const simTimerRef=useRef<ReturnType<typeof setInterval>|null>(null);

  const [bubbleMap,setBubbleMap]=useState(false);
  const [scoreboardVisible,setScoreboardVisible]=useState(true);
  const [leftPanel,setLeftPanel]=useState<'hemi'|null>(null);
  const [rightPanel,setRightPanel]=useState<'sim'|'breakdown'|null>(null);

  const simActive=simRunning||simDone;
  const resultsOf=useCallback((id:string)=>{
    if(simActive) return simVotes[id]??{};
    const d=districtMap[id]; if(!d) return {};
    return districtResults(d,preset,swing,overrides[id]);
  },[simActive,simVotes,districtMap,preset,swing,overrides]);
  const fracOf=useCallback((id:string)=>{
    if(simActive) return simReported[id];
    if(preset==='blank') return projected.has(id)?(reporting[id]??100)/100:undefined;
    return undefined;
  },[simActive,simReported,preset,projected,reporting]);

  const declaredOnly=useMemo(()=> simActive ? new Set(Object.keys(simReported).filter(id=>(simReported[id]??0)>0)) : null,[simActive,simReported]);
  const blankProjected=useMemo(()=> (!simActive&&preset==='blank')?projected:null,[simActive,preset,projected]);

  const { seats, votePct, rawVotes } = useMemo(()=>{
    const seats:Record<PartyId,number>={D:0,I:0,R:0}; const votes:Record<PartyId,number>={D:0,I:0,R:0};
    for(const d of districts){
      const shown=(!declaredOnly||declaredOnly.has(d.id))&&(!blankProjected||blankProjected.has(d.id)); if(!shown) continue;
      const r=resultsOf(d.id); const w=winnerOf(r); if(w) seats[w]++; for(const p of US_LR_ORDER) votes[p]+=r[p]??0;
    }
    const tv=US_LR_ORDER.reduce((s,p)=>s+votes[p],0)||1;
    return { seats, votePct:{D:votes.D/tv*100,I:votes.I/tv*100,R:votes.R/tv*100} as Record<PartyId,number>, rawVotes:votes };
  },[districts,resultsOf,declaredOnly,blankProjected]);

  function stopSim(){ if(simTimerRef.current){clearInterval(simTimerRef.current);simTimerRef.current=null;} setSimRunning(false); }
  function resetScenario(){ setOverrides({});setProjected(new Set());setReporting({});setSimVotes({});setSimReported({});setSimDone(false);setSelected(null);setBaselineOpen(false);stopSim(); }
  function loadBaseline(){ if(simRunning)return; resetScenario(); setPreset('baseline'); }
  function load2026(){ if(simRunning)return; resetScenario(); setPreset('swing2026'); }
  function loadBlank(){ if(simRunning)return; resetScenario(); setPreset('blank'); }

  function runSim(){
    stopSim();
    const sched:Record<string,{start:number;final:Partial<Record<PartyId,number>>;seed:number}>={};
    for(const d of districts) sched[d.id]={ start:Math.random()*0.5, final:swungResults(d,simSwing), seed:Math.random()*6.28 };
    setSimVotes({});setSimReported({});setSimRunning(true);setSimDone(false);
    const t0=performance.now(); const dur=simDuration;
    simTimerRef.current=setInterval(()=>{
      const e=Math.min(1,(performance.now()-t0)/dur);
      const votes:Record<string,Partial<Record<PartyId,number>>>={}; const rep:Record<string,number>={};
      for(const d of districts){ const sc=sched[d.id]; const lf=Math.max(0,Math.min(1,(e-sc.start)/0.34)); if(lf<=0)continue; rep[d.id]=lf; votes[d.id]=noisyPartial(sc.final,lf,sc.seed,e>=1); }
      if(e>=1){ const fv:Record<string,Partial<Record<PartyId,number>>>={}; const fr:Record<string,number>={}; for(const d of districts){fv[d.id]=sched[d.id].final;fr[d.id]=1;} setSimVotes(fv);setSimReported(fr);setSimRefresh(x=>x+1);setSimRunning(false);setSimDone(true); if(simTimerRef.current){clearInterval(simTimerRef.current);simTimerRef.current=null;} return; }
      setSimVotes(votes);setSimReported(rep);setSimRefresh(x=>x+1);
    },180);
  }
  useEffect(()=>()=>{ if(simTimerRef.current)clearInterval(simTimerRef.current); },[]);

  const simReportedCount=Object.keys(simReported).length;
  const reportedFrac=useMemo(()=>{ if(!simActive)return 0; let r=0,t=0; for(const d of districts){t+=d.validVotes;r+=d.validVotes*(simReported[d.id]??0);} return t>0?r/t:0; },[simActive,simReported,districts]);

  const showDistrict=!!selected&&rightPanel!==('sim' as any)&&!simRunning;
  const btnBase='h-7 px-3 text-[11px] font-mono font-medium rounded-[4px] transition-colors duration-75 shrink-0 tracking-wide uppercase';
  const btnGold=`${btnBase} bg-gold text-white hover:bg-gold-deep`; const btnMuted=`${btnBase} border border-default text-ink-3 hover:bg-hover hover:text-ink`; const btnActive=`${btnBase} bg-ink/8 border border-default text-ink`;
  const selDistrict=selected?districtMap[selected]:null;

  return(
    <div className="flex flex-col h-screen bg-canvas overflow-hidden" data-country="us-house">
      <header className={`h-[52px] ${dark?'bg-[rgba(7,13,28,0.94)]':'bg-[rgba(245,244,240,0.92)]'} backdrop-blur-xl border-b border-default shadow-header shrink-0 flex items-center z-50`}>
        <button onClick={()=>navigate('/')} className="flex items-center gap-2.5 hover:opacity-80 cursor-pointer shrink-0 pl-4"><GlobeLogo/></button>
        <div className="flex-1 min-w-0 flex items-center gap-2 px-2 overflow-x-auto scroll-none">
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5"/>
          <span className="text-[11px] font-bold text-ink shrink-0 hidden sm:block">U.S. House</span>
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5"/>
          <button onClick={()=>!simRunning&&loadBaseline()} disabled={simRunning} className={`${preset==='baseline'?btnGold:btnMuted}${simRunning?' opacity-40 cursor-not-allowed':''}`}>2024 Result</button>
          <button onClick={()=>!simRunning&&load2026()} disabled={simRunning} className={`${preset==='swing2026'?btnGold:btnMuted}${simRunning?' opacity-40 cursor-not-allowed':''}`}>2026 Swing</button>
          <button onClick={()=>!simRunning&&loadBlank()} disabled={simRunning} className={`${preset==='blank'?btnGold:btnMuted}${simRunning?' opacity-40 cursor-not-allowed':''}`}>Blank Map</button>
          {preset==='swing2026'&&!simActive&&(
            <div className="flex items-center gap-1.5 shrink-0 px-2 py-1 rounded-[4px] border border-default">
              <span className="text-[9px] font-mono font-bold" style={{color:partyColor('D')}}>D</span>
              <input type="range" min={-0.12} max={0.12} step={0.005} value={swing} onChange={e=>setSwing(parseFloat(e.target.value))} style={{width:90}}/>
              <span className="text-[9px] font-mono font-bold" style={{color:partyColor('R')}}>R</span>
              <span className="text-[10px] font-mono font-bold tabular-nums" style={{color:swing>=0?partyColor('D'):partyColor('R'),minWidth:34}}>{swing>=0?'D+':'R+'}{Math.abs(swing*100).toFixed(1)}</span>
            </div>)}
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5"/>
          <button onClick={()=>{ if(rightPanel==='sim'){setRightPanel(null);} else {setSelected(null);setRightPanel('sim');} }} className={rightPanel==='sim'?btnActive:btnMuted}>▶ Simulation</button>
          <button onClick={()=>setScoreboardVisible(v=>!v)} className={scoreboardVisible?btnActive:btnMuted}>Scoreboard</button>
          <button onClick={()=>setRightPanel(p=>p==='breakdown'?null:'breakdown')} className={rightPanel==='breakdown'?btnActive:btnMuted}>Breakdown</button>
          <button onClick={()=>setLeftPanel(p=>p==='hemi'?null:'hemi')} className={leftPanel==='hemi'?btnActive:btnMuted}>Chamber</button>
          <button onClick={()=>setBubbleMap(v=>!v)} className={bubbleMap?`${btnBase} bg-emerald-600 text-white hover:bg-emerald-700`:btnMuted}>Bubble Map</button>
        </div>
        <div className="shrink-0 flex items-center gap-2 pr-4"><button onClick={()=>setDark(v=>!v)} className="w-7 h-7 flex items-center justify-center rounded-[4px] border border-default text-ink-3 hover:text-ink" title="Toggle dark mode">{dark?'☀':'☾'}</button></div>
      </header>

      {scoreboardVisible&&<Scoreboard seats={seats} votePct={votePct} rawVotes={rawVotes} dark={dark}/>}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {leftPanel==='hemi'&&<HemicyclePanel seats={seats} onClose={()=>setLeftPanel(null)} dark={dark}/>}

        <div className="relative flex-1 min-w-0 min-h-0">
          {geoData?<MapView geoData={geoData} districtMap={districtMap} resultsOf={resultsOf} fracOf={fracOf}
            declaredOnly={declaredOnly} blankProjected={blankProjected} selected={selected}
            onSelect={c=>setSelected(prev=>prev===c?null:c)} dark={dark} bubbleMap={bubbleMap} simActive={simActive} refresh={simRefresh}/>:<div className="w-full h-full flex items-center justify-center text-ink-3 font-mono text-sm">Loading 435 districts…</div>}
          {simActive&&(<div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1002] pointer-events-none" style={{background:'rgba(220,38,38,0.97)',borderRadius:999,padding:'6px 16px',boxShadow:'0 6px 24px rgba(220,38,38,0.45)',display:'flex',alignItems:'center',gap:10}}>
            <span className="relative flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"/><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white"/></span>
            <span className="text-white text-[12px] font-mono font-black uppercase tracking-[0.18em]">{simRunning?'Live':'Final'}</span>
            <span className="text-white/90 text-[11px] font-mono font-bold tabular-nums">{(reportedFrac*100).toFixed(1)}% counted</span>
            <span className="text-white/70 text-[11px] font-mono font-semibold tabular-nums">· {simReportedCount}/{districts.length}</span></div>)}
        </div>

        {rightPanel==='sim'&&(
          <aside className={`w-72 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
            <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0 flex items-center justify-between"><div><h2 className="text-[14px] font-bold text-ink leading-none">Simulation</h2><p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase">Election night · 435 races</p></div><button onClick={()=>setRightPanel(null)} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 text-base">×</button></div>
            <div className="px-3.5 pt-2.5 pb-2 border-b border-default shrink-0">
              <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3 mb-1.5">Speed</div>
              <div className="flex gap-1.5">{([['1m',60000],['2m',120000],['5m',300000],['10m',600000]] as const).map(([lbl,ms])=>(<button key={ms} onClick={()=>setSimDuration(ms)} className={`flex-1 py-1 rounded-[4px] border text-[9px] font-mono font-bold ${simDuration===ms?'bg-blue-600 text-white border-blue-600':'border-default text-ink-3 hover:bg-hover'}`}>{lbl}</button>))}</div>
            </div>
            <div className="px-3.5 pt-3 pb-2 border-b border-default shrink-0">
              <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3 mb-1.5">National swing to simulate</div>
              <div className="flex items-center gap-2"><span className="text-[10px] font-mono font-bold" style={{color:partyColor('D')}}>D</span>
                <input type="range" min={-0.12} max={0.12} step={0.005} value={simSwing} onChange={e=>setSimSwing(parseFloat(e.target.value))} className="flex-1" disabled={simRunning}/>
                <span className="text-[10px] font-mono font-bold" style={{color:partyColor('R')}}>R</span></div>
              <div className="text-center text-[12px] font-mono font-bold mt-1 tabular-nums" style={{color:simSwing>=0?partyColor('D'):partyColor('R')}}>{simSwing>=0?'D+':'R+'}{Math.abs(simSwing*100).toFixed(1)}</div>
            </div>
            <div className="flex-1 overflow-y-auto px-3.5 py-3 thin-scroll text-[10px] text-ink-3 leading-relaxed">
              Each of the 435 districts is called from its 2024 result shifted by the national swing. Districts begin reporting at random through the first half of the night, then their counts climb (with early noise) until certified. Watch the seat tally cross {US_MAJORITY}.
            </div>
            <div className="px-3.5 pb-3.5 pt-2 border-t border-default shrink-0 space-y-2">
              <button onClick={runSim} disabled={simRunning} className="w-full h-8 rounded-[4px] bg-blue-600 text-white text-[11px] font-mono font-semibold uppercase tracking-wide hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">{simRunning?`${simReportedCount}/435 reporting…`:'▶ Run Simulation'}</button>
              {(simActive)&&<button onClick={()=>{stopSim();setSimVotes({});setSimReported({});setSimDone(false);}} className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover">Reset</button>}
            </div>
          </aside>
        )}

        {showDistrict&&selDistrict&&baselineOpen&&<BaselinePopup d={selDistrict} onClose={()=>setBaselineOpen(false)} dark={dark}/>}
        {showDistrict&&selDistrict&&(
          <DistrictPanel key={selected!} d={selDistrict} preset={preset} swing={swing} override={overrides[selected!]}
            onOverride={r=>setOverrides(prev=>({...prev,[selected!]:r}))}
            onReset={()=>{setOverrides(prev=>{const n={...prev};delete n[selected!];return n;});setProjected(prev=>{const n=new Set(prev);n.delete(selected!);return n;});}}
            onClose={()=>{setSelected(null);setBaselineOpen(false);}}
            isBlank={preset==='blank'} projected={projected.has(selected!)} reportingPct={reporting[selected!]??100}
            onProject={()=>setProjected(prev=>new Set([...prev,selected!]))} onReportingChange={p=>setReporting(prev=>({...prev,[selected!]:p}))}
            dark={dark} baselineOpen={baselineOpen} onToggleBaseline={()=>setBaselineOpen(v=>!v)}/>
        )}

        {rightPanel==='breakdown'&&<BreakdownPanel districts={districts} resultsOf={resultsOf} seats={seats} votePct={votePct} onClose={()=>setRightPanel(null)} dark={dark}/>}
      </div>
    </div>
  );
}
