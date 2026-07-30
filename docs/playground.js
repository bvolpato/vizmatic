"use strict";(()=>{function S(t=window.location.hash){let e=t.match(/^#(?:vizmatic-playground|playground)=([\s\S]*)$/);if(e?.[1])try{return decodeURIComponent(e[1])}catch{return}}function x(t){let e=new URL(window.location.href);e.hash=`vizmatic-playground=${encodeURIComponent(t)}`,window.history.replaceState(null,"",e)}var I=new Set(["as","async","await","const","else","export","extends","from","function","if","import","interface","let","new","return","satisfies","type","var"]),q=new Set(["false","null","true","undefined"]);function P(t){return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function g(t,e){return`<span class="syntax-${t}">${P(e)}</span>`}function R(t){return!!(t&&/[A-Za-z_$]/.test(t))}function B(t){return!!(t&&/[\w$]/.test(t))}function U(t,e){for(;/\s/.test(t[e]??"");)e+=1;return t[e]}function z(t){let e="",n=0,a=!1,u=!1,s=0;for(;n<t.length;){let l=t[n],c=t[n+1];if(l==="/"&&c==="/"){let d=t.indexOf(`
`,n),r=d===-1?t.length:d;e+=g("comment",t.slice(n,r)),n=r;continue}if(l==="/"&&c==="*"){let d=t.indexOf("*/",n+2),r=d===-1?t.length:d+2;e+=g("comment",t.slice(n,r)),n=r;continue}if(l==='"'||l==="'"||l==="`"){let d=l,r=n+1;for(;r<t.length;){if(t[r]==="\\"){r+=2;continue}if(t[r]===d){r+=1;break}r+=1}e+=g("string",t.slice(n,r)),n=r;continue}if(l==="<"&&(c==="/"||R(c))){a=!0,u=!0,e+=g("operator",l),n+=1;continue}if(a&&l==="{"){s+=1,e+=g("operator",l),n+=1;continue}if(a&&l==="}"&&s>0){s-=1,e+=g("operator",l),n+=1;continue}if(a&&s===0&&l===">"){a=!1,e+=g("operator",l),n+=1;continue}if(R(l)){let d=n+1;for(;B(t[d]);)d+=1;let r=t.slice(n,d),L=U(t,d);u?(e+=g("tag",r),u=!1):a&&L==="="?e+=g("attribute",r):I.has(r)?e+=g("keyword",r):q.has(r)?e+=g("literal",r):/^[A-Z]/.test(r)?e+=g("component",r):e+=P(r),n=d;continue}if(/\d/.test(l)){let d=n+1;for(;/[\d._]/.test(t[d]??"");)d+=1;e+=g("number",t.slice(n,d)),n=d;continue}"{}[]=(),:;/>".includes(l)?e+=g("operator",l):e+=P(l),n+=1}return e}var v=[{id:"architecture",label:"Architecture",source:`width = 1200
height = 540

<Scene title="Agent runtime example" subtitle="plan, execute, inspect output" gap={22}>
  <Row gap={18} align="stretch">
    <Panel title="Plan" tone="purple" width={250} minHeight={236}>
      <StatusList rows={[
        { label: "Read context", detail: "ready" },
        { label: "Choose tools", detail: "3 calls", tone: "blue" },
        { label: "Verify output", detail: "required", tone: "green" },
      ]} />
    </Panel>
    <Column gap={12} align="center" justify="center">
      <Arrow direction="right" length={48} />
      <TextLabel variant="tiny" text="structured handoff" />
    </Column>
    <Panel title="Execute" tone="blue" width={300} minHeight={236}>
      <Pipeline stages={[
        { label: "Search", tone: "blue" },
        { label: "Build", tone: "purple" },
        { label: "Check", tone: "green" },
      ]} />
    </Panel>
    <Column gap={12} align="center" justify="center"><Arrow direction="right" length={48} /></Column>
    <MetricCard tone="green" label="Result" value="PNG/SVG" detail="rendered files" width={210} minHeight={236} />
  </Row>
</Scene>`},{id:"metrics",label:"Metrics",source:`width = 960
height = 540
preset = "engineering"

<Scene title="Release metrics example" subtitle="illustrative values, replace with project data" background={c.bg} gap={20}>
  <Row gap={16} align="stretch">
    <MetricCard tone="green" label="Checks" value="98.7%" detail="sample value" width={210} minHeight={132} />
    <MetricCard tone="blue" label="Deploy time" value="3m 42s" detail="sample value" width={210} minHeight={132} />
    <MetricCard tone="purple" label="Coverage" value="84%" detail="sample value" width={210} minHeight={132} />
    <MetricCard tone="warm" label="Open alerts" value="2" detail="sample value" width={210} minHeight={132} />
  </Row>
  <Panel title="Delivery gates" tone="green" width="100%">
    <ProgressList rows={[
      { label: "Build", value: 1, valueLabel: "100%", tone: "green" },
      { label: "Tests", value: 0.987, valueLabel: "98.7%", tone: "blue" },
      { label: "Review", value: 0.82, valueLabel: "82%", tone: "purple" },
    ]} />
  </Panel>
</Scene>`},{id:"flow",label:"Flow",source:`width = 960
height = 540

<Scene title="Retrieval flow" subtitle="ground answers in fresh evidence" gap={26}>
  <Row gap={16} align="stretch">
    <StepCard step="01" title="Question" detail="intent + constraints" tone="blue" width={205} />
    <Arrow direction="right" length={52} />
    <StepCard step="02" title="Retrieve" detail="ranked source set" tone="purple" width={205} />
    <Arrow direction="right" length={52} />
    <StepCard step="03" title="Synthesize" detail="cited answer" tone="green" width={205} />
  </Row>
  <CalloutCard tone="cyan" title="Evaluation" detail="Measure answer quality, source coverage, and latency before publishing." width="100%" />
</Scene>`},{id:"graph",label:"Graph",source:`width = 1040
height = 560

<Scene title="Agent execution graph" subtitle="coordinates omitted; layout is automatic" gap={22}>
  <GraphDiagram
    width={900}
    height={340}
    nodeWidth={150}
    nodes={[
      { id: "request", label: "Request", detail: "goal + context", tone: "blue" },
      { id: "search", label: "Search", detail: "fresh evidence", tone: "purple" },
      { id: "code", label: "Build", detail: "editable source", tone: "cyan" },
      { id: "check", label: "Check", detail: "layout + contrast", tone: "warm" },
      { id: "asset", label: "Publish", detail: "PNG / SVG / GIF", tone: "green" },
    ]}
    edges={[
      { from: "request", to: "search", label: "inspect" },
      { from: "request", to: "code", label: "compose" },
      { from: "search", to: "check" },
      { from: "code", to: "check" },
      { from: "check", to: "asset", label: "export", tone: "green" },
    ]}
  />
</Scene>`}];function y(t){return v.find(e=>e.id===t)}var $=4e3,_=12e3,O=350,T=class extends Error{constructor(){super("Preview superseded by a newer edit.")}},H=class{worker;pending;nextId=1;hasRendered=!1;render(e){this.pending&&this.restart(new T);let n=this.worker??this.createWorker(),a=this.nextId++;return new Promise((u,s)=>{let l=this.hasRendered?$:_,c=window.setTimeout(()=>{this.restart(new Error(`Preview timed out after ${l/1e3} seconds. Worker restarted.`))},l);this.pending={id:a,resolve:u,reject:s,timeout:c},n.postMessage({...e,id:a})})}dispose(){this.restart(new T)}createWorker(){let e=new Worker(new URL("playground-worker.js",document.baseURI));return e.onmessage=n=>this.onMessage(n.data),e.onerror=n=>{n.preventDefault(),this.restart(new Error(n.message||"Playground worker failed."))},this.worker=e,e}onMessage(e){if(!this.pending||e.id!==this.pending.id)return;if(!e.ok){this.restart(new Error(e.error));return}let n=this.pending;this.pending=void 0,window.clearTimeout(n.timeout),this.hasRendered=!0,n.resolve(e)}restart(e){if(this.worker?.terminate(),this.worker=void 0,this.hasRendered=!1,!this.pending)return;let n=this.pending;this.pending=void 0,window.clearTimeout(n.timeout),n.reject(e)}};function m(t,e){return t.querySelector(e)??document.querySelector(e)??void 0}function h(t,e){return[...new Set([...t.querySelectorAll(e),...document.querySelectorAll(e)])]}function j(t){let e=m(t,"#playgroundSource, #vizmatic-playground-source, [data-vizmatic-playground-source]"),n=m(t,"#playgroundCanvas, #vizmatic-playground-preview, [data-vizmatic-playground-preview]");if(!(!e||!n))return{root:t,source:e,preview:n,highlight:m(t,"#playgroundHighlight, [data-vizmatic-playground-highlight]"),status:m(t,"#playgroundStatus, #vizmatic-playground-status, [data-vizmatic-playground-status]"),error:m(t,"#playgroundError, #vizmatic-playground-error, [data-vizmatic-playground-error]"),viewport:m(t,"#playgroundViewport, #vizmatic-playground-viewport, [data-vizmatic-playground-viewport]"),dimensions:m(t,"#playgroundDimensions, #vizmatic-playground-dimensions, [data-vizmatic-playground-dimensions]"),width:m(t,"#vizmatic-playground-width, [data-vizmatic-playground-width]"),height:m(t,"#vizmatic-playground-height, [data-vizmatic-playground-height]"),templateSelect:m(t,"#playgroundTemplate, select[data-vizmatic-playground-template]"),run:m(t,"#playgroundRunButton, #vizmatic-playground-run, [data-vizmatic-playground-run]"),share:m(t,"#playgroundShareButton, #vizmatic-playground-share, [data-vizmatic-playground-share]"),pngDownload:m(t,'#playgroundPngButton, #vizmatic-playground-download-png, [data-vizmatic-playground-download="png"]'),svgDownload:m(t,'#playgroundSvgButton, #vizmatic-playground-download-svg, [data-vizmatic-playground-download="svg"]')}}function D(t){t.highlight&&(t.highlight.scrollLeft=t.source.scrollLeft,t.highlight.scrollTop=t.source.scrollTop)}function w(t){t.highlight&&(t.highlight.innerHTML=`${z(t.source.value)}
`,D(t))}function N(t){if(t.dataset.vizmaticPlaygroundTheme==="light"||t.dataset.vizmaticPlaygroundTheme==="dark")return t.dataset.vizmaticPlaygroundTheme;let e=h(t,"[data-playground-theme], [data-vizmatic-theme]").find(n=>n.getAttribute("aria-pressed")==="true");return e?.dataset.playgroundTheme==="light"||e?.dataset.vizmaticTheme==="light"?"light":"dark"}function V(t){let e=t.dataset.vizmaticPlaygroundBackground;return e&&e!=="transparent"?e:void 0}function p(t,e,n){t.status?.setAttribute("data-state",e),t.status&&(t.status.textContent=n),t.viewport&&(t.viewport.dataset.state=e)}function M(t,e){t.error&&(t.error.hidden=!e,t.error.textContent=e??"")}function f(t,e){t&&((t instanceof HTMLButtonElement||t instanceof HTMLInputElement)&&(t.disabled=!e),t.setAttribute("aria-disabled",String(!e)))}function k(t,e,n){let a=URL.createObjectURL(new Blob([e],{type:n})),u=document.createElement("a");u.href=a,u.download=t,u.click(),window.setTimeout(()=>URL.revokeObjectURL(a),0)}function W(t,e,n,a){let u=URL.createObjectURL(new Blob([e],{type:"image/svg+xml"})),s=document.createElement("img");s.src=u,s.alt=`Vizmatic preview, ${n} by ${a}`,s.width=n,s.height=a,s.addEventListener("load",()=>URL.revokeObjectURL(u),{once:!0}),t.replaceChildren(s)}function E(t,e){t.dataset.vizmaticPlaygroundTheme=e;for(let n of h(t,"[data-vizmatic-playground-theme]"))(n instanceof HTMLSelectElement||n instanceof HTMLInputElement)&&(n.value=e);for(let n of h(t,"[data-vizmatic-theme], [data-playground-theme]")){let a=n.dataset.vizmaticTheme??n.dataset.playgroundTheme;n.setAttribute("aria-pressed",String(a===e))}}function G(t){let e=t.value;t.replaceChildren(...v.map(n=>{let a=document.createElement("option");return a.value=n.id,a.textContent=n.label,a})),t.value=y(e)?.id??v[0]?.id??""}function b(t){if(t.dataset.vizmaticPlaygroundMounted==="true")return;let e=j(t);if(!e)return;t.dataset.vizmaticPlaygroundMounted="true";let n=new H,a=S();e.templateSelect&&G(e.templateSelect),a&&(e.source.value=a),e.source.value.trim()||(e.source.value=y(e.templateSelect?.value)?.source??v[0]?.source??""),w(e);let u,s,l,c=N(t),d=i=>{e.source.value=i,w(e),s=void 0,l=void 0,e.preview.replaceChildren(),f(e.pngDownload,!1),f(e.svgDownload,!1),M(e,void 0),p(e,"ready","Shared source loaded. Run to preview.")},r=(i=!1)=>{u&&window.clearTimeout(u),u=window.setTimeout(()=>{u=void 0,L()},i?0:O)},L=async()=>{let i=e.source.value;f(e.pngDownload,!1),f(e.svgDownload,!1),p(e,"loading","Rendering locally\u2026"),M(e,void 0);try{let o=await n.render({source:i,theme:c,background:V(t)});s=o.png,l=o.svg,W(e.preview,o.svg,o.width,o.height),e.dimensions&&(e.dimensions.textContent=`${o.width} \xD7 ${o.height}`),e.width&&(e.width.textContent=String(o.width)),e.height&&(e.height.textContent=String(o.height)),f(e.pngDownload,!0),f(e.svgDownload,!0),p(e,"ready",o.warnings[0]??`Ready \xB7 ${o.width}\xD7${o.height}`)}catch(o){if(o instanceof T)return;s=void 0,l=void 0;let A=o instanceof Error?o.message:String(o);p(e,"error","Error"),M(e,A)}};e.source.addEventListener("input",()=>{w(e),r()}),e.source.addEventListener("scroll",()=>D(e)),e.run?.addEventListener("click",i=>{i.preventDefault(),r(!0)}),e.pngDownload?.addEventListener("click",i=>{i.preventDefault(),s&&k("vizmatic.png",s,"image/png")}),e.svgDownload?.addEventListener("click",i=>{i.preventDefault(),l&&k("vizmatic.svg",l,"image/svg+xml")}),e.share?.addEventListener("click",i=>{i.preventDefault(),x(e.source.value);let o=window.location.href;if(!navigator.clipboard){p(e,"ready","Share link ready in address bar.");return}navigator.clipboard.writeText(o).then(()=>p(e,"ready","Share link copied.")).catch(()=>p(e,"ready","Share link ready in address bar."))});for(let i of h(t,"[data-vizmatic-playground-template]"))i.addEventListener("click",()=>{let o=y(i.dataset.vizmaticPlaygroundTemplate);o&&(e.source.value=o.source,w(e),r(!0))});for(let i of h(t,"#playgroundTemplate, select[data-vizmatic-playground-template]"))i.addEventListener("change",()=>{let o=y(i.value);o&&(e.source.value=o.source,w(e),r(!0))});for(let i of h(t,"[data-vizmatic-theme], [data-playground-theme]"))i.addEventListener("click",()=>{c=i.dataset.vizmaticTheme==="light"||i.dataset.playgroundTheme==="light"?"light":"dark",E(t,c),r(!0)});for(let i of h(t,"select[data-vizmatic-playground-theme]"))i.addEventListener("change",()=>{c=i.value==="light"?"light":"dark",E(t,c),r(!0)});t.addEventListener("vizmatic-playground-theme",i=>{if(!(i instanceof CustomEvent))return;let o=i.detail?.theme;o!=="dark"&&o!=="light"||(c=o,E(t,c),r(!0))}),window.addEventListener("hashchange",()=>{let i=S();!i||i===e.source.value||d(i)}),window.addEventListener("pagehide",()=>n.dispose(),{once:!0}),E(t,c),a?d(a):r(!0)}function F(){let t=[...document.querySelectorAll("[data-vizmatic-playground]"),document.querySelector("#vizmatic-playground"),document.querySelector("#playground")].filter(e=>!!e);for(let e of new Set(t))b(e)}function C(){let t=[...document.querySelectorAll("[data-vizmatic-playground]"),document.querySelector("#vizmatic-playground"),document.querySelector("#playground")].filter(n=>!!n);if(!("IntersectionObserver"in window)){for(let n of new Set(t))b(n);return}let e=new IntersectionObserver(n=>{for(let a of n)a.isIntersecting&&(e.unobserve(a.target),b(a.target))},{rootMargin:"600px 0px"});for(let n of new Set(t))e.observe(n)}var J=globalThis;J.VizmaticPlayground={mountAll:F,mount:b};document.readyState==="loading"?document.addEventListener("DOMContentLoaded",C,{once:!0}):C();})();
