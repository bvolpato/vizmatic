"use strict";(()=>{function T(t=window.location.hash){let e=t.match(/^#(?:vizmatic-playground|playground)=([\s\S]*)$/);if(e?.[1])try{return decodeURIComponent(e[1])}catch{return}}function S(t){let e=new URL(window.location.href);e.hash=`vizmatic-playground=${encodeURIComponent(t)}`,window.history.replaceState(null,"",e)}var f=[{id:"architecture",label:"Architecture",source:`width = 1200
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
</Scene>`}];function v(t){return f.find(e=>e.id===t)}var x=4e3,k=12e3,C=350,y=class extends Error{constructor(){super("Preview superseded by a newer edit.")}},b=class{worker;pending;nextId=1;hasRendered=!1;render(e){this.pending&&this.restart(new y);let n=this.worker??this.createWorker(),a=this.nextId++;return new Promise((d,o)=>{let s=this.hasRendered?x:k,u=window.setTimeout(()=>{this.restart(new Error(`Preview timed out after ${s/1e3} seconds. Worker restarted.`))},s);this.pending={id:a,resolve:d,reject:o,timeout:u},n.postMessage({...e,id:a})})}dispose(){this.restart(new y)}createWorker(){let e=new Worker(new URL("playground-worker.js",document.baseURI));return e.onmessage=n=>this.onMessage(n.data),e.onerror=n=>{n.preventDefault(),this.restart(new Error(n.message||"Playground worker failed."))},this.worker=e,e}onMessage(e){if(!this.pending||e.id!==this.pending.id)return;let n=this.pending;this.pending=void 0,window.clearTimeout(n.timeout),e.ok?(this.hasRendered=!0,n.resolve(e)):n.reject(new Error(e.error))}restart(e){if(this.worker?.terminate(),this.worker=void 0,this.hasRendered=!1,!this.pending)return;let n=this.pending;this.pending=void 0,window.clearTimeout(n.timeout),n.reject(e)}};function l(t,e){return t.querySelector(e)??document.querySelector(e)??void 0}function p(t,e){return[...new Set([...t.querySelectorAll(e),...document.querySelectorAll(e)])]}function D(t){let e=l(t,"#playgroundSource, #vizmatic-playground-source, [data-vizmatic-playground-source]"),n=l(t,"#playgroundCanvas, #vizmatic-playground-preview, [data-vizmatic-playground-preview]");if(!(!e||!n))return{root:t,source:e,preview:n,status:l(t,"#playgroundStatus, #vizmatic-playground-status, [data-vizmatic-playground-status]"),error:l(t,"#playgroundError, #vizmatic-playground-error, [data-vizmatic-playground-error]"),viewport:l(t,"#playgroundViewport, #vizmatic-playground-viewport, [data-vizmatic-playground-viewport]"),dimensions:l(t,"#playgroundDimensions, #vizmatic-playground-dimensions, [data-vizmatic-playground-dimensions]"),width:l(t,"#vizmatic-playground-width, [data-vizmatic-playground-width]"),height:l(t,"#vizmatic-playground-height, [data-vizmatic-playground-height]"),templateSelect:l(t,"#playgroundTemplate, select[data-vizmatic-playground-template]"),run:l(t,"#playgroundRunButton, #vizmatic-playground-run, [data-vizmatic-playground-run]"),share:l(t,"#playgroundShareButton, #vizmatic-playground-share, [data-vizmatic-playground-share]"),pngDownload:l(t,'#playgroundPngButton, #vizmatic-playground-download-png, [data-vizmatic-playground-download="png"]'),svgDownload:l(t,'#playgroundSvgButton, #vizmatic-playground-download-svg, [data-vizmatic-playground-download="svg"]')}}function A(t){if(t.dataset.vizmaticPlaygroundTheme==="light")return"light";let e=p(t,"[data-playground-theme], [data-vizmatic-theme]").find(n=>n.getAttribute("aria-pressed")==="true");return e?.dataset.playgroundTheme==="light"||e?.dataset.vizmaticTheme==="light"?"light":"dark"}function I(t){let e=t.dataset.vizmaticPlaygroundBackground;return e&&e!=="transparent"?e:void 0}function m(t,e,n){t.status?.setAttribute("data-state",e),t.status&&(t.status.textContent=n),t.viewport&&(t.viewport.dataset.state=e)}function E(t,e){t.error&&(t.error.hidden=!e,t.error.textContent=e??"")}function h(t,e){t&&((t instanceof HTMLButtonElement||t instanceof HTMLInputElement)&&(t.disabled=!e),t.setAttribute("aria-disabled",String(!e)))}function M(t,e,n){let a=URL.createObjectURL(new Blob([e],{type:n})),d=document.createElement("a");d.href=a,d.download=t,d.click(),window.setTimeout(()=>URL.revokeObjectURL(a),0)}function U(t,e,n,a){let d=URL.createObjectURL(new Blob([e],{type:"image/svg+xml"})),o=document.createElement("img");o.src=d,o.alt=`Vizmatic preview, ${n} by ${a}`,o.width=n,o.height=a,o.addEventListener("load",()=>URL.revokeObjectURL(d),{once:!0}),t.replaceChildren(o)}function L(t,e){t.dataset.vizmaticPlaygroundTheme=e;for(let n of p(t,"[data-vizmatic-playground-theme]"))(n instanceof HTMLSelectElement||n instanceof HTMLInputElement)&&(n.value=e);for(let n of p(t,"[data-vizmatic-theme], [data-playground-theme]")){let a=n.dataset.vizmaticTheme??n.dataset.playgroundTheme;n.setAttribute("aria-pressed",String(a===e))}}function q(t){let e=t.value;t.replaceChildren(...f.map(n=>{let a=document.createElement("option");return a.value=n.id,a.textContent=n.label,a})),t.value=v(e)?.id??f[0]?.id??""}function w(t){if(t.dataset.vizmaticPlaygroundMounted==="true")return;let e=D(t);if(!e)return;t.dataset.vizmaticPlaygroundMounted="true";let n=new b,a=T();e.templateSelect&&q(e.templateSelect),a&&(e.source.value=a),e.source.value.trim()||(e.source.value=v(e.templateSelect?.value)?.source??f[0]?.source??"");let d,o,s,u=A(t),c=!1,P=r=>{c=!0,e.source.value=r,o=void 0,s=void 0,e.preview.replaceChildren(),h(e.pngDownload,!1),h(e.svgDownload,!1),E(e,void 0),m(e,"ready","Shared source loaded. Run to preview.")},g=(r=!1)=>{d&&window.clearTimeout(d),d=window.setTimeout(()=>{d=void 0,R()},r?0:C)},R=async()=>{let r=e.source.value;h(e.pngDownload,!1),h(e.svgDownload,!1),m(e,"loading","Rendering locally\u2026"),E(e,void 0);try{let i=await n.render({source:r,theme:u,background:I(t)});o=i.png,s=i.svg,U(e.preview,i.svg,i.width,i.height),e.dimensions&&(e.dimensions.textContent=`${i.width} \xD7 ${i.height}`),e.width&&(e.width.textContent=String(i.width)),e.height&&(e.height.textContent=String(i.height)),h(e.pngDownload,!0),h(e.svgDownload,!0),m(e,"ready",i.warnings[0]??`Ready \xB7 ${i.width}\xD7${i.height}`)}catch(i){if(i instanceof y)return;o=void 0,s=void 0;let z=i instanceof Error?i.message:String(i);m(e,"error","Error"),E(e,z)}};e.source.addEventListener("input",()=>{c=!1,g()}),e.run?.addEventListener("click",r=>{r.preventDefault(),c=!1,g(!0)}),e.pngDownload?.addEventListener("click",r=>{r.preventDefault(),o&&M("vizmatic.png",o,"image/png")}),e.svgDownload?.addEventListener("click",r=>{r.preventDefault(),s&&M("vizmatic.svg",s,"image/svg+xml")}),e.share?.addEventListener("click",r=>{r.preventDefault(),S(e.source.value);let i=window.location.href;if(!navigator.clipboard){m(e,"ready","Share link ready in address bar.");return}navigator.clipboard.writeText(i).then(()=>m(e,"ready","Share link copied.")).catch(()=>m(e,"ready","Share link ready in address bar."))});for(let r of p(t,"[data-vizmatic-playground-template]"))r.addEventListener("click",()=>{let i=v(r.dataset.vizmaticPlaygroundTemplate);i&&(c=!1,e.source.value=i.source,g(!0))});for(let r of p(t,"#playgroundTemplate, select[data-vizmatic-playground-template]"))r.addEventListener("change",()=>{let i=v(r.value);i&&(c=!1,e.source.value=i.source,g(!0))});for(let r of p(t,"[data-vizmatic-theme], [data-playground-theme]"))r.addEventListener("click",()=>{u=r.dataset.vizmaticTheme==="light"||r.dataset.playgroundTheme==="light"?"light":"dark",L(t,u),c||g(!0)});for(let r of p(t,"select[data-vizmatic-playground-theme]"))r.addEventListener("change",()=>{u=r.value==="light"?"light":"dark",L(t,u),c||g(!0)});window.addEventListener("hashchange",()=>{let r=T();!r||r===e.source.value||P(r)}),window.addEventListener("pagehide",()=>n.dispose(),{once:!0}),L(t,u),a?P(a):g(!0)}function B(){let t=[...document.querySelectorAll("[data-vizmatic-playground]"),document.querySelector("#vizmatic-playground"),document.querySelector("#playground")].filter(e=>!!e);for(let e of new Set(t))w(e)}function H(){let t=[...document.querySelectorAll("[data-vizmatic-playground]"),document.querySelector("#vizmatic-playground"),document.querySelector("#playground")].filter(n=>!!n);if(!("IntersectionObserver"in window)){for(let n of new Set(t))w(n);return}let e=new IntersectionObserver(n=>{for(let a of n)a.isIntersecting&&(e.unobserve(a.target),w(a.target))},{rootMargin:"600px 0px"});for(let n of new Set(t))e.observe(n)}var $=globalThis;$.VizmaticPlayground={mountAll:B,mount:w};document.readyState==="loading"?document.addEventListener("DOMContentLoaded",H,{once:!0}):H();})();
