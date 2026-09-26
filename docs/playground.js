"use strict";(()=>{function P(t=window.location.hash){let e=t.match(/^#(?:vizmatic-playground|playground)=([\s\S]*)$/);if(e?.[1])try{return decodeURIComponent(e[1])}catch{return}}function R(t){let e=new URL(window.location.href);e.hash=`vizmatic-playground=${encodeURIComponent(t)}`,window.history.replaceState(null,"",e)}var q=new Set(["as","async","await","const","else","export","extends","from","function","if","import","interface","let","new","return","satisfies","type","var"]),B=new Set(["false","null","true","undefined"]);function S(t){return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function m(t,e){return`<span class="syntax-${t}">${S(e)}</span>`}function z(t){return!!(t&&/[A-Za-z_$]/.test(t))}function $(t){return!!(t&&/[\w$]/.test(t))}function _(t,e){for(;/\s/.test(t[e]??"");)e+=1;return t[e]}function k(t){let e="",n=0,a=!1,s=!1,u=0;for(;n<t.length;){let l=t[n],c=t[n+1];if(l==="/"&&c==="/"){let d=t.indexOf(`
`,n),i=d===-1?t.length:d;e+=m("comment",t.slice(n,i)),n=i;continue}if(l==="/"&&c==="*"){let d=t.indexOf("*/",n+2),i=d===-1?t.length:d+2;e+=m("comment",t.slice(n,i)),n=i;continue}if(l==='"'||l==="'"||l==="`"){let d=l,i=n+1;for(;i<t.length;){if(t[i]==="\\"){i+=2;continue}if(t[i]===d){i+=1;break}i+=1}e+=m("string",t.slice(n,i)),n=i;continue}if(l==="<"&&(c==="/"||z(c))){a=!0,s=!0,e+=m("operator",l),n+=1;continue}if(a&&l==="{"){u+=1,e+=m("operator",l),n+=1;continue}if(a&&l==="}"&&u>0){u-=1,e+=m("operator",l),n+=1;continue}if(a&&u===0&&l===">"){a=!1,e+=m("operator",l),n+=1;continue}if(z(l)){let d=n+1;for(;$(t[d]);)d+=1;let i=t.slice(n,d),L=_(t,d);s?(e+=m("tag",i),s=!1):a&&L==="="?e+=m("attribute",i):q.has(i)?e+=m("keyword",i):B.has(i)?e+=m("literal",i):/^[A-Z]/.test(i)?e+=m("component",i):e+=S(i),n=d;continue}if(/\d/.test(l)){let d=n+1;for(;/[\d._]/.test(t[d]??"");)d+=1;e+=m("number",t.slice(n,d)),n=d;continue}"{}[]=(),:;/>".includes(l)?e+=m("operator",l):e+=S(l),n+=1}return e}var y=[{id:"architecture",label:"Architecture",source:`width = 1200
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
</Scene>`}];function v(t){return y.find(e=>e.id===t)}var O=4e3,j=12e3,N=350,T=class extends Error{constructor(){super("Preview superseded by a newer edit.")}},x=class{worker;pending;nextId=1;hasRendered=!1;render(e){this.pending&&this.restart(new T);let n=this.worker??this.createWorker(),a=this.nextId++;return new Promise((s,u)=>{let l=this.hasRendered?O:j,c=window.setTimeout(()=>{this.restart(new Error(`Preview timed out after ${l/1e3} seconds. Worker restarted.`))},l);this.pending={id:a,resolve:s,reject:u,timeout:c},n.postMessage({...e,id:a})})}dispose(){this.restart(new T)}createWorker(){let e=new Worker(new URL("playground-worker.js",document.baseURI));return e.onmessage=n=>this.onMessage(n.data),e.onerror=n=>{n.preventDefault(),this.restart(new Error(n.message||"Playground worker failed."))},this.worker=e,e}onMessage(e){if(!this.pending||e.id!==this.pending.id)return;if(!e.ok){this.restart(new Error(e.error));return}let n=this.pending;this.pending=void 0,window.clearTimeout(n.timeout),this.hasRendered=!0,n.resolve(e)}restart(e){if(this.worker?.terminate(),this.worker=void 0,this.hasRendered=!1,!this.pending)return;let n=this.pending;this.pending=void 0,window.clearTimeout(n.timeout),n.reject(e)}};function g(t,e){return t.querySelector(e)??document.querySelector(e)??void 0}function h(t,e){return[...new Set([...t.querySelectorAll(e),...document.querySelectorAll(e)])]}function W(t){let e=g(t,"#playgroundSource, #vizmatic-playground-source, [data-vizmatic-playground-source]"),n=g(t,"#playgroundCanvas, #vizmatic-playground-preview, [data-vizmatic-playground-preview]");if(!(!e||!n))return{root:t,source:e,preview:n,highlight:g(t,"#playgroundHighlight, [data-vizmatic-playground-highlight]"),status:g(t,"#playgroundStatus, #vizmatic-playground-status, [data-vizmatic-playground-status]"),error:g(t,"#playgroundError, #vizmatic-playground-error, [data-vizmatic-playground-error]"),viewport:g(t,"#playgroundViewport, #vizmatic-playground-viewport, [data-vizmatic-playground-viewport]"),dimensions:g(t,"#playgroundDimensions, #vizmatic-playground-dimensions, [data-vizmatic-playground-dimensions]"),width:g(t,"#vizmatic-playground-width, [data-vizmatic-playground-width]"),height:g(t,"#vizmatic-playground-height, [data-vizmatic-playground-height]"),templateSelect:g(t,"#playgroundTemplate, select[data-vizmatic-playground-template]"),run:g(t,"#playgroundRunButton, #vizmatic-playground-run, [data-vizmatic-playground-run]"),copy:g(t,"#playgroundCopyButton, [data-vizmatic-playground-copy]"),share:g(t,"#playgroundShareButton, #vizmatic-playground-share, [data-vizmatic-playground-share]"),pngDownload:g(t,'#playgroundPngButton, #vizmatic-playground-download-png, [data-vizmatic-playground-download="png"]'),svgDownload:g(t,'#playgroundSvgButton, #vizmatic-playground-download-svg, [data-vizmatic-playground-download="svg"]')}}function A(t){t.highlight&&(t.highlight.scrollLeft=t.source.scrollLeft,t.highlight.scrollTop=t.source.scrollTop)}function w(t){t.highlight&&(t.highlight.innerHTML=`${k(t.source.value)}
`,A(t))}function V(t){if(t.dataset.vizmaticPlaygroundTheme==="light"||t.dataset.vizmaticPlaygroundTheme==="dark")return t.dataset.vizmaticPlaygroundTheme;let e=h(t,"[data-playground-theme], [data-vizmatic-theme]").find(n=>n.getAttribute("aria-pressed")==="true");return e?.dataset.playgroundTheme==="light"||e?.dataset.vizmaticTheme==="light"?"light":"dark"}function G(t){let e=t.dataset.vizmaticPlaygroundBackground;return e&&e!=="transparent"?e:void 0}function p(t,e,n){t.status?.setAttribute("data-state",e),t.status&&(t.status.textContent=n),t.viewport&&(t.viewport.dataset.state=e)}function M(t,e){t.error&&(t.error.hidden=!e,t.error.textContent=e??"")}function f(t,e){t&&((t instanceof HTMLButtonElement||t instanceof HTMLInputElement)&&(t.disabled=!e),t.setAttribute("aria-disabled",String(!e)))}async function F(t){if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(t);return}let e=document.createElement("textarea");e.value=t,e.setAttribute("readonly",""),e.style.position="fixed",e.style.opacity="0",document.body.append(e),e.select();let n=document.execCommand("copy");if(e.remove(),!n)throw new Error("Clipboard access is unavailable.")}function C(t,e,n){let a=URL.createObjectURL(new Blob([e],{type:n})),s=document.createElement("a");s.href=a,s.download=t,s.click(),window.setTimeout(()=>URL.revokeObjectURL(a),0)}function H(t){let e=t.dataset.vizmaticPreviewUrl;e&&(URL.revokeObjectURL(e),delete t.dataset.vizmaticPreviewUrl),t.replaceChildren()}function J(t,e,n,a){H(t);let s=URL.createObjectURL(new Blob([e],{type:"image/svg+xml"}));t.dataset.vizmaticPreviewUrl=s;let u=document.createElement("img");u.src=s,u.alt=`Vizmatic preview, ${n} by ${a}`,u.width=n,u.height=a,u.addEventListener("load",()=>{URL.revokeObjectURL(s),t.dataset.vizmaticPreviewUrl===s&&delete t.dataset.vizmaticPreviewUrl},{once:!0}),t.append(u)}function E(t,e){t.dataset.vizmaticPlaygroundTheme=e;for(let n of h(t,"[data-vizmatic-playground-theme]"))(n instanceof HTMLSelectElement||n instanceof HTMLInputElement)&&(n.value=e);for(let n of h(t,"[data-vizmatic-theme], [data-playground-theme]")){let a=n.dataset.vizmaticTheme??n.dataset.playgroundTheme;n.setAttribute("aria-pressed",String(a===e))}}function Y(t){let e=t.value;t.replaceChildren(...y.map(n=>{let a=document.createElement("option");return a.value=n.id,a.textContent=n.label,a})),t.value=v(e)?.id??y[0]?.id??""}function b(t){if(t.dataset.vizmaticPlaygroundMounted==="true")return;let e=W(t);if(!e)return;t.dataset.vizmaticPlaygroundMounted="true";let n=new x,a=P();e.templateSelect&&Y(e.templateSelect),a&&(e.source.value=a),e.source.value.trim()||(e.source.value=v(e.templateSelect?.value)?.source??y[0]?.source??""),w(e);let s,u,l,c=V(t),d=r=>{e.source.value=r,w(e),u=void 0,l=void 0,H(e.preview),f(e.pngDownload,!1),f(e.svgDownload,!1),M(e,void 0),p(e,"loading","Rendering shared source\u2026"),i(!0)},i=(r=!1)=>{s&&window.clearTimeout(s),s=window.setTimeout(()=>{s=void 0,L()},r?0:N)},L=async()=>{let r=e.source.value;f(e.pngDownload,!1),f(e.svgDownload,!1),p(e,"loading","Rendering locally\u2026"),M(e,void 0);try{let o=await n.render({source:r,theme:c,background:G(t)});u=o.png,l=o.svg,J(e.preview,o.svg,o.width,o.height),e.dimensions&&(e.dimensions.textContent=`${o.width} \xD7 ${o.height}`),e.width&&(e.width.textContent=String(o.width)),e.height&&(e.height.textContent=String(o.height)),f(e.pngDownload,!0),f(e.svgDownload,!0),p(e,"ready",o.warnings[0]??`Ready \xB7 ${o.width}\xD7${o.height}`)}catch(o){if(o instanceof T)return;u=void 0,l=void 0;let I=o instanceof Error?o.message:String(o);p(e,"error","Error"),M(e,I)}};e.source.addEventListener("input",()=>{w(e),i()}),e.source.addEventListener("scroll",()=>A(e)),e.run?.addEventListener("click",r=>{r.preventDefault(),i(!0)}),e.pngDownload?.addEventListener("click",r=>{r.preventDefault(),u&&C("vizmatic.png",u,"image/png")}),e.svgDownload?.addEventListener("click",r=>{r.preventDefault(),l&&C("vizmatic.svg",l,"image/svg+xml")}),e.share?.addEventListener("click",r=>{r.preventDefault(),R(e.source.value);let o=window.location.href;if(!navigator.clipboard){p(e,"ready","Share link ready in address bar.");return}navigator.clipboard.writeText(o).then(()=>p(e,"ready","Share link copied.")).catch(()=>p(e,"ready","Share link ready in address bar."))});let U=e.copy?.textContent??"Copy source";e.copy?.addEventListener("click",async r=>{r.preventDefault();try{await F(e.source.value),e.copy&&(e.copy.textContent="Copied"),p(e,"ready","Source copied.")}catch{e.copy&&(e.copy.textContent="Copy failed"),p(e,"error","Could not copy source.")}window.setTimeout(()=>{e.copy&&(e.copy.textContent=U)},1600)});for(let r of h(t,"[data-vizmatic-playground-template]"))r.addEventListener("click",()=>{let o=v(r.dataset.vizmaticPlaygroundTemplate);o&&(e.source.value=o.source,w(e),i(!0))});for(let r of h(t,"#playgroundTemplate, select[data-vizmatic-playground-template]"))r.addEventListener("change",()=>{let o=v(r.value);o&&(e.source.value=o.source,w(e),i(!0))});for(let r of h(t,"[data-vizmatic-theme], [data-playground-theme]"))r.addEventListener("click",()=>{c=r.dataset.vizmaticTheme==="light"||r.dataset.playgroundTheme==="light"?"light":"dark",E(t,c),i(!0)});for(let r of h(t,"select[data-vizmatic-playground-theme]"))r.addEventListener("change",()=>{c=r.value==="light"?"light":"dark",E(t,c),i(!0)});t.addEventListener("vizmatic-playground-theme",r=>{if(!(r instanceof CustomEvent))return;let o=r.detail?.theme;o!=="dark"&&o!=="light"||(c=o,E(t,c),i(!0))}),window.addEventListener("hashchange",()=>{let r=P();!r||r===e.source.value||d(r)}),window.addEventListener("pagehide",()=>{H(e.preview),n.dispose()},{once:!0}),E(t,c),a?d(a):i(!0)}function X(){let t=[...document.querySelectorAll("[data-vizmatic-playground]"),document.querySelector("#vizmatic-playground"),document.querySelector("#playground")].filter(e=>!!e);for(let e of new Set(t))b(e)}function D(){let t=[...document.querySelectorAll("[data-vizmatic-playground]"),document.querySelector("#vizmatic-playground"),document.querySelector("#playground")].filter(n=>!!n);if(!("IntersectionObserver"in window)){for(let n of new Set(t))b(n);return}let e=new IntersectionObserver(n=>{for(let a of n)a.isIntersecting&&(e.unobserve(a.target),b(a.target))},{rootMargin:"600px 0px"});for(let n of new Set(t))e.observe(n)}var Z=globalThis;Z.VizmaticPlayground={mountAll:X,mount:b};document.readyState==="loading"?document.addEventListener("DOMContentLoaded",D,{once:!0}):D();})();
