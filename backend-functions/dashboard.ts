Deno.serve(async (req) => {
  const h = {
    "Content-Type": "text/html; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,user-scalable=no">
<meta name="theme-color" content="#05050a">
<title>GOLD SNIPER Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#05050a;--card:#0a0a14;--border:#1a1a2e;--green:#26a69a;--red:#ef5350;--gold:#FFD700;--blue:#2196f3;--text:#e0e0e0;--muted:#666}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;padding:12px;max-width:100%}
.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.logo{font-size:18px;font-weight:700;color:var(--gold);letter-spacing:1px}
.logo span{color:var(--text);font-weight:300}
.badge{padding:4px 10px;border-radius:12px;font-size:10px;font-weight:600}
.badge.live{background:rgba(38,166,154,.15);color:var(--green);border:1px solid rgba(38,166,154,.3)}
.badge.off{background:rgba(239,83,80,.15);color:var(--red);border:1px solid rgba(239,83,80,.3)}
.grid{display:grid;gap:10px}
.price-card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px;text-align:center}
.price{font-size:36px;font-weight:700;color:var(--gold)}
.chg{font-size:13px;margin-top:4px}
.chg.up{color:var(--green)}.chg.dn{color:var(--red)}
.tick-info{font-size:10px;color:var(--muted);margin-top:6px}
.stats{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:10px}
.stat{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:10px}
.stat .lbl{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px}
.stat .val{font-size:16px;font-weight:600;margin-top:2px}
.stat .val.green{color:var(--green)}.stat .val.red{color:var(--red)}
.trades{margin-top:10px}
.trade{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:8px}
.trade-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.tf{font-size:12px;font-weight:700;padding:2px 8px;border-radius:4px}
.tf.long{background:rgba(38,166,154,.15);color:var(--green)}
.tf.short{background:rgba(239,83,80,.15);color:var(--red)}
.lvls{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;font-size:11px}
.lvl{padding:6px;border-radius:4px;background:rgba(255,255,255,.03);text-align:center}
.lvl .l{font-size:9px;color:var(--muted)}.lvl .v{font-size:12px;font-weight:600}
.lvl.hit{background:rgba(38,166,154,.1);border:1px solid rgba(38,166,154,.2)}
.lvl.sl{background:rgba(239,83,80,.1);border:1px solid rgba(239,83,80,.2)}
.progress{height:4px;background:var(--border);border-radius:2px;margin-top:8px;overflow:hidden}
.progress-bar{height:100%;background:var(--gold);transition:width .5s}
.loading{text-align:center;padding:40px;color:var(--muted)}
</style>
</head>
<body>
<div class="header">
<div class="logo">GOLD <span>SNIPER</span></div>
<div id="feedBadge" class="badge off">FEED OFFLINE</div>
</div>
<div id="content"><div class="loading">Connecting to backend...</div></div>
<script src="https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js"></script>
<script>
const API='https://base44.app/api/apps/6a59ebfbbec4437165873f86/functions/getLivePrice';
let prevPrice=0;
async function poll(){
  try{
    const r=await fetch(API);
    const d=await r.json();
    document.getElementById('feedBadge').className='badge live';
    document.getElementById('feedBadge').textContent='FEED LIVE';
    render(d);
  }catch(e){
    document.getElementById('feedBadge').className='badge off';
    document.getElementById('feedBadge').textContent='FEED OFFLINE';
  }
}
function fmt(n){return n?n.toFixed(2):'--';}
function render(d){
  const p=d.price||0;
  const flash=prevPrice&&p>prevPrice?'#26a69a':prevPrice&&p<prevPrice?'#ef5350':'#FFD700';
  prevPrice=p;
  const chg=d.change||0;
  const chgPct=d.changePct||0;
  const chgClass=chg>=0?'up':'dn';
  const chgSign=chg>=0?'+':'';
  let h='<div class="price-card">';
  h+='<div class="price" style="color:'+flash+'">'+fmt(p)+'</div>';
  h+='<div class="chg '+chgClass+'">'+chgSign+fmt(chg)+' ('+chgPct.toFixed(2)+'%)</div>';
  h+='<div class="tick-info">Updated: '+(d.timestamp||'--')+'</div>';
  h+='</div>';
  if(d.activeTrades&&d.activeTrades.length>0){
    h+='<div class="trades">';
    d.activeTrades.forEach(t=>{
      const dir=t.direction||'long';
      const cls=dir==='long'?'long':'short';
      const arrow=dir==='long'?'▲':'▼';
      const tps=[t.tp1,t.tp2,t.tp3,t.tp4,t.tp5];
      const hits=[t.tp1Hit,t.tp2Hit,t.tp3Hit,t.tp4Hit,t.tp5Hit];
      const hitCount=hits.filter(x=>x).length;
      const prog=(hitCount/5)*100;
      h+='<div class="trade">';
      h+='<div class="trade-hdr">';
      h+='<span class="tf '+cls+'">'+arrow+' '+t.timeframe+' #'+t.cycle+'</span>';
      h+='<span style="font-size:11px;color:var(--muted)">'+hitCount+'/5 TP</span>';
      h+='</div>';
      h+='<div class="stats">';
      h+='<div class="stat"><div class="lbl">Entry</div><div class="val">'+fmt(t.entry)+'</div></div>';
      h+='<div class="stat"><div class="lbl">SL</div><div class="val red">'+fmt(t.sl)+'</div></div>';
      h+='<div class="stat"><div class="lbl">ATR</div><div class="val">'+fmt(t.atr)+'</div></div>';
      h+='</div>';
      h+='<div class="lvls" style="display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin-top:8px">';
      for(let i=0;i<5;i++){
        const hit=hits[i];
        const cls2=hit?'hit':'';
        h+='<div class="lvl '+cls2+'"><div class="l">TP'+(i+1)+'</div><div class="v">'+(tps[i]?tps[i].toFixed(1):'--')+'</div></div>';
      }
      h+='</div>';
      h+='<div class="progress"><div class="progress-bar" style="width:'+prog+'%"></div></div>';
      h+='</div>';
    });
    h+='</div>';
  }
  document.getElementById('content').innerHTML=h;
}
poll();
setInterval(poll,5000);
</script>
</body>
</html>`;
  
  return new Response(html, { status: 200, headers: h });
});
