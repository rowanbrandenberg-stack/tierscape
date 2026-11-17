/* eslint-disable */
// @ts-nocheck
/**
 * Stand in illustration of the finished yard for each tier, used until a real
 * photo render exists. It is deliberately simple and never shown as the job's
 * actual result.
 */
import { COLORS, DEFAULT_TIER_MAP, GENERIC_SIZE } from "./catalog";
import { serviceFor } from "./pricing";
import type { Pricing } from "./settings";
import type { Job, TierKey } from "./types";

let uid = 0;
function rng(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }

/** Which tier's look each area type takes, based on the service the tier is set to. */
function lookFor(pricing: Pricing, t: TierKey) {
  const k = (type) => {
    const id = serviceFor(pricing, type, t).id;
    return (Object.keys(DEFAULT_TIER_MAP[type]) as TierKey[]).find((x) => DEFAULT_TIER_MAP[type][x] === id) ?? t;
  };
  return { lawn: k("lawn"), bed: k("bed"), patio: k("patio") };
}

export function yardIllustration(job: Pick<Job, "areas" | "plants" | "site">, pricing: Pricing, t: TierKey | "before"): string {
  const has = {}; job.areas.forEach((a) => (has[a.type] = 1));
  const plants = job.plants, ext = job.site.extent;
  const patio = job.areas.find((a) => a.type === "patio");
  const look = t === "before" ? { lawn: "basic", bed: "basic", patio: "basic", paverHex: "#c9b08a" } : { ...lookFor(pricing, t), paverHex: COLORS[patio ? patio.paver.color : "sand"].hex };

  const r=rng(11),L=(a,b,k)=>[a[0]+(b[0]-a[0])*k,a[1]+(b[1]-a[1])*k];
  const FL=[400,305],FR=[690,305],NR=[800,440],NL=[330,440],P=(u,v)=>L(L(FL,FR,u),L(NL,NR,u),v),pt=a=>a.map(n=>n.toFixed(1)).join(',');
  const tl=look.lawn,tb=look.bed,tp=look.patio,pc=look.paverHex;
  const U='g'+(++uid), done=t!=='before', sky=t==='premium'?['#f3b47c','#fbe6c8']:['#93c2e4','#e1eef6'];
  let s=`<svg viewBox="0 0 800 450" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${done?t+' tier finished yard':'yard as it looks today'}"><defs><linearGradient id="s${U}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/></linearGradient><radialGradient id="w${U}"><stop offset="0" stop-color="#ffd27a" stop-opacity=".95"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient></defs>`;
  s+=`<rect width="800" height="240" fill="url(#s${U})"/><path d="M0 178L110 150L205 118L285 92L345 116L420 84L505 128L610 150L800 170V215H0Z" fill="${t==='premium'?'#9a8aa3':'#7f9ab5'}"/><path d="M270 100L285 92L300 104L345 116L360 108L420 84L450 104L410 100L385 112L345 122L310 108Z" fill="#fff" opacity=".75"/>`;
  for(let x=-10;x<820;x+=20){const h=30+r()*30;s+=`<path d="M${x} 205L${x+11} ${(205-h).toFixed(0)}L${x+22} 205Z" fill="${r()>.5?'#2f5238':'#3a6142'}"/>`}
  s+=`<rect y="180" width="800" height="58" fill="#9a7350"/><rect y="180" width="800" height="5" fill="#b28a63"/>`;
  for(let x=0;x<800;x+=20)s+=`<path d="M${x} 185V238" stroke="#7f5d3f" stroke-width="1.5"/>`;
  s+=`<path d="M0 236H800V450H0Z" fill="${done?'#a6906c':'#b59a77'}"/>`;
  /* lawn */
  if(done&&has.lawn){
    s+=`<path d="M0 272L800 266V450H0Z" fill="${tl==='basic'?'#9cb46a':'#5d9947'}"/>`;
    if(tl==='basic'){for(let i=0;i<70;i++){const x=r()*800,y=280+r()*165;s+=`<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="${(8+r()*14).toFixed(0)}" ry="3" fill="#b3a878" opacity=".5"/>`}}
    else for(let i=0;i<10;i+=2){const a=i*80,b=-250+i*130;s+=`<path d="M${a} 267L${a+80} 267L${b+130} 450L${b} 450Z" fill="#74ad59" opacity=".55"/>`}
  }else{
    for(let i=0;i<26;i++){const x=r()*800,y=285+r()*160;s+=`<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="${(18+r()*40).toFixed(0)}" ry="${(4+r()*8).toFixed(0)}" fill="${r()>.5?'#b0aa6c':'#9a8563'}" opacity=".75"/>`}
    for(let i=0;i<34;i++){const x=r()*800,y=262+r()*180;s+=`<path d="M${x.toFixed(0)} ${y.toFixed(0)}l-5 -11m5 11l1 -14m-1 14l6 -10" stroke="#7d8a45" stroke-width="2" fill="none"/>`}
  }
  /* bed along the fence */
  if(done&&has.bed){
    s+=`<path d="M0 236H800V266L0 274Z" fill="${tb==='premium'?'#8a3d2c':'#6a4a34'}"/>`;
    if(tb!=='basic')s+=`<path d="M0 274L800 266" stroke="#33312e" stroke-width="3"/>`;
    if(tb==='premium'){for(const x of [95,165,650]){s+=`<rect x="${x-3}" y="120" width="6" height="135" fill="#ece9df"/><path d="M${x-3} 150h6M${x-3} 185h6M${x-3} 215h6" stroke="#55514a" stroke-width="2"/><circle cx="${x}" cy="112" r="34" fill="#a9bd3f"/><circle cx="${x-18}" cy="128" r="22" fill="#c6c23d"/><circle cx="${x+20}" cy="124" r="24" fill="#93ad3a"/>`}
      for(const x of [250,470,730])s+=`<path d="M${x} 268l8 -20l22 -8l24 10l6 18Z" fill="#4b4845"/><path d="M${x+8} 248l22 -8l10 14l-18 6Z" fill="#65615d"/>`;}
    const n=tb==='basic'?8:tb==='standard'?11:13;
    for(let i=0;i<n;i++){const x=40+i*(740/n)+r()*20,rad=tb==='basic'?9+r()*3:15+r()*7,c=['#3f7a3a','#6a9a4a','#8ea27a'][i%3];
      s+=`<circle cx="${x.toFixed(0)}" cy="${(258-rad*.5).toFixed(0)}" r="${rad.toFixed(0)}" fill="${c}"/>`;
      if(tb!=='basic')for(let k=0;k<5;k++)s+=`<circle cx="${(x+18+r()*22).toFixed(0)}" cy="${(250+r()*14).toFixed(0)}" r="3.2" fill="${k%2?'#7b4fd6':'#e8508a'}"/>`;}
    if(tb==='premium')for(const x of [300,560])s+=`<circle cx="${x}" cy="252" r="30" fill="url(#w${U})"/><rect x="${x-2}" y="252" width="4" height="14" fill="#2b2b2b"/>`;
  }
  /* placed plants, drawn at their local size. Smaller tiers show younger stock */
  if(done){const f=t==='basic'?.5:t==='standard'?.75:1;
    for(const p of plants)for(const [mx,my] of p.spots){const v=(my-ext.y)/ext.h; if(v>.45)continue; const e=p.estimate?{h:p.estimate.heightFt,w:p.estimate.spreadFt}:{h:GENERIC_SIZE[p.kind][0],w:GENERIC_SIZE[p.kind][1]},x=Number((20+((mx-ext.x)/ext.w)*760).toFixed(0)),y=250+v/.45*46,H=Math.min(190,Math.max(8,e.h*f*9)),W=Math.min(130,Math.max(8,e.w*f*9));
      if(p.kind==='tree')s+=`<rect x="${x-3}" y="${(y-H*.5).toFixed(0)}" width="6" height="${(H*.5).toFixed(0)}" fill="#5b4332"/><ellipse cx="${x}" cy="${(y-H*.62).toFixed(0)}" rx="${(W/2).toFixed(0)}" ry="${(H*.42).toFixed(0)}" fill="#4c8a45"/><ellipse cx="${x-W*.14}" cy="${(y-H*.72).toFixed(0)}" rx="${(W*.3).toFixed(0)}" ry="${(H*.24).toFixed(0)}" fill="#66a65a"/>`;
      else if(p.kind==='shrub')s+=`<ellipse cx="${x}" cy="${(y-H*.45).toFixed(0)}" rx="${(W/2).toFixed(0)}" ry="${(H/2).toFixed(0)}" fill="#5d8f4e"/>`;
      else s+=`<ellipse cx="${x}" cy="${(y-H*.4).toFixed(0)}" rx="${(W/2).toFixed(0)}" ry="${(H*.45).toFixed(0)}" fill="#6f9a52"/><circle cx="${x}" cy="${(y-H*.8).toFixed(0)}" r="3" fill="#7b4fd6"/><circle cx="${x+4}" cy="${(y-H*.6).toFixed(0)}" r="2.5" fill="#7b4fd6"/>`;}}
  /* patio */
  if(!done){
    s+=`<path d="M${pt(P(.2,.15))} ${pt(P(.7,.15))} ${pt(P(.76,.7))} ${pt(P(.14,.7))}Z" fill="#a8a49b"/><path d="M${pt(P(.3,.15))}L${pt(P(.42,.4))}L${pt(P(.36,.7))}M${pt(P(.42,.4))}L${pt(P(.74,.5))}" stroke="#6f6b63" stroke-width="2.5" fill="none"/>`;
  }else if(has.patio){
    const out=`M${pt(FL)} ${pt(FR)} ${pt(NR)} ${pt(NL)}Z`;
    if(tp==='basic'){s+=`<path d="${out}" fill="#d3ba90"/>`;for(let i=0;i<150;i++){const q=P(r(),r());s+=`<circle cx="${q[0].toFixed(0)}" cy="${q[1].toFixed(0)}" r="1.6" fill="#b3966a"/>`}s+=`<path d="${out}" fill="none" stroke="#4a4038" stroke-width="3"/>`}
    if(tp==='standard'){s+=`<path d="${out}" fill="${pc}"/>`;for(let i=1;i<14;i++)s+=`<path d="M${pt(P(i/14,0))}L${pt(P(i/14,1))}" stroke="#00000040" stroke-width="1.2"/>`;for(let j=1;j<7;j++)s+=`<path d="M${pt(P(0,j/7))}L${pt(P(1,j/7))}" stroke="#00000040" stroke-width="1.2"/>`;s+=`<path d="${out}" fill="none" stroke="#8a7767" stroke-width="6"/>`;
      const c=P(.5,.45);s+=`<ellipse cx="${c[0]}" cy="${c[1]+26}" rx="46" ry="12" fill="#00000022"/><ellipse cx="${c[0]}" cy="${c[1]}" rx="42" ry="13" fill="#6b5340"/><rect x="${c[0]-3}" y="${c[1]}" width="6" height="26" fill="#4d3c2e"/>`;}
    if(tp==='premium'){
      const V=[];for(let j=0;j<=4;j++){V[j]=[];for(let i=0;i<=7;i++){const e=i===0||i===7,f=j===0||j===4;V[j][i]=P(i/7+(e?0:(r()-.5)*.07),j/4+(f?0:(r()-.5)*.12))}}
      const cols=['#d9b68c','#c99f77','#e2c49e','#c2956c'];s+=`<path d="${out}" fill="#8b7359"/>`;
      for(let j=0;j<4;j++)for(let i=0;i<7;i++)s+=`<path d="M${pt(V[j][i])} ${pt(V[j][i+1])} ${pt(V[j+1][i+1])} ${pt(V[j+1][i])}Z" fill="${cols[(i*3+j*5+(r()*2|0))%4]}" stroke="#8b7359" stroke-width="2.5"/>`;
      const a=P(.04,0),b=P(.96,0);s+=`<path d="M${a[0]} ${a[1]}H${b[0]}V${b[1]-24}H${a[0]}Z" fill="#8d7b6a"/><path d="M${a[0]-4} ${a[1]-24}H${b[0]+4}V${b[1]-31}H${a[0]-4}Z" fill="#b8a795"/>`;
      for(let x=a[0]+30;x<b[0];x+=34)s+=`<path d="M${x} ${a[1]-24}V${a[1]}" stroke="#75655a" stroke-width="1.5"/>`;
      const c=P(.5,.5);s+=`<circle cx="${c[0]}" cy="${c[1]-14}" r="105" fill="url(#w${U})" opacity=".8"/><ellipse cx="${c[0]}" cy="${c[1]}" rx="50" ry="19" fill="#6e625a"/><ellipse cx="${c[0]}" cy="${c[1]-3}" rx="38" ry="13" fill="#2b2522"/><path d="M${c[0]-20} ${c[1]-3}q4 -30 14 -40q2 16 10 20q2 -14 10 -22q8 20 6 42Z" fill="#f08a24"/><path d="M${c[0]-9} ${c[1]-3}q2 -16 9 -24q6 12 8 24Z" fill="#ffd45e"/>`;
      for(const [u,v] of [[0,.25],[0,.8],[1,.25],[1,.8]]){const q=P(u,v);s+=`<circle cx="${q[0]}" cy="${q[1]-14}" r="28" fill="url(#w${U})"/><rect x="${q[0]-2}" y="${q[1]-16}" width="4" height="16" fill="#262626"/><rect x="${q[0]-5}" y="${q[1]-20}" width="10" height="5" fill="#262626"/>`}
    }
  }
  return s+'</svg>';
}
