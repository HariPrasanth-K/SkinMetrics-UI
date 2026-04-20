import { useState, useEffect, useRef } from "react";
import {
  listImages, listJsons, listAllKeys, presign, fetchJson,
  getBytes, invokeEndpoint, debugListBucket,
  S3_BUCKET, S3_PREFIX, SKIN_ENDPOINTS, buildPath,
} from "../awsConfig";
import "./SkinAnalysis.css";

const CATS = ["acne", "pigment", "wrinkles", "others"];
const CAT_META = {
  acne:     { label:"Acne",     color:"#ef4444", light:"#fef2f2", icon:"🔴", desc:"Comedones, papules & pustules" },
  pigment:  { label:"Pigment",  color:"#f97316", light:"#fff7ed", icon:"🟠", desc:"Hyperpigmentation & melasma" },
  wrinkles: { label:"Wrinkles", color:"#3b82f6", light:"#eff6ff", icon:"🔵", desc:"Fine lines & deep wrinkles" },
  others:   { label:"Others",   color:"#8b5cf6", light:"#f5f3ff", icon:"🟣", desc:"Other dermatological findings" },
};

function normalise(raw, cat) {
  if (!raw) return null;
  const toScore = s => typeof s === "number" ? +s.toFixed(3) : parseFloat(s) || 0;
  if (typeof raw[cat] === "number") {
    const { recommendation="", model_version="", ...rest } = raw;
    return { condition:cat, score:toScore(raw[cat]), details:rest, recommendation, model_version };
  }
  if (typeof raw.score === "number") {
    const { score:sc, recommendation="", model_version="", ...rest } = raw;
    return { condition:cat, score:toScore(sc), details:rest, recommendation, model_version };
  }
  if (Array.isArray(raw.predictions)) {
    const p = raw.predictions.find(x=>x.label?.toLowerCase()===cat) || raw.predictions[0] || {};
    return { condition:cat, score:toScore(p.score||0), details:{label:p.label||cat}, recommendation:raw.recommendation||"", model_version:"" };
  }
  return { condition:cat, score:0, details:raw, recommendation:"", model_version:"" };
}

// ── Annotation Canvas ────────────────────────────────────────────────────────
function AnnotationCanvas({ annJson, imgWidth, imgHeight }) {
  const ref = useRef();
  useEffect(() => {
    const canvas = ref.current; if (!canvas || !annJson) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const W = canvas.width, H = canvas.height;
    const sx = W / (imgWidth || W), sy = H / (imgHeight || H);
    ctx.lineWidth = 2.5; ctx.font = "bold 11px Inter,sans-serif";
    const colors = ["#22c55e","#ef4444","#f97316","#3b82f6","#8b5cf6"];
    let idx = 0;
    const box = (x,y,w,h,lbl) => {
      const col = colors[idx++%colors.length];
      ctx.strokeStyle=col; ctx.fillStyle=col+"33";
      ctx.strokeRect(x*sx,y*sy,w*sx,h*sy); ctx.fillRect(x*sx,y*sy,w*sx,h*sy);
      const tw=ctx.measureText(lbl).width;
      ctx.fillStyle=col; ctx.fillRect(x*sx,y*sy-16,tw+8,16);
      ctx.fillStyle="#fff"; ctx.fillText(lbl,x*sx+4,y*sy-4);
    };
    const poly = (pts,lbl) => {
      if(!pts?.length) return;
      const col=colors[idx++%colors.length];
      ctx.strokeStyle=col; ctx.fillStyle=col+"40";
      ctx.beginPath(); ctx.moveTo(pts[0][0]*sx,pts[0][1]*sy);
      pts.slice(1).forEach(([px,py])=>ctx.lineTo(px*sx,py*sy));
      ctx.closePath(); ctx.fill(); ctx.stroke();
      if(lbl){const tw=ctx.measureText(lbl).width;ctx.fillStyle=col;ctx.fillRect(pts[0][0]*sx,pts[0][1]*sy-16,tw+8,16);ctx.fillStyle="#fff";ctx.fillText(lbl,pts[0][0]*sx+4,pts[0][1]*sy-4);}
    };
    if(annJson.annotations){
      const cm={}; (annJson.categories||[]).forEach(c=>{cm[c.id]=c.name;});
      annJson.annotations.forEach(a=>{
        const lbl=cm[a.category_id]||String(a.category_id);
        if(a.bbox?.length===4) box(...a.bbox,lbl);
        if(a.segmentation?.[0]){const pts=a.segmentation[0];const p=[];for(let i=0;i<pts.length;i+=2)p.push([pts[i],pts[i+1]]);poly(p,lbl);}
      });
    } else if(annJson.shapes){
      annJson.shapes.forEach(s=>{
        if(s.shape_type==="rectangle"&&s.points?.length>=2){const[[x1,y1],[x2,y2]]=s.points;box(x1,y1,x2-x1,y2-y1,s.label);}
        else poly(s.points,s.label);
      });
    } else if(annJson.objects){
      annJson.objects.forEach(o=>{const b=o.bbox||o.bndbox;if(b)box(b.x??b.xmin??0,b.y??b.ymin??0,b.w??b.width??(b.xmax-b.xmin)??0,b.h??b.height??(b.ymax-b.ymin)??0,o.label||o.name||"");});
    }
  },[annJson,imgWidth,imgHeight]);
  return <canvas ref={ref} width={imgWidth||400} height={imgHeight||300} className="ann-canvas"/>;
}

