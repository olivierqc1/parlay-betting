// frontend/src/ParlayOptimizer.jsx
import { useState, useEffect, useMemo, useCallback } from "react";
const API = import.meta.env.VITE_API_URL || "";
const C = { bg:"#07090f",surface:"#0e1118",card:"#131824",border:"#1c2438",text:"#dde3f0",muted:"#4a5570",green:"#00e87a",red:"#ff4d5a",amber:"#f5a623",blue:"#4a9eff" };
const toDecimal=(o)=>{const n=parseFloat(o);if(isNaN(n))return null;return n>=0?n/100+1:100/Math.abs(n)+1};
const toAmerican=(d)=>d>=2?`+${Math.round((d-1)*100)}`:`${Math.round(-100/(d-1))}`;
const impliedProb=(o)=>{const n=parseFloat(o);return n<0?Math.abs(n)/(Math.abs(n)+100):100/(n+100)};
const pct=(n,d=1)=>n!=null?`${(n*100).toFixed(d)}%`:"—";
const fmt$=(n)=>`$${n.toFixed(2)}`;
const sportLabel=(k)=>k.replace("soccer_","").replace(/_/g," ").replace(/\b\w/g,(c)=>c.toUpperCase());
function combos(arr,k){if(k===0)return[[]];if(arr.length<k)return[];const[h,...t]=arr;return[...combos(t,k-1).map((c)=>[h,...c]),...combos(t,k)]}
function ValueBadge({edge}){if(edge==null)return<span style={{color:C.muted,fontSize:11}}>—</span>;const col=edge>0.08?C.green:edge>0?"#80d4a0":edge>-0.05?C.amber:C.red;return<span style={{fontSize:11,fontWeight:700,padding:"2px 7px",borderRadius:3,background:`${col}18`,color:col,border:`1px solid ${col}30`,fontFamily:"monospace",whiteSpace:"nowrap"}}>{edge>0?"+":""}{(edge*100).toFixed(1)}%</span>}
function FormPills({form}){if(!form)return null;const col={W:C.green,D:C.amber,L:C.red};return<span style={{display:"inline-flex",gap:2}}>{form.split("").map((c,i)=><span key={i} style={{width:14,height:14,borderRadius:2,fontSize:9,fontWeight:700,display:"inline-flex",alignItems:"center",justifyContent:"center",background:col[c]||C.muted,color:"#000"}}>{c}</span>)}</span>}
function OddsChip({odds}){const pos=parseFloat(odds)>0;return<span style={{fontSize:12,fontWeight:700,padding:"2px 8px",borderRadius:3,background:pos?`${C.green}15`:`${C.red}15`,color:pos?C.green:"#ff8a8a",border:`1px solid ${pos?C.green+"25":C.red+"25"}`,fontFamily:"monospace",whiteSpace:"nowrap"}}>{odds}</span>}
function Input({style,...props}){const[focus,setFocus]=useState(false);return<input {...props} onFocus={()=>setFocus(true)} onBlur={()=>setFocus(false)} style={{background:C.bg,border:`1px solid ${focus?C.blue:C.border}`,borderRadius:4,color:C.text,fontFamily:"monospace",fontSize:12,padding:"7px 10px",outline:"none",transition:"border-color 0.15s",...style}}/>}
function Btn({primary,danger,small,disabled,children,style,onClick}){return<button onClick={onClick} disabled={disabled} style={{fontFamily:"monospace",fontWeight:700,fontSize:small?10:11,letterSpacing:"0.06em",textTransform:"uppercase",border:"none",borderRadius:4,cursor:disabled?"not-allowed":"pointer",padding:small?"4px 10px":"7px 14px",background:primary?C.green:danger?`${C.red}20`:C.card,color:primary?"#000":danger?C.red:C.muted,border:`1px solid ${primary?C.green:danger?C.red+"40":C.border}`,opacity:disabled?0.4:1,transition:"opacity 0.15s",...style}}>{children}</button>}
function FilterBtn({active,onClick,children}){return<button onClick={onClick} style={{background:active?`${C.green}18`:"transparent",color:active?C.green:C.muted,border:`1px solid ${active?C.green+"40":C.border}`,borderRadius:4,padding:"4px 10px",fontFamily:"monospace",fontSize:10,cursor:"pointer",textTransform:"uppercase",letterSpacing:"0.05em"}}>{children}</button>}
function Card({children,style}){return<div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:7,padding:"14px 16px",marginBottom:12,...style}}>{children}</div>}
function Label({children}){return<div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.14em",marginBottom:12,fontFamily:"monospace"}}>{children}</div>}
export default function ParlayOptimizer(){
  const[tab,setTab]=useState("matches");
  const[matches,setMatches]=useState([]);
  const[loading,setLoading]=useState(false);
  const[error,setError]=useState(null);
  const[picks,setPicks]=useState([]);
  const[legSize,setLegSize]=useState(3);
  const[stake,setStake]=useState(20);
  const[selected,setSelected]=useState(new Set());
  const[sortBy,setSortBy]=useState("value");
  const[manual,setManual]=useState({team:"",matchup:"",odds:""});
  const[minValue,setMinValue]=useState(-99);
  const fetchMatches=useCallback(async()=>{
    setLoading(true);setError(null);
    try{const r=await fetch(`${API}/api/parlay/upcoming`);if(!r.ok)throw new Error(`Erreur serveur ${r.status}`);const data=await r.json();setMatches(data.matches||[]);}
    catch(e){setError(e.message);}finally{setLoading(false);}
  },[]);
  useEffect(()=>{fetchMatches();},[fetchMatches]);
  const addPick=(match,side)=>{
    const team=side==="home"?match.homeTeam:match.awayTeam;
    const matchup=`${match.homeTeam} vs ${match.awayTeam}`;
    if(picks.some((p)=>p.matchup===matchup))return;
    setPicks((prev)=>[...prev,{id:`${match.id}_${side}`,team,matchup,odds:String(match.odds[side]),valueEdge:match.value?.[side]??null,realProb:match.realProb?.[side]??null,impliedProb:match.impliedProb?.[side]??null}]);
    setTab("builder");
  };
  const addManual=()=>{
    if(!manual.team.trim()||!manual.odds.trim()||!toDecimal(manual.odds))return;
    setPicks((prev)=>[...prev,{id:String(Date.now()),team:manual.team.trim(),matchup:manual.matchup.trim()||manual.team.trim(),odds:manual.odds.trim(),valueEdge:null,realProb:null,impliedProb:impliedProb(manual.odds)}]);
    setManual({team:"",matchup:"",odds:""});
  };
  const removePick=(id)=>setPicks((prev)=>prev.filter((p)=>p.id!==id));
  const parlays=useMemo(()=>{
    if(picks.length<legSize)return[];
    return combos(picks,legSize).map((legs)=>{
      const dec=legs.reduce((a,p)=>a*toDecimal(p.odds),1);
      const win=stake*dec-stake;
      const edges=legs.map((l)=>l.valueEdge).filter((v)=>v!=null);
      const avgEdge=edges.length?edges.reduce((a,b)=>a+b,0)/edges.length:null;
      return{id:legs.map((l)=>l.id).join("|"),legs,dec,win,american:toAmerican(dec),avgEdge};
    });
  },[picks,legSize,stake]);
  const sortedParlays=useMemo(()=>[...parlays].sort((a,b)=>sortBy==="value"?(b.avgEdge??-99)-(a.avgEdge??-99):b.dec-a.dec),[parlays,sortBy]);
  const selList=sortedParlays.filter((p)=>selected.has(p.id));
  const totalRisk=selList.length*stake;
  const totalWin=selList.reduce((s,p)=>s+p.win,0);
  const avgDec=selList.length?selList.reduce((s,p)=>s+p.dec,0)/selList.length:0;
  const filteredMatches=useMemo(()=>matches.filter((m)=>{if(!m.value)return minValue<=0;return Math.max(m.value.home??-99,m.value.away??-99)>=minValue;}),[matches,minValue]);
  return(
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:"monospace",padding:"20px 16px",maxWidth:1000,margin:"0 auto"}}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600;700&display=swap" rel="stylesheet"/>
      <div style={{marginBottom:20,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
        <div>
          <h2 style={{margin:0,fontSize:18,fontWeight:700,color:C.green,fontFamily:"'IBM Plex Sans',sans-serif"}}>⬡ Parlay Optimizer</h2>
          <p style={{margin:"2px 0 0",fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.1em"}}>Value model · Combinaisons · Diversification</p>
        </div>
        <div style={{flex:1}}/>
        {picks.length>0&&<div style={{background:`${C.green}15`,border:`1px solid ${C.green}30`,borderRadius:20,padding:"4px 12px",fontSize:11,color:C.green}}>{picks.length} picks · {combos(picks,legSize).length} combos</div>}
      </div>
      <div style={{display:"flex",gap:2,marginBottom:18,borderBottom:`1px solid ${C.border}`}}>
        {["matches","builder"].map((t)=>(
          <button key={t} onClick={()=>setTab(t)} style={{background:"transparent",border:"none",borderBottom:`2px solid ${tab===t?C.green:"transparent"}`,color:tab===t?C.green:C.muted,fontFamily:"monospace",fontSize:11,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",padding:"8px 16px",cursor:"pointer",marginBottom:-1,transition:"color 0.15s"}}>
            {t==="builder"&&picks.length>0?`Builder (${picks.length})`:t==="matches"&&filteredMatches.length>0?`Matchs (${filteredMatches.length})`:t.charAt(0).toUpperCase()+t.slice(1)}
          </button>
        ))}
      </div>
      {tab==="matches"&&(
        <div>
          <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
            <Btn primary onClick={fetchMatches} disabled={loading}>{loading?"Chargement…":"↻ Actualiser"}</Btn>
            <span style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.1em"}}>Filtre Value ≥</span>
            {[[-99,"Tous"],[0,"+EV"],[0.05,"+5%"],[0.10,"+10%"]].map(([v,l])=>(
              <FilterBtn key={v} active={minValue===v} onClick={()=>setMinValue(v)}>{l}</FilterBtn>
            ))}
          </div>
          {error&&<div style={{background:`${C.red}15`,border:`1px solid ${C.red}40`,borderRadius:6,padding:"10px 14px",marginBottom:14,fontSize:12,color:C.red}}>⚠ {error} — vérifie ODDS_API_KEY dans les variables Render</div>}
          {loading&&<div style={{textAlign:"center",padding:48,color:C.muted,fontSize:12}}>Analyse des matchs en cours…</div>}
          {!loading&&!error&&filteredMatches.length===0&&<div style={{textAlign:"center",padding:48,color:C.muted,fontSize:12}}>Aucun match — ajuste le filtre ou actualise</div>}
          {filteredMatches.map((m)=>{
            const picked=(side)=>picks.some((p)=>p.id===`${m.id}_${side}`);
            return(
              <Card key={m.id}>
                <div style={{display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:8,marginBottom:10}}>
                  <div>
                    <div style={{fontSize:14,fontWeight:600,fontFamily:"'IBM Plex Sans',sans-serif"}}>{m.homeTeam} <span style={{color:C.muted,fontSize:11}}>vs</span> {m.awayTeam}</div>
                    <div style={{fontSize:10,color:C.muted,marginTop:3,textTransform:"uppercase",letterSpacing:"0.07em"}}>{sportLabel(m.sport)} · {m.commenceTime?new Date(m.commenceTime).toLocaleDateString("fr-CA",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}):"Date inconnue"}</div>
                  </div>
                  {m.realProb&&<div style={{fontSize:10,color:C.muted,textAlign:"right"}}><div>Écart rang: <span style={{color:C.amber,fontWeight:700}}>{m.realProb.rankGap}</span></div><div style={{display:"flex",gap:4,marginTop:4,justifyContent:"flex-end",alignItems:"center"}}><FormPills form={m.realProb.homeForm}/> <span>vs</span> <FormPills form={m.realProb.awayForm}/></div></div>}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  {["home","away"].map((side)=>{
                    const team=side==="home"?m.homeTeam:m.awayTeam;
                    const odds=m.odds[side];
                    const imp=m.impliedProb?.[side];
                    const real=m.realProb?.[side];
                    const edge=m.value?.[side];
                    const isVal=edge!=null&&edge>0;
                    const isPicked=picked(side);
                    return(
                      <div key={side} style={{background:isVal?`${C.green}08`:C.surface,border:`1px solid ${isVal?C.green+"30":C.border}`,borderRadius:5,padding:"10px 12px"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                          <span style={{fontSize:12,fontWeight:600,fontFamily:"'IBM Plex Sans',sans-serif"}}>{team}{side==="home"&&<span style={{fontSize:9,color:C.muted,marginLeft:5}}>(DOM)</span>}</span>
                          <OddsChip odds={String(odds)}/>
                        </div>
                        <div style={{display:"flex",gap:10,marginBottom:8,flexWrap:"wrap"}}>
                          <div style={{fontSize:10,color:C.muted}}>Implicite <span style={{color:C.text,fontWeight:600}}>{pct(imp)}</span></div>
                          {real!=null&&<div style={{fontSize:10,color:C.muted}}>Réel <span style={{color:C.green,fontWeight:600}}>{pct(real)}</span></div>}
                          {m.realProb&&<div style={{fontSize:10,color:C.muted}}>PPG <span style={{color:C.text,fontWeight:600}}>{side==="home"?m.realProb.homePpg:m.realProb.awayPpg}</span></div>}
                        </div>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:10,color:C.muted}}>Edge</span><ValueBadge edge={edge}/></div>
                          <Btn small primary={isVal&&!isPicked} disabled={isPicked} onClick={()=>addPick(m,side)}>{isPicked?"✓ Ajouté":isVal?"★ Ajouter":"+ Pick"}</Btn>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {tab==="builder"&&(
        <div>
          <Card>
            <Label>Ajouter manuellement</Label>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <Input placeholder="Équipe gagnante" value={manual.team} onChange={(e)=>setManual({...manual,team:e.target.value})} style={{flex:"1 1 130px"}}/>
              <Input placeholder="Matchup (optionnel)" value={manual.matchup} onChange={(e)=>setManual({...manual,matchup:e.target.value})} style={{flex:"2 1 160px"}}/>
              <Input placeholder="-110 ou +150" value={manual.odds} onChange={(e)=>setManual({...manual,odds:e.target.value})} onKeyDown={(e)=>e.key==="Enter"&&addManual()} style={{width:95}}/>
              <Btn primary onClick={addManual}>+ Ajouter</Btn>
            </div>
          </Card>
          {picks.length>0&&(
            <Card>
              <Label>Picks sélectionnés ({picks.length})</Label>
              {picks.map((p)=>(
                <div key={p.id} style={{display:"flex",alignItems:"center",gap:10,background:C.surface,borderRadius:4,padding:"8px 12px",marginBottom:6,border:`1px solid ${C.border}`}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:600,fontFamily:"'IBM Plex Sans',sans-serif"}}>{p.team}</div>
                    <div style={{fontSize:10,color:C.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.matchup}</div>
                  </div>
                  <OddsChip odds={p.odds}/>
                  <ValueBadge edge={p.valueEdge}/>
                  <Btn danger small onClick={()=>removePick(p.id)}>✕</Btn>
                </div>
              ))}
            </Card>
          )}
          <Card style={{padding:"12px 16px"}}>
            <div style={{display:"flex",gap:16,flexWrap:"wrap",alignItems:"center"}}>
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                <span style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.1em"}}>Legs</span>
                {[2,3,4,5].map((n)=><FilterBtn key={n} active={legSize===n} onClick={()=>setLegSize(n)}>{n}</FilterBtn>)}
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <span style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.1em"}}>Mise $</span>
                <Input type="number" min="1" value={stake} onChange={(e)=>setStake(Math.max(1,parseFloat(e.target.value)||1))} style={{width:70}}/>
              </div>
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                <span style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.1em"}}>Trier</span>
                <FilterBtn active={sortBy==="value"} onClick={()=>setSortBy("value")}>Value</FilterBtn>
                <FilterBtn active={sortBy==="odds"} onClick={()=>setSortBy("odds")}>Cotes</FilterBtn>
              </div>
              <div style={{flex:1}}/>
              <span style={{fontSize:11,color:C.muted}}>{sortedParlays.length} combinaisons</span>
              <Btn small onClick={()=>setSelected(new Set(sortedParlays.map((p)=>p.id)))}>Tout cocher</Btn>
              <Btn small onClick={()=>setSelected(new Set())}>Reset</Btn>
            </div>
          </Card>
          {selList.length>0&&(
            <div style={{background:`${C.green}09`,border:`1px solid ${C.green}25`,borderRadius:7,padding:"14px 18px",marginBottom:12,display:"flex",gap:20,flexWrap:"wrap"}}>
              {[["Parlays joués",selList.length,C.text],["Total risqué",fmt$(totalRisk),"#ff8a8a"],["Gain max cumulé",fmt$(totalWin),C.green],["ROI max",`+${((totalWin/totalRisk)*100).toFixed(0)}%`,C.green],["Seuil rentabilité",`≥ ${Math.ceil(totalRisk/(stake*avgDec-stake+stake))} / ${selList.length} gagnés`,C.amber]].map(([label,val,color])=>(
                <div key={label}>
                  <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:3}}>{label}</div>
                  <div style={{fontSize:18,fontWeight:700,color,fontFamily:"monospace"}}>{val}</div>
                </div>
              ))}
            </div>
          )}
          {picks.length<legSize?(
            <div style={{textAlign:"center",padding:48,color:C.muted,fontSize:12}}>Ajoute au moins {legSize} picks pour générer les parlays</div>
          ):(
            sortedParlays.map((p)=>{
              const sel=selected.has(p.id);
              const isGreen=p.avgEdge!=null&&p.avgEdge>0;
              return(
                <div key={p.id} onClick={()=>setSelected((prev)=>{const next=new Set(prev);next.has(p.id)?next.delete(p.id):next.add(p.id);return next;})}
                  style={{background:sel?`${C.green}07`:C.surface,border:`1px solid ${sel?C.green+"35":C.border}`,borderRadius:6,padding:"11px 14px",marginBottom:7,cursor:"pointer",transition:"all 0.15s"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <div style={{width:14,height:14,borderRadius:3,flexShrink:0,border:`2px solid ${sel?C.green:C.border}`,background:sel?C.green:"transparent",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.15s"}}>
                        {sel&&<span style={{fontSize:9,color:"#000",fontWeight:900}}>✓</span>}
                      </div>
                      <span style={{fontSize:15,fontWeight:700,color:isGreen?C.green:C.text}}>{p.american}</span>
                      <span style={{fontSize:11,color:C.muted}}>({p.dec.toFixed(2)}x)</span>
                      {p.avgEdge!=null&&<span style={{fontSize:10,color:C.muted}}>avg edge: <ValueBadge edge={p.avgEdge}/></span>}
                    </div>
                    <div>
                      <span style={{fontSize:13,fontWeight:700,color:C.green}}>{fmt$(stake)} → {fmt$(p.win+stake)}</span>
                      <span style={{fontSize:10,color:C.muted,marginLeft:6}}>(+{fmt$(p.win)})</span>
                    </div>
                  </div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                    {p.legs.map((leg)=>(
                      <span key={leg.id} style={{fontSize:11,padding:"2px 8px",borderRadius:3,background:"rgba(255,255,255,0.04)",border:`1px solid ${C.border}`,color:"#8090b0"}}>
                        {leg.team}&nbsp;<OddsChip odds={leg.odds}/>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
