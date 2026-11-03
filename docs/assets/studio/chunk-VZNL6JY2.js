import{a as B}from"./chunk-SQE76S5B.js";var D=B((b,y)=>{(function(c,u){typeof b=="object"&&typeof y<"u"?y.exports=u():typeof define=="function"&&define.amd?define(u):(c=c||self).parseCssColor=u()})(b,(function(){"use strict";var c={aliceblue:[240,248,255],antiquewhite:[250,235,215],aqua:[0,255,255],aquamarine:[127,255,212],azure:[240,255,255],beige:[245,245,220],bisque:[255,228,196],black:[0,0,0],blanchedalmond:[255,235,205],blue:[0,0,255],blueviolet:[138,43,226],brown:[165,42,42],burlywood:[222,184,135],cadetblue:[95,158,160],chartreuse:[127,255,0],chocolate:[210,105,30],coral:[255,127,80],cornflowerblue:[100,149,237],cornsilk:[255,248,220],crimson:[220,20,60],cyan:[0,255,255],darkblue:[0,0,139],darkcyan:[0,139,139],darkgoldenrod:[184,134,11],darkgray:[169,169,169],darkgreen:[0,100,0],darkgrey:[169,169,169],darkkhaki:[189,183,107],darkmagenta:[139,0,139],darkolivegreen:[85,107,47],darkorange:[255,140,0],darkorchid:[153,50,204],darkred:[139,0,0],darksalmon:[233,150,122],darkseagreen:[143,188,143],darkslateblue:[72,61,139],darkslategray:[47,79,79],darkslategrey:[47,79,79],darkturquoise:[0,206,209],darkviolet:[148,0,211],deeppink:[255,20,147],deepskyblue:[0,191,255],dimgray:[105,105,105],dimgrey:[105,105,105],dodgerblue:[30,144,255],firebrick:[178,34,34],floralwhite:[255,250,240],forestgreen:[34,139,34],fuchsia:[255,0,255],gainsboro:[220,220,220],ghostwhite:[248,248,255],gold:[255,215,0],goldenrod:[218,165,32],gray:[128,128,128],green:[0,128,0],greenyellow:[173,255,47],grey:[128,128,128],honeydew:[240,255,240],hotpink:[255,105,180],indianred:[205,92,92],indigo:[75,0,130],ivory:[255,255,240],khaki:[240,230,140],lavender:[230,230,250],lavenderblush:[255,240,245],lawngreen:[124,252,0],lemonchiffon:[255,250,205],lightblue:[173,216,230],lightcoral:[240,128,128],lightcyan:[224,255,255],lightgoldenrodyellow:[250,250,210],lightgray:[211,211,211],lightgreen:[144,238,144],lightgrey:[211,211,211],lightpink:[255,182,193],lightsalmon:[255,160,122],lightseagreen:[32,178,170],lightskyblue:[135,206,250],lightslategray:[119,136,153],lightslategrey:[119,136,153],lightsteelblue:[176,196,222],lightyellow:[255,255,224],lime:[0,255,0],limegreen:[50,205,50],linen:[250,240,230],magenta:[255,0,255],maroon:[128,0,0],mediumaquamarine:[102,205,170],mediumblue:[0,0,205],mediumorchid:[186,85,211],mediumpurple:[147,112,219],mediumseagreen:[60,179,113],mediumslateblue:[123,104,238],mediumspringgreen:[0,250,154],mediumturquoise:[72,209,204],mediumvioletred:[199,21,133],midnightblue:[25,25,112],mintcream:[245,255,250],mistyrose:[255,228,225],moccasin:[255,228,181],navajowhite:[255,222,173],navy:[0,0,128],oldlace:[253,245,230],olive:[128,128,0],olivedrab:[107,142,35],orange:[255,165,0],orangered:[255,69,0],orchid:[218,112,214],palegoldenrod:[238,232,170],palegreen:[152,251,152],paleturquoise:[175,238,238],palevioletred:[219,112,147],papayawhip:[255,239,213],peachpuff:[255,218,185],peru:[205,133,63],pink:[255,192,203],plum:[221,160,221],powderblue:[176,224,230],purple:[128,0,128],rebeccapurple:[102,51,153],red:[255,0,0],rosybrown:[188,143,143],royalblue:[65,105,225],saddlebrown:[139,69,19],salmon:[250,128,114],sandybrown:[244,164,96],seagreen:[46,139,87],seashell:[255,245,238],sienna:[160,82,45],silver:[192,192,192],skyblue:[135,206,235],slateblue:[106,90,205],slategray:[112,128,144],slategrey:[112,128,144],snow:[255,250,250],springgreen:[0,255,127],steelblue:[70,130,180],tan:[210,180,140],teal:[0,128,128],thistle:[216,191,216],tomato:[255,99,71],turquoise:[64,224,208],violet:[238,130,238],wheat:[245,222,179],white:[255,255,255],whitesmoke:[245,245,245],yellow:[255,255,0],yellowgreen:[154,205,50]},u=new RegExp(/^#([a-f0-9]{3,4}|[a-f0-9]{4}(?:[a-f0-9]{2}){1,2})\b$/,"i"),w="-?\\d*(?:\\.\\d+)",o="("+w+"?)",t="("+w+"?%)",x=(`^
  hsla?\\(
    \\s*(-?\\d*(?:\\.\\d+)?(?:deg|rad|turn)?)\\s*,
    \\s*`+t+`\\s*,
    \\s*`+t+`\\s*
    (?:,\\s*(-?\\d*(?:\\.\\d+)?%?)\\s*)?
  \\)
  $
`).replace(/\n|\s/g,""),E=new RegExp(x),R=(`^
  hsla?\\(
    \\s*(-?\\d*(?:\\.\\d+)?(?:deg|rad|turn)?)\\s*
    \\s+`+t+`
    \\s+`+t+`
    \\s*(?:\\s*\\/\\s*(-?\\d*(?:\\.\\d+)?%?)\\s*)?
  \\)
  $
`).replace(/\n|\s/g,""),$=new RegExp(R),q=(`^
  rgba?\\(
    \\s*`+o+`\\s*,
    \\s*`+o+`\\s*,
    \\s*`+o+`\\s*
    (?:,\\s*(-?\\d*(?:\\.\\d+)?%?)\\s*)?
  \\)
  $
`).replace(/\n|\s/g,""),F=new RegExp(q),M=(`^
  rgba?\\(
    \\s*`+t+`\\s*,
    \\s*`+t+`\\s*,
    \\s*`+t+`\\s*
    (?:,\\s*(-?\\d*(?:\\.\\d+)?%?)\\s*)?
  \\)
  $
`).replace(/\n|\s/g,""),I=new RegExp(M),N=(`^
  rgba?\\(
    \\s*`+o+`
    \\s+`+o+`
    \\s+`+o+`
    \\s*(?:\\s*\\/\\s*(-?\\d*(?:\\.\\d+)?%?)\\s*)?
  \\)
$
`).replace(/\n|\s/g,""),W=new RegExp(N),C=(`^
  rgba?\\(
    \\s*`+t+`
    \\s+`+t+`
    \\s+`+t+`
    \\s*(?:\\s*\\/\\s*(-?\\d*(?:\\.\\d+)?%?)\\s*)?
  \\)
$
`).replace(/\n|\s/g,""),j=new RegExp(C),z=new RegExp(/^transparent$/,"i"),L=new RegExp("[^#a-f\\d]","gi"),P=new RegExp("^#?[a-f\\d]{3}[a-f\\d]?$|^#?[a-f\\d]{6}([a-f\\d]{2})?$","i"),f=function(r,n,e){return Math.min(Math.max(n,r),e)},T=function(r){var n=r;return typeof n!="number"&&(n=n.endsWith("%")?255*parseFloat(n)/100:parseFloat(n)),f(Math.round(n),0,255)},k=function(r){return f(parseFloat(r),0,100)};function v(r){var n=r;return typeof n!="number"&&(n=n.endsWith("%")?parseFloat(n)/100:parseFloat(n)),f(n,0,1)}function A(r){var n=(function(e,l){if(l===void 0&&(l={}),typeof e!="string"||L.test(e)||!P.test(e))throw new TypeError("Expected a valid hex string");var a=1;(e=e.replace(/^#/,"")).length===8&&(a=Number.parseInt(e.slice(6,8),16)/255,e=e.slice(0,6)),e.length===4&&(a=Number.parseInt(e.slice(3,4).repeat(2),16)/255,e=e.slice(0,3)),e.length===3&&(e=e[0]+e[0]+e[1]+e[1]+e[2]+e[2]);var i=Number.parseInt(e,16),g=i>>16,p=i>>8&255,h=255&i,s=typeof l.alpha=="number"?l.alpha:a;return l.format==="array"?[g,p,h,s]:l.format==="css"?"rgb("+g+" "+p+" "+h+(s===1?"":" / "+Number((100*s).toFixed(2))+"%")+")":{red:g,green:p,blue:h,alpha:s}})(r,{format:"array"});return m([null,n[0],n[1],n[2],n[3]])}function m(r){var n=r[1],e=r[2],l=r[3],a=r[4];return a===void 0&&(a=1),{type:"rgb",values:[n,e,l].map(T),alpha:v(a===null?1:a)}}return function(r){if(typeof r!="string")return null;var n=u.exec(r);if(n)return A(n[0]);var e=$.exec(r)||E.exec(r);if(e)return(function(i){var g=i[1],p=i[2],h=i[3],s=i[4];s===void 0&&(s=1);var d=g;return{type:"hsl",values:[d=d.endsWith("turn")?360*parseFloat(d)/1:d.endsWith("rad")?Math.round(180*parseFloat(d)/Math.PI):parseFloat(d),k(p),k(h)],alpha:v(s===null?1:s)}})(e);var l=W.exec(r)||j.exec(r)||F.exec(r)||I.exec(r);if(l)return m(l);if(z.exec(r))return m([null,0,0,0,0]);var a=c[r.toLowerCase()];return a?m([null,a[0],a[1],a[2],1]):null}}))});export{D as a};
/*! Bundled license information:

parse-css-color/dist/index.umd.js:
  (**
  	 * parse-css-color
  	 * @version v0.2.1
  	 * @link http://github.com/noeldelgado/parse-css-color/
  	 * @license MIT
  	 *)
*/