function AnnotatedViewer({ annImgUrl, annJson, jsonKey }) {
  const imgRef = useRef();
  const [dims, setDims] = useState({w:400,h:300});
  const [hide, setHide] = useState(false);
  return (
    <div className="ann-viewer">
      <div className="ann-img-wrap">
        <img ref={imgRef} src={annImgUrl} alt="annotated" className="ann-img"
          onLoad={e=>setDims({w:e.target.naturalWidth,h:e.target.naturalHeight})}/>
        {annJson && !hide && <AnnotationCanvas annJson={annJson} imgWidth={dims.w} imgHeight={dims.h}/>}
      </div>
      {annJson && (
        <div className="ann-controls">
          <button className={`btn ${hide?"btn-secondary":"btn-primary"}`} style={{fontSize:12,padding:"5px 12px"}} onClick={()=>setHide(p=>!p)}>
            {hide?"Show Annotations":"Hide Annotations"}
          </button>
          {jsonKey && <span className="ann-json-key">📄 {jsonKey.split("/").pop()}</span>}
        </div>
      )}
    </div>
  );
}

function JsonPanel({ annJson }) {
  const [exp, setExp] = useState(false);
  if (!annJson) return <div className="json-panel json-panel-empty">📄 No JSON annotation paired with this image</div>;
  const count = annJson.annotations?.length || annJson.shapes?.length || annJson.objects?.length || 0;
  const fmt = annJson.annotations?"COCO":annJson.shapes?"LabelMe":annJson.objects?"Custom":"Unknown";
  const cats = [...new Set((annJson.categories?.map(c=>c.name)||[]).concat(annJson.shapes?.map(s=>s.label)||[]))].join(", ");
  return (
    <div className="json-panel">
      <div className="json-panel-hdr" onClick={()=>setExp(p=>!p)}>
        <div className="json-panel-title">
          📋 Annotation Data
          <span className="badge badge-green" style={{marginLeft:8}}>{fmt}</span>
          {count>0&&<span className="badge badge-gray" style={{marginLeft:4}}>{count} objects</span>}
        </div>
        <span className="json-expand-btn">{exp?"▲ Hide":"▼ Show raw"}</span>
      </div>
      <div className="json-summary">
        {count>0&&<div className="json-sum-row"><span>Objects</span><strong>{count}</strong></div>}
        {cats&&<div className="json-sum-row"><span>Labels</span><strong>{cats}</strong></div>}
        {annJson.imageWidth&&<div className="json-sum-row"><span>Image size</span><strong>{annJson.imageWidth}×{annJson.imageHeight}px</strong></div>}
        {(annJson.shapes||annJson.annotations||annJson.objects||[]).slice(0,5).map((s,i)=>{
          const lbl=s.label||s.name||(annJson.categories?.find(c=>c.id===s.category_id)?.name)||`Object ${i+1}`;
          const type=s.shape_type||(s.bbox?"bbox":s.segmentation?"polygon":"—");
          return <div className="json-sum-row" key={i}><span>{lbl}</span><strong style={{color:"var(--g600)"}}>{type}</strong></div>;
        })}
      </div>
      {exp&&<pre className="json-raw">{JSON.stringify(annJson,null,2)}</pre>}
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function SkinAnalysis() {
  const [tab, setTab]           = useState("dataset");
  const [cat, setCat]           = useState("acne");
  const [viewMode, setViewMode] = useState("raw");

  const [dataset, setDataset]       = useState({});
  const [dsLoading, setDsLoading]   = useState({});
  const [dsError, setDsError]       = useState({});

  const [selected, setSelected]     = useState(null);
  const [annJson, setAnnJson]       = useState(null);
  const [jsonLoading, setJsonLoading] = useState(false);

  const [predicting, setPredicting] = useState(false);
  const [result, setResult]         = useState(null);
  const [predError, setPredError]   = useState("");

  const [endpoints, setEndpoints]   = useState({...SKIN_ENDPOINTS});

  // Debug panel state
  const [debugKeys, setDebugKeys]   = useState([]);
  const [debugLoading, setDebugLoading] = useState(false);
  const [showDebug, setShowDebug]   = useState(false);

  useEffect(() => { loadCategory(cat); }, [cat]);

  // ── Smart loader: handles both flat AND raw/annotated structures ──────────
  async function loadCategory(c) {
    if (dataset[c]) return;
    setDsLoading(p=>({...p,[c]:true}));
    setDsError(p=>({...p,[c]:""}));
    try {
      // Try raw/ subfolder first
      const rawPrefixWithSub  = buildPath(c, "raw");
      const annPrefixWithSub  = buildPath(c, "annotated");
      const flatPrefix        = buildPath(c);          // direct: dataset/acne/

      let rawKeys = await listImages(rawPrefixWithSub);
      let annImgKeys = [], annJsonKeys = [];
      let usedFlat = false;

      if (rawKeys.length === 0) {
        // No raw/ subfolder — images are directly in dataset/acne/
        rawKeys = await listImages(flatPrefix);
        usedFlat = true;
        // Look for annotated images in same flat folder (filter by _ann or _annotated in name)
        annImgKeys  = rawKeys.filter(k => /(_ann|_annotated)/i.test(k.split("/").pop()));
        annJsonKeys = await listJsons(flatPrefix);
        // Remove annotated imgs from rawKeys
        rawKeys = rawKeys.filter(k => !/(_ann|_annotated)/i.test(k.split("/").pop()));
      } else {
        annImgKeys  = await listImages(annPrefixWithSub);
        annJsonKeys = await listJsons(annPrefixWithSub);
      }

      // Build lookup maps
      const annImgMap = {}, annJsonMap = {};
      annImgKeys.forEach(k => {
        const base = k.split("/").pop().replace(/(_ann|_annotated)/i,"").replace(/\.[^.]+$/,"").toLowerCase();
        annImgMap[base] = k;
      });
      annJsonKeys.forEach(k => {
        const base = k.split("/").pop().replace(/\.json$/,"").toLowerCase();
        annJsonMap[base] = k;
      });

      const items = await Promise.all(rawKeys.map(async(rk,i) => {
        const fn   = rk.split("/").pop();
        const base = fn.replace(/\.[^.]+$/,"").toLowerCase();
        const ak   = annImgMap[base] || annImgMap[base.replace(/(_raw|_orig)/i,"")] || null;
        const jk   = annJsonMap[base] || annJsonMap[base.replace(/(_raw|_orig)/i,"")] || null;
        const [rawUrl, annUrl] = await Promise.all([
          presign(rk),
          ak ? presign(ak) : Promise.resolve(null),
        ]);
        return { id:`${c}-${i}`, rawKey:rk, annKey:ak, jsonKey:jk, rawUrl, annUrl, name:fn, usedFlat };
      }));

      setDataset(p=>({...p,[c]:items}));
    } catch(e) {
      console.error("S3 load error:", e);
      setDsError(p=>({...p,[c]:e.message}));
      setDataset(p=>({...p,[c]:[]}));
    } finally {
      setDsLoading(p=>({...p,[c]:false}));
    }
  }

  async function selectImage(img) {
    setSelected(img); setResult(null); setPredError(""); setAnnJson(null);
    if (img.jsonKey) {
      setJsonLoading(true);
      try { setAnnJson(await fetchJson(img.jsonKey)); }
      catch(e) { console.warn("JSON load failed:", e); }
      finally { setJsonLoading(false); }
    }
  }

  function refreshCategory() {
    setDataset(p=>{const n={...p};delete n[cat];return n;});
    setSelected(null); setAnnJson(null); setResult(null);
    setTimeout(()=>loadCategory(cat), 50);
  }

  async function runDebug() {
    setDebugLoading(true); setShowDebug(true);
    try { setDebugKeys(await debugListBucket()); }
    catch(e) { setDebugKeys([`ERROR: ${e.message}`]); }
    finally { setDebugLoading(false); }
  }

  async function predict() {
    if (!selected) return;
    const ep = endpoints[cat];
    if (!ep) { setPredError(`No endpoint for "${cat}". Set it in Endpoints tab.`); return; }
    setPredicting(true); setResult(null); setPredError("");
    try {
      const bytes = await getBytes(selected.rawKey);
      const raw   = await invokeEndpoint(ep, bytes);
      console.log(`[${cat}] raw:`, raw);
      setResult(normalise(raw, cat));
    } catch(e) { setPredError(e.message); }
    finally { setPredicting(false); }
  }

  const items    = dataset[cat] || [];
  const loading  = dsLoading[cat];
  const err      = dsError[cat];
  const imgUrl   = img => viewMode==="raw" ? img.rawUrl : (img.annUrl||img.rawUrl);
  const scoreClr = s => s>.6?"#ef4444":s>.3?"#f97316":"#22c55e";
  const scoreTxt = s => s>.6?"High":s>.3?"Moderate":"Low";

  return (
    <div className="sa-page">
      {/* Header */}
      <div className="page-hdr sa-hdr">
        <div>
          <h1>Skin Analysis</h1>
          <p>S3: <strong>{S3_BUCKET||"not set"}</strong> · Prefix: <code style={{fontSize:11}}>{S3_PREFIX}/</code></p>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <button className="btn btn-ghost" style={{fontSize:12}} onClick={runDebug}>
            🔍 Debug S3
          </button>
          <div className="sa-tabs">
            {[["dataset","📂 Dataset"],["analysis","🔬 Analysis"],["endpoint","⚙️ Endpoints"]].map(([id,lbl])=>(
              <button key={id} className={`sa-tab ${tab===id?"active":""}`} onClick={()=>setTab(id)}>{lbl}</button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Debug panel ── */}
      {showDebug && (
        <div className="debug-panel">
          <div className="debug-hdr">
            <strong>🔍 S3 Debug — first 50 keys under <code>{S3_PREFIX}/</code></strong>
            <button className="btn btn-ghost" style={{fontSize:11,padding:"3px 8px"}} onClick={()=>setShowDebug(false)}>✕ Close</button>
          </div>
          {debugLoading
            ? <div style={{padding:12}}><span className="spin spin-green"/> Listing S3 keys…</div>
            : debugKeys.length===0
              ? <div className="debug-empty">⚠ No keys found under <code>s3://{S3_BUCKET}/{S3_PREFIX}/</code><br/>
                  Check: (1) bucket name in .env (2) folder name is exactly <code>{S3_PREFIX}</code> (3) IAM has s3:ListBucket</div>
              : <div className="debug-keys">
                  {debugKeys.map((k,i)=>(
                    <div key={i} className="debug-key">
                      <span className="debug-key-icon">{/\.(jpe?g|png)$/i.test(k)?"🖼️":k.endsWith(".json")?"📋":"📄"}</span>
                      <code>{k}</code>
                    </div>
                  ))}
                  <div className="debug-tip">
                    ✅ If you see your images above — the app will load them.<br/>
                    ❌ If empty — your folder name in .env (<code>VITE_S3_BUCKET</code>) or the prefix (<code>{S3_PREFIX}</code>) is wrong.
                  </div>
                </div>
          }
        </div>
      )}

      {/* ═══ DATASET TAB ═══ */}
      {tab==="dataset" && (
        <div className="fade-up">
          <div className="cat-row">
            {CATS.map(c=>(
              <button key={c} className={`cat-pill ${cat===c?"active":""}`}
                style={{"--cc":CAT_META[c].color,"--cl":CAT_META[c].light}}
                onClick={()=>{setCat(c);setSelected(null);setAnnJson(null);setResult(null);}}>
                {CAT_META[c].icon} {CAT_META[c].label}
                {dataset[c]&&<span className="cat-count">{dataset[c].length}</span>}
              </button>
            ))}
          </div>

          <div className="ds-stats">
            <div className="ds-stat"><span>S3 Path</span><strong>s3://{S3_BUCKET}/{S3_PREFIX}/{cat}/</strong></div>
            <div className="ds-stat"><span>Images loaded</span><strong>{items.length}</strong></div>
            <div className="ds-stat"><span>With annotated</span><strong>{items.filter(i=>i.annKey).length}</strong></div>
            <div className="ds-stat"><span>With JSON</span><strong style={{color:items.filter(i=>i.jsonKey).length>0?"var(--g600)":"var(--text4)"}}>{items.filter(i=>i.jsonKey).length}</strong></div>
            <div className="ds-stat"><span>Endpoint</span>
              <strong style={{color:endpoints[cat]?"var(--g600)":"var(--red)"}}>
                {endpoints[cat]?"✓ Set":"⚠ Not set"}
              </strong>
            </div>
            <button className="btn btn-ghost ds-refresh" onClick={refreshCategory}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>
              Refresh
            </button>
          </div>

          <div className="view-toggle">
            <button className={viewMode==="raw"?"active":""} onClick={()=>setViewMode("raw")}>Raw Images</button>
            <button className={viewMode==="annotated"?"active":""} onClick={()=>setViewMode("annotated")}>Annotated</button>
          </div>

          <div className="s3-chip">📁 s3://{S3_BUCKET}/{S3_PREFIX}/{cat}/</div>

          {err && (
            <div className="alert alert-error" style={{marginBottom:14}}>
              <div><strong>S3 Error:</strong> {err}</div>
              <div style={{marginTop:6,fontSize:12}}>
                Common fixes:<br/>
                1. Check <code>VITE_S3_BUCKET=mltrainingodf</code> in .env<br/>
                2. Check S3 CORS is set (AllowedOrigins: http://localhost:3000)<br/>
                3. Check IAM user has <code>s3:ListBucket</code> and <code>s3:GetObject</code><br/>
                4. Click <strong>🔍 Debug S3</strong> button above to see what keys exist
              </div>
            </div>
          )}

          <div className="ds-grid">
            {loading
              ? Array.from({length:8}).map((_,i)=><div key={i} className="ds-skel skel"/>)
              : items.length===0 && !loading
                ? (
                  <div className="ds-empty">
                    <div>📂</div>
                    <p>No images found in <code>s3://{S3_BUCKET}/{S3_PREFIX}/{cat}/</code></p>
                    <p style={{fontSize:11,marginTop:8,color:"var(--text4)"}}>
                      Click <strong>🔍 Debug S3</strong> above to see exactly what keys exist in your bucket.
                    </p>
                    <button className="btn btn-secondary" style={{marginTop:12}} onClick={runDebug}>🔍 Debug S3 Now</button>
                  </div>
                )
                : items.map(img=>(
                  <div key={img.id}
                    className={`ds-item ${selected?.id===img.id?"sel":""} ${viewMode==="annotated"&&!img.annKey?"no-ann":""}`}
                    onClick={()=>{selectImage(img);setTab("analysis");}}>
                    <div className="ds-img-wrap">
                      <img src={imgUrl(img)} alt={img.name} loading="lazy"
                        onError={e=>{e.target.src="https://placehold.co/280x200/f0fdf4/86efac?text=No+image";}}/>
                      {viewMode==="annotated"&&!img.annKey&&<div className="ds-no-ann">No annotated</div>}
                      {img.jsonKey&&<div className="ds-json-badge">JSON</div>}
                    </div>
                    <div className="ds-item-name">{img.name}</div>
                    {selected?.id===img.id&&<div className="ds-check">✓</div>}
                  </div>
                ))
            }
          </div>

          {selected&&(
            <div className="ds-selected-bar">
              <span>Selected: <strong>{selected.name}</strong>
                {selected.jsonKey&&<span className="badge badge-green" style={{marginLeft:8}}>JSON ✓</span>}
              </span>
              <button className="btn btn-primary" onClick={()=>setTab("analysis")}>Go to Analysis →</button>
            </div>
          )}
        </div>
      )}

      {/* ═══ ANALYSIS TAB ═══ */}
      {tab==="analysis" && (
        <div className="an-layout fade-up">
          <div className="an-left">
            <div className="card an-panel">
              <div className="an-panel-hdr">
                <span className="an-panel-title">Image Preview</span>
                <button className="btn btn-ghost" style={{fontSize:12,padding:"5px 10px"}} onClick={()=>setTab("dataset")}>← Dataset</button>
              </div>

              {selected ? (
                <>
                  <div className="view-toggle" style={{marginBottom:12}}>
                    <button className={viewMode==="raw"?"active":""} onClick={()=>setViewMode("raw")}>Raw</button>
                    <button className={viewMode==="annotated"?"active":""} onClick={()=>setViewMode("annotated")} disabled={!selected.annKey}>
                      Annotated {!selected.annKey&&"(none)"}
                    </button>
                  </div>

                  {viewMode==="raw"
                    ? <img src={selected.rawUrl} alt={selected.name} className="an-preview-img"
                        onError={e=>{e.target.src="https://placehold.co/400x300/f0fdf4/86efac?text=No+image";}}/>
                    : <AnnotatedViewer annImgUrl={selected.annUrl||selected.rawUrl} annJson={annJson} jsonKey={selected.jsonKey}/>
                  }

                  {jsonLoading
                    ? <div className="json-panel"><span className="spin spin-green"/> Loading JSON…</div>
                    : <JsonPanel annJson={annJson}/>
                  }

                  <div className="an-meta">
                    <div className="an-meta-item"><span>File</span><strong>{selected.name}</strong></div>
                    <div className="an-meta-item"><span>S3 Key</span><strong style={{fontSize:10,wordBreak:"break-all"}}>{selected.rawKey}</strong></div>
                    <div className="an-meta-item"><span>Annotated img</span><strong>{selected.annKey?"✓ paired":"✗ not found"}</strong></div>
                    <div className="an-meta-item"><span>JSON file</span><strong style={{color:selected.jsonKey?"var(--g600)":"var(--text4)"}}>{selected.jsonKey?selected.jsonKey.split("/").pop():"✗ not found"}</strong></div>
                  </div>

                  <button className="btn btn-primary an-predict-btn" onClick={predict} disabled={predicting}>
                    {predicting?<><span className="spin"/>Invoking SageMaker…</>:<>▶ Run Prediction</>}
                  </button>
                  {predError&&<div className="alert alert-error" style={{marginTop:10,fontSize:12}}>⚠ {predError}</div>}
                </>
              ) : (
                <div className="an-empty">
                  <div>🖼️</div>
                  <p>Go to <strong>Dataset</strong> tab and click an image</p>
                  <button className="btn btn-secondary" onClick={()=>setTab("dataset")} style={{marginTop:12}}>Open Dataset →</button>
                </div>
              )}
            </div>
          </div>

          <div className="an-right">
            <div className="card an-cat-card">
              <div className="an-panel-title" style={{marginBottom:10}}>Condition</div>
              <div className="cat-row" style={{flexWrap:"wrap"}}>
                {CATS.map(c=>(
                  <button key={c} className={`cat-pill ${cat===c?"active":""}`}
                    style={{"--cc":CAT_META[c].color,"--cl":CAT_META[c].light}}
                    onClick={()=>{setCat(c);setResult(null);setPredError("");}}>
                    {CAT_META[c].icon} {CAT_META[c].label}
                  </button>
                ))}
              </div>
              <div style={{marginTop:8,fontSize:12,color:"var(--text3)"}}>
                Endpoint: {endpoints[cat]
                  ? <code style={{fontSize:11,color:"var(--g700)"}}>{endpoints[cat]}</code>
                  : <span style={{color:"var(--red)"}}>not set</span>}
              </div>
            </div>

            <div className="card an-result-card">
              {predicting&&<div className="an-result-loading"><span className="spin spin-green" style={{width:28,height:28,borderWidth:3}}/><p>Invoking SageMaker…</p><small>{endpoints[cat]}</small></div>}
              {!predicting&&!result&&<div className="an-result-placeholder"><div>🔬</div><p>Select an image and click <strong>Run Prediction</strong></p></div>}
              {!predicting&&result&&(
                <div className="fade-up">
                  <div className="an-result-top">
                    <div>
                      <div className="an-result-label">Prediction Score</div>
                      <div className="an-result-score" style={{color:scoreClr(result.score)}}>{Math.round(result.score*100)}<span>%</span></div>
                      <div className="badge" style={{marginTop:4,background:CAT_META[cat].light,color:CAT_META[cat].color,border:`1px solid ${CAT_META[cat].color}33`}}>
                        {CAT_META[cat].icon} {CAT_META[cat].label} — {scoreTxt(result.score)}
                      </div>
                    </div>
                    <svg viewBox="0 0 72 72" width="72" height="72">
                      <circle cx="36" cy="36" r="28" fill="none" stroke="var(--border)" strokeWidth="7"/>
                      <circle cx="36" cy="36" r="28" fill="none" stroke={scoreClr(result.score)} strokeWidth="7" strokeLinecap="round"
                        strokeDasharray={`${result.score*176} 176`} transform="rotate(-90 36 36)"/>
                    </svg>
                  </div>
                  {Object.entries(result.details).length>0&&(
                    <div className="an-details">
                      {Object.entries(result.details).map(([k,v])=>(
                        <div className="an-detail-row" key={k}><span>{k.replace(/_/g," ")}</span><strong>{typeof v==="object"?JSON.stringify(v):String(v)}</strong></div>
                      ))}
                    </div>
                  )}
                  {result.recommendation&&<div className="an-rec"><div className="an-rec-title">💊 Recommendation</div><p>{result.recommendation}</p></div>}
                  {result.model_version&&<div style={{fontSize:11,color:"var(--text4)",marginTop:8}}>Model: {result.model_version}</div>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ ENDPOINT TAB ═══ */}
      {tab==="endpoint"&&(
        <div className="ep-page fade-up">
          <div className="card ep-card">
            <div className="ep-hdr">
              <div className="ep-title">SageMaker Endpoint Configuration</div>
              <p>Enter the <strong>endpoint name</strong> from AWS Console → SageMaker → Inference → Endpoints.</p>
            </div>
            <div className="alert alert-info" style={{marginBottom:20}}>ℹ️ AWS Console → SageMaker → Inference → Endpoints → copy the <strong>Name</strong> column</div>
            <div className="ep-list">
              {CATS.map(c=>(
                <div className="ep-row" key={c} style={{"--cc":CAT_META[c].color,"--cl":CAT_META[c].light}}>
                  <div className="ep-row-left">
                    <div className="ep-cat-icon">{CAT_META[c].icon}</div>
                    <div>
                      <div className="ep-cat-label">{CAT_META[c].label}</div>
                      <div className="ep-cat-desc">{CAT_META[c].desc}</div>
                      <div className="ep-cat-path">s3://{S3_BUCKET}/{S3_PREFIX}/{c}/</div>
                    </div>
                  </div>
                  <div className="ep-row-right">
                    <label>Endpoint Name</label>
                    <input placeholder={`e.g. ${c}-skin-endpoint`} value={endpoints[c]} onChange={e=>setEndpoints(p=>({...p,[c]:e.target.value}))}/>
                    <div className="ep-status">{endpoints[c]?<span className="badge badge-green">✓ Configured</span>:<span className="badge badge-red">⚠ Not set</span>}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="ep-note"><strong>Tip:</strong> To persist, add to <code>.env</code> as <code>VITE_ENDPOINT_ACNE</code> etc. and restart.</div>
          </div>
        </div>
      )}
    </div>
  );
}
