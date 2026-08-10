const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets-client/SetupWizard-BLJlrzPP.js","assets-client/disclose-version-obmTAk0z.js","assets-client/render-Beb_BCVa.js","assets-client/SetupWizard-pMwqDVzw.css","assets-client/App-3DoztqP9.js","assets-client/ViewableBuffer-isVomLie.js","assets-client/App-BEg3BzYW.css"])))=>i.map(i=>d[i]);
import{J as Q,i as P,B as d,e as A,E as tt,u as I,U as E,l as V,g as b,w as et,V as x,G as nt,A as it,_ as L}from"./ViewableBuffer-isVomLie.js";import{ao as k}from"./render-Beb_BCVa.js";(function(){const n=document.createElement("link").relList;if(n&&n.supports&&n.supports("modulepreload"))return;for(const i of document.querySelectorAll('link[rel="modulepreload"]'))t(i);new MutationObserver(i=>{for(const a of i)if(a.type==="childList")for(const o of a.addedNodes)o.tagName==="LINK"&&o.rel==="modulepreload"&&t(o)}).observe(document,{childList:!0,subtree:!0});function e(i){const a={};return i.integrity&&(a.integrity=i.integrity),i.referrerPolicy&&(a.referrerPolicy=i.referrerPolicy),i.crossOrigin==="use-credentials"?a.credentials="include":i.crossOrigin==="anonymous"?a.credentials="omit":a.credentials="same-origin",a}function t(i){if(i.ep)return;i.ep=!0;const a=e(i);fetch(i.href,a)}})();class w{constructor(n){this._syncFunctionHash=Object.create(null),this._adaptor=n,this._systemCheck()}_systemCheck(){if(!Q())throw new Error("Current environment does not allow unsafe-eval, please use pixi.js/unsafe-eval module to enable support.")}ensureUniformGroup(n){const e=this.getUniformGroupData(n);n.buffer||(n.buffer=new P({data:new Float32Array(e.layout.size/4),usage:d.UNIFORM|d.COPY_DST}))}getUniformGroupData(n){return this._syncFunctionHash[n._signature]||this._initUniformGroup(n)}_initUniformGroup(n){const e=n._signature;let t=this._syncFunctionHash[e];if(!t){const i=Object.keys(n.uniformStructures).map(c=>n.uniformStructures[c]),a=this._adaptor.createUboElements(i),o=this._generateUboSync(a.uboElements);t=this._syncFunctionHash[e]={layout:a,syncFunction:o}}return this._syncFunctionHash[e]}_generateUboSync(n){return this._adaptor.generateUboSync(n)}syncUniformGroup(n,e,t){const i=this.getUniformGroupData(n);n.buffer||(n.buffer=new P({data:new Float32Array(i.layout.size/4),usage:d.UNIFORM|d.COPY_DST}));let a=null;return e||(e=n.buffer.data,a=n.buffer.dataInt32),t||(t=0),i.syncFunction(n.uniforms,e,a,t),!0}updateUniformGroup(n){if(n.isStatic&&!n._dirtyId)return!1;n._dirtyId=0;const e=this.syncUniformGroup(n);return n.buffer.update(),e}destroy(){this._syncFunctionHash=null}}const B={f32:4,i32:4,"vec2<f32>":8,"vec3<f32>":12,"vec4<f32>":16,"vec2<i32>":8,"vec3<i32>":12,"vec4<i32>":16,"mat2x2<f32>":32,"mat3x3<f32>":48,"mat4x4<f32>":64};function rt(r){const n=r.map(a=>({data:a,offset:0,size:0})),e=16;let t=0,i=0;for(let a=0;a<n.length;a++){const o=n[a];if(t=B[o.data.type],!t)throw new Error(`Unknown type ${o.data.type}`);o.data.size>1&&(t=Math.max(t,e)*o.data.size);const c=t===12?16:t;o.size=t;const s=i%e;s>0&&e-s<c?i+=(e-s)%16:i+=(t-s%t)%t,o.offset=i,i+=t}return i=Math.ceil(i/16)*16,{uboElements:n,size:i}}const v=[{type:"mat3x3<f32>",test:r=>r.value.a!==void 0,ubo:`
            var matrix = uv[name].toArray(true);
            data[offset] = matrix[0];
            data[offset + 1] = matrix[1];
            data[offset + 2] = matrix[2];
            data[offset + 4] = matrix[3];
            data[offset + 5] = matrix[4];
            data[offset + 6] = matrix[5];
            data[offset + 8] = matrix[6];
            data[offset + 9] = matrix[7];
            data[offset + 10] = matrix[8];
        `,uniform:`
            gl.uniformMatrix3fv(ud[name].location, false, uv[name].toArray(true));
        `},{type:"vec4<f32>",test:r=>r.type==="vec4<f32>"&&r.size===1&&r.value.width!==void 0,ubo:`
            v = uv[name];
            data[offset] = v.x;
            data[offset + 1] = v.y;
            data[offset + 2] = v.width;
            data[offset + 3] = v.height;
        `,uniform:`
            cv = ud[name].value;
            v = uv[name];
            if (cv[0] !== v.x || cv[1] !== v.y || cv[2] !== v.width || cv[3] !== v.height) {
                cv[0] = v.x;
                cv[1] = v.y;
                cv[2] = v.width;
                cv[3] = v.height;
                gl.uniform4f(ud[name].location, v.x, v.y, v.width, v.height);
            }
        `},{type:"vec2<f32>",test:r=>r.type==="vec2<f32>"&&r.size===1&&r.value.x!==void 0,ubo:`
            v = uv[name];
            data[offset] = v.x;
            data[offset + 1] = v.y;
        `,uniform:`
            cv = ud[name].value;
            v = uv[name];
            if (cv[0] !== v.x || cv[1] !== v.y) {
                cv[0] = v.x;
                cv[1] = v.y;
                gl.uniform2f(ud[name].location, v.x, v.y);
            }
        `},{type:"vec4<f32>",test:r=>r.type==="vec4<f32>"&&r.size===1&&r.value.red!==void 0,ubo:`
            v = uv[name];
            data[offset] = v.red;
            data[offset + 1] = v.green;
            data[offset + 2] = v.blue;
            data[offset + 3] = v.alpha;
        `,uniform:`
            cv = ud[name].value;
            v = uv[name];
            if (cv[0] !== v.red || cv[1] !== v.green || cv[2] !== v.blue || cv[3] !== v.alpha) {
                cv[0] = v.red;
                cv[1] = v.green;
                cv[2] = v.blue;
                cv[3] = v.alpha;
                gl.uniform4f(ud[name].location, v.red, v.green, v.blue, v.alpha);
            }
        `},{type:"vec3<f32>",test:r=>r.type==="vec3<f32>"&&r.size===1&&r.value.red!==void 0,ubo:`
            v = uv[name];
            data[offset] = v.red;
            data[offset + 1] = v.green;
            data[offset + 2] = v.blue;
        `,uniform:`
            cv = ud[name].value;
            v = uv[name];
            if (cv[0] !== v.red || cv[1] !== v.green || cv[2] !== v.blue) {
                cv[0] = v.red;
                cv[1] = v.green;
                cv[2] = v.blue;
                gl.uniform3f(ud[name].location, v.red, v.green, v.blue);
            }
        `}];function j(r,n,e,t){const i=[`
        var v = null;
        var v2 = null;
        var t = 0;
        var index = 0;
        var name = null;
        var arrayOffset = null;
    `];let a=0;for(let c=0;c<r.length;c++){const s=r[c],u=s.data.name;let f=!1,l=0;for(let m=0;m<v.length;m++)if(v[m].test(s.data)){l=s.offset/4,i.push(`name = "${u}";`,`offset += ${l-a};`,v[m][n]||v[m].ubo),f=!0;break}if(!f)if(s.data.size>1)l=s.offset/4,i.push(e(s,l-a));else{const m=t[s.data.type];l=s.offset/4,i.push(`
                    v = uv.${u};
                    offset += ${l-a};
                    ${m};
                `)}a=l}const o=i.join(`
`);return new Function("uv","data","dataInt32","offset",o)}function g(r,n){return`
        for (let i = 0; i < ${r*n}; i++) {
            data[offset + (((i / ${r})|0) * 4) + (i % ${r})] = v[i];
        }
    `}const W={f32:`
        data[offset] = v;`,i32:`
        dataInt32[offset] = v;`,"vec2<f32>":`
        data[offset] = v[0];
        data[offset + 1] = v[1];`,"vec3<f32>":`
        data[offset] = v[0];
        data[offset + 1] = v[1];
        data[offset + 2] = v[2];`,"vec4<f32>":`
        data[offset] = v[0];
        data[offset + 1] = v[1];
        data[offset + 2] = v[2];
        data[offset + 3] = v[3];`,"vec2<i32>":`
        dataInt32[offset] = v[0];
        dataInt32[offset + 1] = v[1];`,"vec3<i32>":`
        dataInt32[offset] = v[0];
        dataInt32[offset + 1] = v[1];
        dataInt32[offset + 2] = v[2];`,"vec4<i32>":`
        dataInt32[offset] = v[0];
        dataInt32[offset + 1] = v[1];
        dataInt32[offset + 2] = v[2];
        dataInt32[offset + 3] = v[3];`,"mat2x2<f32>":`
        data[offset] = v[0];
        data[offset + 1] = v[1];
        data[offset + 4] = v[2];
        data[offset + 5] = v[3];`,"mat3x3<f32>":`
        data[offset] = v[0];
        data[offset + 1] = v[1];
        data[offset + 2] = v[2];
        data[offset + 4] = v[3];
        data[offset + 5] = v[4];
        data[offset + 6] = v[5];
        data[offset + 8] = v[6];
        data[offset + 9] = v[7];
        data[offset + 10] = v[8];`,"mat4x4<f32>":`
        for (let i = 0; i < 16; i++) {
            data[offset + i] = v[i];
        }`,"mat3x2<f32>":g(3,2),"mat4x2<f32>":g(4,2),"mat2x3<f32>":g(2,3),"mat4x3<f32>":g(4,3),"mat2x4<f32>":g(2,4),"mat3x4<f32>":g(3,4)},at={...W,"mat2x2<f32>":`
        data[offset] = v[0];
        data[offset + 1] = v[1];
        data[offset + 2] = v[2];
        data[offset + 3] = v[3];
    `};function ot(r,n){const e=Math.max(B[r.data.type]/16,1),t=r.data.value.length/r.data.size,i=(4-t%4)%4,a=r.data.type.indexOf("i32")>=0?"dataInt32":"data";return`
        v = uv.${r.data.name};
        offset += ${n};

        arrayOffset = offset;

        t = 0;

        for(var i=0; i < ${r.data.size*e}; i++)
        {
            for(var j = 0; j < ${t}; j++)
            {
                ${a}[arrayOffset++] = v[t++];
            }
            ${i!==0?`arrayOffset += ${i};`:""}
        }
    `}function ct(r){return j(r,"uboStd40",ot,W)}class H extends w{constructor(){super({createUboElements:rt,generateUboSync:ct})}}H.extension={type:[A.WebGLSystem],name:"ubo"};class O extends tt{constructor({buffer:n,offset:e,size:t}){super(),this.uid=I("buffer"),this._resourceType="bufferResource",this._touched=0,this._resourceId=I("resource"),this._bufferResource=!0,this.destroyed=!1,this.buffer=n,this.offset=e|0,this.size=t,this.buffer.on("change",this.onBufferChange,this)}onBufferChange(){this._resourceId=I("resource"),this.emit("change",this)}destroy(n=!1){this.destroyed=!0,n&&this.buffer.destroy(),this.emit("change",this),this.buffer=null,this.removeAllListeners()}}function st(r,n){const e=[],t=[`
        var g = s.groups;
        var sS = r.shader;
        var p = s.glProgram;
        var ugS = r.uniformGroup;
        var resources;
    `];let i=!1,a=0;const o=n._getProgramData(r.glProgram);for(const s in r.groups){const u=r.groups[s];e.push(`
            resources = g[${s}].resources;
        `);for(const f in u.resources){const l=u.resources[f];if(l instanceof E)if(l.ubo){const m=r._uniformBindMap[s][Number(f)];e.push(`
                        sS.bindUniformBlock(
                            resources[${f}],
                            '${m}',
                            ${r.glProgram._uniformBlockData[m].index}
                        );
                    `)}else e.push(`
                        ugS.updateUniformGroup(resources[${f}], p, sD);
                    `);else if(l instanceof O){const m=r._uniformBindMap[s][Number(f)];e.push(`
                    sS.bindUniformBlock(
                        resources[${f}],
                        '${m}',
                        ${r.glProgram._uniformBlockData[m].index}
                    );
                `)}else if(l instanceof V){const m=r._uniformBindMap[s][f],_=o.uniformData[m];_&&(i||(i=!0,t.push(`
                        var tS = r.texture;
                        `)),n._gl.uniform1i(_.location,a),e.push(`
                        tS.bind(resources[${f}], ${a});
                    `),a++)}}}const c=[...t,...e].join(`
`);return new Function("r","s","sD",c)}class ut{constructor(n,e){this.program=n,this.uniformData=e,this.uniformGroups={},this.uniformDirtyGroups={},this.uniformBlockBindings={}}destroy(){this.uniformData=null,this.uniformGroups=null,this.uniformDirtyGroups=null,this.uniformBlockBindings=null,this.program=null}}function $(r,n,e){const t=r.createShader(n);return r.shaderSource(t,e),r.compileShader(t),t}function T(r){const n=new Array(r);for(let e=0;e<n.length;e++)n[e]=!1;return n}function Y(r,n){switch(r){case"float":return 0;case"vec2":return new Float32Array(2*n);case"vec3":return new Float32Array(3*n);case"vec4":return new Float32Array(4*n);case"int":case"uint":case"sampler2D":case"sampler2DArray":return 0;case"ivec2":return new Int32Array(2*n);case"ivec3":return new Int32Array(3*n);case"ivec4":return new Int32Array(4*n);case"uvec2":return new Uint32Array(2*n);case"uvec3":return new Uint32Array(3*n);case"uvec4":return new Uint32Array(4*n);case"bool":return!1;case"bvec2":return T(2*n);case"bvec3":return T(3*n);case"bvec4":return T(4*n);case"mat2":return new Float32Array([1,0,0,1]);case"mat3":return new Float32Array([1,0,0,0,1,0,0,0,1]);case"mat4":return new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])}return null}let S=null;const G={FLOAT:"float",FLOAT_VEC2:"vec2",FLOAT_VEC3:"vec3",FLOAT_VEC4:"vec4",INT:"int",INT_VEC2:"ivec2",INT_VEC3:"ivec3",INT_VEC4:"ivec4",UNSIGNED_INT:"uint",UNSIGNED_INT_VEC2:"uvec2",UNSIGNED_INT_VEC3:"uvec3",UNSIGNED_INT_VEC4:"uvec4",BOOL:"bool",BOOL_VEC2:"bvec2",BOOL_VEC3:"bvec3",BOOL_VEC4:"bvec4",FLOAT_MAT2:"mat2",FLOAT_MAT3:"mat3",FLOAT_MAT4:"mat4",SAMPLER_2D:"sampler2D",INT_SAMPLER_2D:"sampler2D",UNSIGNED_INT_SAMPLER_2D:"sampler2D",SAMPLER_CUBE:"samplerCube",INT_SAMPLER_CUBE:"samplerCube",UNSIGNED_INT_SAMPLER_CUBE:"samplerCube",SAMPLER_2D_ARRAY:"sampler2DArray",INT_SAMPLER_2D_ARRAY:"sampler2DArray",UNSIGNED_INT_SAMPLER_2D_ARRAY:"sampler2DArray"},ft={float:"float32",vec2:"float32x2",vec3:"float32x3",vec4:"float32x4",int:"sint32",ivec2:"sint32x2",ivec3:"sint32x3",ivec4:"sint32x4",uint:"uint32",uvec2:"uint32x2",uvec3:"uint32x3",uvec4:"uint32x4",bool:"uint32",bvec2:"uint32x2",bvec3:"uint32x3",bvec4:"uint32x4"};function K(r,n){if(!S){const e=Object.keys(G);S={};for(let t=0;t<e.length;++t){const i=e[t];S[r[i]]=G[i]}}return S[n]}function lt(r,n){const e=K(r,n);return ft[e]||"float32"}function mt(r,n,e=!1){const t={},i=n.getProgramParameter(r,n.ACTIVE_ATTRIBUTES);for(let o=0;o<i;o++){const c=n.getActiveAttrib(r,o);if(c.name.startsWith("gl_"))continue;const s=lt(n,c.type);t[c.name]={location:0,format:s,stride:b(s).stride,offset:0,instance:!1,start:0}}const a=Object.keys(t);if(e){a.sort((o,c)=>o>c?1:-1);for(let o=0;o<a.length;o++)t[a[o]].location=o,n.bindAttribLocation(r,o,a[o]);n.linkProgram(r)}else for(let o=0;o<a.length;o++)t[a[o]].location=n.getAttribLocation(r,a[o]);return t}function vt(r,n){if(!n.ACTIVE_UNIFORM_BLOCKS)return{};const e={},t=n.getProgramParameter(r,n.ACTIVE_UNIFORM_BLOCKS);for(let i=0;i<t;i++){const a=n.getActiveUniformBlockName(r,i),o=n.getUniformBlockIndex(r,a),c=n.getActiveUniformBlockParameter(r,i,n.UNIFORM_BLOCK_DATA_SIZE);e[a]={name:a,index:o,size:c}}return e}function _t(r,n){const e={},t=n.getProgramParameter(r,n.ACTIVE_UNIFORMS);for(let i=0;i<t;i++){const a=n.getActiveUniform(r,i),o=a.name.replace(/\[.*?\]$/,""),c=!!a.name.match(/\[.*?\]$/),s=K(n,a.type);e[o]={name:o,index:i,type:s,size:a.size,isArray:c,value:Y(s,a.size)}}return e}function M(r,n){const e=r.getShaderSource(n);if(e===null){console.error("PixiJS Error: Could not retrieve shader source (WebGL context may be lost).");return}const t=e.split(`
`).map((f,l)=>`${l}: ${f}`),i=r.getShaderInfoLog(n)??"",a=i.split(`
`),o={},c=a.map(f=>parseFloat(f.replace(/^ERROR\: 0\:([\d]+)\:.*$/,"$1"))).filter(f=>f&&!o[f]?(o[f]=!0,!0):!1),s=[""];c.forEach(f=>{t[f-1]=`%c${t[f-1]}%c`,s.push("background: #FF0000; color:#FFFFFF; font-size: 10px","font-size: 10px")});const u=t.join(`
`);s[0]=u,console.error(i),console.groupCollapsed("click to view full shader code"),console.warn(...s),console.groupEnd()}function dt(r,n,e,t){r.getProgramParameter(n,r.LINK_STATUS)||(r.getShaderParameter(e,r.COMPILE_STATUS)||M(r,e),r.getShaderParameter(t,r.COMPILE_STATUS)||M(r,t),console.error("PixiJS Error: Could not initialize shader."),r.getProgramInfoLog(n)!==""&&console.warn("PixiJS Warning: gl.getProgramInfoLog()",r.getProgramInfoLog(n)))}function ht(r,n){const e=$(r,r.VERTEX_SHADER,n.vertex),t=$(r,r.FRAGMENT_SHADER,n.fragment),i=r.createProgram();r.attachShader(i,e),r.attachShader(i,t);const a=n.transformFeedbackVaryings;a&&(typeof r.transformFeedbackVaryings!="function"?et("TransformFeedback is not supported but TransformFeedbackVaryings are given."):r.transformFeedbackVaryings(i,a.names,a.bufferMode==="separate"?r.SEPARATE_ATTRIBS:r.INTERLEAVED_ATTRIBS)),r.linkProgram(i),r.getProgramParameter(i,r.LINK_STATUS)||dt(r,i,e,t),n._attributeData=mt(i,r,!/^[ \t]*#[ \t]*version[ \t]+300[ \t]+es[ \t]*$/m.test(n.vertex)),n._uniformData=_t(i,r),n._uniformBlockData=vt(i,r),r.deleteShader(e),r.deleteShader(t);const o={};for(const s in n._uniformData){const u=n._uniformData[s];o[s]={location:r.getUniformLocation(i,s),value:Y(u.type,u.size)}}return new ut(i,o)}const U={textureCount:0,blockIndex:0};class X{constructor(n){this._activeProgram=null,this._programDataHash=Object.create(null),this._shaderSyncFunctions=Object.create(null),this._renderer=n}contextChange(n){this._gl=n,this._programDataHash=Object.create(null),this._shaderSyncFunctions=Object.create(null),this._activeProgram=null}bind(n,e){if(this._setProgram(n.glProgram),e)return;U.textureCount=0,U.blockIndex=0;let t=this._shaderSyncFunctions[n.glProgram._key];t||(t=this._shaderSyncFunctions[n.glProgram._key]=this._generateShaderSync(n,this)),this._renderer.buffer.nextBindBase(!!n.glProgram.transformFeedbackVaryings),t(this._renderer,n,U)}updateUniformGroup(n){this._renderer.uniformGroup.updateUniformGroup(n,this._activeProgram,U)}bindUniformBlock(n,e,t=0){const i=this._renderer.buffer,a=this._getProgramData(this._activeProgram),o=n._bufferResource;o||this._renderer.ubo.updateUniformGroup(n);const c=n.buffer,s=i.updateBuffer(c),u=i.freeLocationForBufferBase(s);if(o){const{offset:l,size:m}=n;l===0&&m===c.data.byteLength?i.bindBufferBase(s,u):i.bindBufferRange(s,u,l)}else i.getLastBindBaseLocation(s)!==u&&i.bindBufferBase(s,u);const f=this._activeProgram._uniformBlockData[e].index;a.uniformBlockBindings[t]!==u&&(a.uniformBlockBindings[t]=u,this._renderer.gl.uniformBlockBinding(a.program,f,u))}_setProgram(n){if(this._activeProgram===n)return;this._activeProgram=n;const e=this._getProgramData(n);this._gl.useProgram(e.program)}_getProgramData(n){return this._programDataHash[n._key]||this._createProgramData(n)}_createProgramData(n){const e=n._key;return this._programDataHash[e]=ht(this._gl,n),this._programDataHash[e]}destroy(){for(const n of Object.keys(this._programDataHash))this._programDataHash[n].destroy();this._programDataHash=null,this._shaderSyncFunctions=null,this._activeProgram=null,this._renderer=null,this._gl=null}_generateShaderSync(n,e){return st(n,e)}resetState(){this._activeProgram=null}}X.extension={type:[A.WebGLSystem],name:"shader"};const gt={f32:`if (cv !== v) {
            cu.value = v;
            gl.uniform1f(location, v);
        }`,"vec2<f32>":`if (cv[0] !== v[0] || cv[1] !== v[1]) {
            cv[0] = v[0];
            cv[1] = v[1];
            gl.uniform2f(location, v[0], v[1]);
        }`,"vec3<f32>":`if (cv[0] !== v[0] || cv[1] !== v[1] || cv[2] !== v[2]) {
            cv[0] = v[0];
            cv[1] = v[1];
            cv[2] = v[2];
            gl.uniform3f(location, v[0], v[1], v[2]);
        }`,"vec4<f32>":`if (cv[0] !== v[0] || cv[1] !== v[1] || cv[2] !== v[2] || cv[3] !== v[3]) {
            cv[0] = v[0];
            cv[1] = v[1];
            cv[2] = v[2];
            cv[3] = v[3];
            gl.uniform4f(location, v[0], v[1], v[2], v[3]);
        }`,i32:`if (cv !== v) {
            cu.value = v;
            gl.uniform1i(location, v);
        }`,"vec2<i32>":`if (cv[0] !== v[0] || cv[1] !== v[1]) {
            cv[0] = v[0];
            cv[1] = v[1];
            gl.uniform2i(location, v[0], v[1]);
        }`,"vec3<i32>":`if (cv[0] !== v[0] || cv[1] !== v[1] || cv[2] !== v[2]) {
            cv[0] = v[0];
            cv[1] = v[1];
            cv[2] = v[2];
            gl.uniform3i(location, v[0], v[1], v[2]);
        }`,"vec4<i32>":`if (cv[0] !== v[0] || cv[1] !== v[1] || cv[2] !== v[2] || cv[3] !== v[3]) {
            cv[0] = v[0];
            cv[1] = v[1];
            cv[2] = v[2];
            cv[3] = v[3];
            gl.uniform4i(location, v[0], v[1], v[2], v[3]);
        }`,u32:`if (cv !== v) {
            cu.value = v;
            gl.uniform1ui(location, v);
        }`,"vec2<u32>":`if (cv[0] !== v[0] || cv[1] !== v[1]) {
            cv[0] = v[0];
            cv[1] = v[1];
            gl.uniform2ui(location, v[0], v[1]);
        }`,"vec3<u32>":`if (cv[0] !== v[0] || cv[1] !== v[1] || cv[2] !== v[2]) {
            cv[0] = v[0];
            cv[1] = v[1];
            cv[2] = v[2];
            gl.uniform3ui(location, v[0], v[1], v[2]);
        }`,"vec4<u32>":`if (cv[0] !== v[0] || cv[1] !== v[1] || cv[2] !== v[2] || cv[3] !== v[3]) {
            cv[0] = v[0];
            cv[1] = v[1];
            cv[2] = v[2];
            cv[3] = v[3];
            gl.uniform4ui(location, v[0], v[1], v[2], v[3]);
        }`,bool:`if (cv !== v) {
            cu.value = v;
            gl.uniform1i(location, v);
        }`,"vec2<bool>":`if (cv[0] !== v[0] || cv[1] !== v[1]) {
            cv[0] = v[0];
            cv[1] = v[1];
            gl.uniform2i(location, v[0], v[1]);
        }`,"vec3<bool>":`if (cv[0] !== v[0] || cv[1] !== v[1] || cv[2] !== v[2]) {
            cv[0] = v[0];
            cv[1] = v[1];
            cv[2] = v[2];
            gl.uniform3i(location, v[0], v[1], v[2]);
        }`,"vec4<bool>":`if (cv[0] !== v[0] || cv[1] !== v[1] || cv[2] !== v[2] || cv[3] !== v[3]) {
            cv[0] = v[0];
            cv[1] = v[1];
            cv[2] = v[2];
            cv[3] = v[3];
            gl.uniform4i(location, v[0], v[1], v[2], v[3]);
        }`,"mat2x2<f32>":"gl.uniformMatrix2fv(location, false, v);","mat3x3<f32>":"gl.uniformMatrix3fv(location, false, v);","mat4x4<f32>":"gl.uniformMatrix4fv(location, false, v);"},yt={f32:"gl.uniform1fv(location, v);","vec2<f32>":"gl.uniform2fv(location, v);","vec3<f32>":"gl.uniform3fv(location, v);","vec4<f32>":"gl.uniform4fv(location, v);","mat2x2<f32>":"gl.uniformMatrix2fv(location, false, v);","mat3x3<f32>":"gl.uniformMatrix3fv(location, false, v);","mat4x4<f32>":"gl.uniformMatrix4fv(location, false, v);",i32:"gl.uniform1iv(location, v);","vec2<i32>":"gl.uniform2iv(location, v);","vec3<i32>":"gl.uniform3iv(location, v);","vec4<i32>":"gl.uniform4iv(location, v);",u32:"gl.uniform1iv(location, v);","vec2<u32>":"gl.uniform2iv(location, v);","vec3<u32>":"gl.uniform3iv(location, v);","vec4<u32>":"gl.uniform4iv(location, v);",bool:"gl.uniform1iv(location, v);","vec2<bool>":"gl.uniform2iv(location, v);","vec3<bool>":"gl.uniform3iv(location, v);","vec4<bool>":"gl.uniform4iv(location, v);"};function pt(r,n){const e=[`
        var v = null;
        var cv = null;
        var cu = null;
        var t = 0;
        var gl = renderer.gl;
        var name = null;
    `];for(const t in r.uniforms){if(!n[t]){r.uniforms[t]instanceof E?r.uniforms[t].ubo?e.push(`
                        renderer.shader.bindUniformBlock(uv.${t}, "${t}");
                    `):e.push(`
                        renderer.shader.updateUniformGroup(uv.${t});
                    `):r.uniforms[t]instanceof O&&e.push(`
                        renderer.shader.bindBufferResource(uv.${t}, "${t}");
                    `);continue}const i=r.uniformStructures[t];let a=!1;for(let o=0;o<v.length;o++){const c=v[o];if(i.type===c.type&&c.test(i)){e.push(`name = "${t}";`,v[o].uniform),a=!0;break}}if(!a){const c=(i.size===1?gt:yt)[i.type].replace("location",`ud["${t}"].location`);e.push(`
            cu = ud["${t}"];
            cv = cu.value;
            v = uv["${t}"];
            ${c};`)}}return new Function("ud","uv","renderer","syncData",e.join(`
`))}class J{constructor(n){this._cache={},this._uniformGroupSyncHash={},this._renderer=n,this.gl=null,this._cache={}}contextChange(n){this.gl=n}updateUniformGroup(n,e,t){const i=this._renderer.shader._getProgramData(e);(!n.isStatic||n._dirtyId!==i.uniformDirtyGroups[n.uid])&&(i.uniformDirtyGroups[n.uid]=n._dirtyId,this._getUniformSyncFunction(n,e)(i.uniformData,n.uniforms,this._renderer,t))}_getUniformSyncFunction(n,e){return this._uniformGroupSyncHash[n._signature]?.[e._key]||this._createUniformSyncFunction(n,e)}_createUniformSyncFunction(n,e){const t=this._uniformGroupSyncHash[n._signature]||(this._uniformGroupSyncHash[n._signature]={}),i=this._getSignature(n,e._uniformData,"u");return this._cache[i]||(this._cache[i]=this._generateUniformsSync(n,e._uniformData)),t[e._key]=this._cache[i],t[e._key]}_generateUniformsSync(n,e){return pt(n,e)}_getSignature(n,e,t){const i=n.uniforms,a=[`${t}-`];for(const o in i)a.push(o),e[o]&&a.push(e[o].type);return a.join("-")}destroy(){this._renderer=null,this._cache=null}}J.extension={type:[A.WebGLSystem],name:"uniformGroup"};const p={i32:{align:4,size:4},u32:{align:4,size:4},f32:{align:4,size:4},f16:{align:2,size:2},"vec2<i32>":{align:8,size:8},"vec2<u32>":{align:8,size:8},"vec2<f32>":{align:8,size:8},"vec2<f16>":{align:4,size:4},"vec3<i32>":{align:16,size:12},"vec3<u32>":{align:16,size:12},"vec3<f32>":{align:16,size:12},"vec3<f16>":{align:8,size:6},"vec4<i32>":{align:16,size:16},"vec4<u32>":{align:16,size:16},"vec4<f32>":{align:16,size:16},"vec4<f16>":{align:8,size:8},"mat2x2<f32>":{align:8,size:16},"mat2x2<f16>":{align:4,size:8},"mat3x2<f32>":{align:8,size:24},"mat3x2<f16>":{align:4,size:12},"mat4x2<f32>":{align:8,size:32},"mat4x2<f16>":{align:4,size:16},"mat2x3<f32>":{align:16,size:32},"mat2x3<f16>":{align:8,size:16},"mat3x3<f32>":{align:16,size:48},"mat3x3<f16>":{align:8,size:24},"mat4x3<f32>":{align:16,size:64},"mat4x3<f16>":{align:8,size:32},"mat2x4<f32>":{align:16,size:32},"mat2x4<f16>":{align:8,size:16},"mat3x4<f32>":{align:16,size:48},"mat3x4<f16>":{align:8,size:24},"mat4x4<f32>":{align:16,size:64},"mat4x4<f16>":{align:8,size:32}};function bt(r){const n=r.map(t=>({data:t,offset:0,size:0}));let e=0;for(let t=0;t<n.length;t++){const i=n[t];let a=p[i.data.type].size;const o=p[i.data.type].align;if(!p[i.data.type])throw new Error(`[Pixi.js] WebGPU UniformBuffer: Unknown type ${i.data.type}`);i.data.size>1&&(a=Math.max(a,o)*i.data.size),e=Math.ceil(e/o)*o,i.size=a,i.offset=e,e+=a}return e=Math.ceil(e/16)*16,{uboElements:n,size:e}}function xt(r,n){const{size:e,align:t}=p[r.data.type],i=(t-e)/4,a=r.data.type.indexOf("i32")>=0?"dataInt32":"data";return`
         v = uv.${r.data.name};
         ${n!==0?`offset += ${n};`:""}

         arrayOffset = offset;

         t = 0;

         for(var i=0; i < ${r.data.size*(e/4)}; i++)
         {
             for(var j = 0; j < ${e/4}; j++)
             {
                 ${a}[arrayOffset++] = v[t++];
             }
             ${i!==0?`arrayOffset += ${i};`:""}
         }
     `}function St(r){return j(r,"uboWgsl",xt,at)}class Z extends w{constructor(){super({createUboElements:bt,generateUboSync:St})}}Z.extension={type:[A.WebGPUSystem],name:"ubo"};function C(r,n=null){const e=r*6;if(e>65535?n||(n=new Uint32Array(e)):n||(n=new Uint16Array(e)),n.length!==e)throw new Error(`Out buffer length is incorrect, got ${n.length} and expected ${e}`);for(let t=0,i=0;t<e;t+=6,i+=4)n[t+0]=i+0,n[t+1]=i+1,n[t+2]=i+2,n[t+3]=i+0,n[t+4]=i+2,n[t+5]=i+3;return n}function Ut(r){return{dynamicUpdate:N(r,!0),staticUpdate:N(r,!1)}}function N(r,n){const e=[];e.push(`

        var index = 0;

        for (let i = 0; i < ps.length; ++i)
        {
            const p = ps[i];

            `);let t=0;for(const a in r){const o=r[a];if(n!==o.dynamic)continue;e.push(`offset = index + ${t}`),e.push(o.code);const c=b(o.format);t+=c.stride/4}e.push(`
            index += stride * 4;
        }
    `),e.unshift(`
        var stride = ${t};
    `);const i=e.join(`
`);return new Function("ps","f32v","u32v",i)}class Pt{constructor(n){this._size=0,this._generateParticleUpdateCache={};const e=this._size=n.size??1e3,t=n.properties;let i=0,a=0;for(const f in t){const l=t[f],m=b(l.format);l.dynamic?a+=m.stride:i+=m.stride}this._dynamicStride=a/4,this._staticStride=i/4,this.staticAttributeBuffer=new x(e*4*i),this.dynamicAttributeBuffer=new x(e*4*a),this.indexBuffer=C(e);const o=new nt;let c=0,s=0;this._staticBuffer=new P({data:new Float32Array(1),label:"static-particle-buffer",shrinkToFit:!1,usage:d.VERTEX|d.COPY_DST}),this._dynamicBuffer=new P({data:new Float32Array(1),label:"dynamic-particle-buffer",shrinkToFit:!1,usage:d.VERTEX|d.COPY_DST});for(const f in t){const l=t[f],m=b(l.format);l.dynamic?(o.addAttribute(l.attributeName,{buffer:this._dynamicBuffer,stride:this._dynamicStride*4,offset:c*4,format:l.format}),c+=m.size):(o.addAttribute(l.attributeName,{buffer:this._staticBuffer,stride:this._staticStride*4,offset:s*4,format:l.format}),s+=m.size)}o.addIndex(this.indexBuffer);const u=this.getParticleUpdate(t);this._dynamicUpload=u.dynamicUpdate,this._staticUpload=u.staticUpdate,this.geometry=o}getParticleUpdate(n){const e=At(n);return this._generateParticleUpdateCache[e]?this._generateParticleUpdateCache[e]:(this._generateParticleUpdateCache[e]=this.generateParticleUpdate(n),this._generateParticleUpdateCache[e])}generateParticleUpdate(n){return Ut(n)}update(n,e){n.length>this._size&&(e=!0,this._size=Math.max(n.length,this._size*1.5|0),this.staticAttributeBuffer=new x(this._size*this._staticStride*4*4),this.dynamicAttributeBuffer=new x(this._size*this._dynamicStride*4*4),this.indexBuffer=C(this._size),this.geometry.indexBuffer.setDataWithSize(this.indexBuffer,this.indexBuffer.byteLength,!0));const t=this.dynamicAttributeBuffer;if(this._dynamicUpload(n,t.float32View,t.uint32View),this._dynamicBuffer.setDataWithSize(this.dynamicAttributeBuffer.float32View,n.length*this._dynamicStride*4,!0),e){const i=this.staticAttributeBuffer;this._staticUpload(n,i.float32View,i.uint32View),this._staticBuffer.setDataWithSize(i.float32View,n.length*this._staticStride*4,!0)}}destroy(){this._staticBuffer.destroy(),this._dynamicBuffer.destroy(),this.geometry.destroy()}}function At(r){const n=[];for(const e in r){const t=r[e];n.push(e,t.code,t.dynamic?"d":"s")}return n.join("_")}const Ft={aVertex:(r,n,e,t,i)=>{let a=0,o=0,c=0,s=0;for(let u=0;u<r.length;++u){const f=r[u],l=f.texture,m=f.scaleX,_=f.scaleY,F=f.anchorX,D=f.anchorY,y=l.trim,h=l.orig;y?(o=y.x-F*h.width,a=o+y.width,s=y.y-D*h.height,c=s+y.height):(a=h.width*(1-F),o=h.width*-F,c=h.height*(1-D),s=h.height*-D),n[t]=o*m,n[t+1]=s*_,n[t+i]=a*m,n[t+i+1]=s*_,n[t+i*2]=a*m,n[t+i*2+1]=c*_,n[t+i*3]=o*m,n[t+i*3+1]=c*_,t+=i*4}},aPosition:(r,n,e,t,i)=>{for(let a=0;a<r.length;++a){const o=r[a],c=o.x,s=o.y;n[t]=c,n[t+1]=s,n[t+i]=c,n[t+i+1]=s,n[t+i*2]=c,n[t+i*2+1]=s,n[t+i*3]=c,n[t+i*3+1]=s,t+=i*4}},aRotation:(r,n,e,t,i)=>{for(let a=0;a<r.length;++a){const o=r[a].rotation;n[t]=o,n[t+i]=o,n[t+i*2]=o,n[t+i*3]=o,t+=i*4}},aUV:(r,n,e,t,i)=>{for(let a=0;a<r.length;++a){const o=r[a].texture.uvs;n[t]=o.x0,n[t+1]=o.y0,n[t+i]=o.x1,n[t+i+1]=o.y1,n[t+i*2]=o.x2,n[t+i*2+1]=o.y2,n[t+i*3]=o.x3,n[t+i*3+1]=o.y3,t+=i*4}},aColor:(r,n,e,t,i)=>{for(let a=0;a<r.length;++a){const o=r[a].color;e[t]=o,e[t+i]=o,e[t+i*2]=o,e[t+i*3]=o,t+=i*4}}};function Dt(r){const n=Object.values(r),e=n.filter(i=>i.dynamic),t=n.filter(i=>!i.dynamic);return{dynamicUpdate:R(e),staticUpdate:R(t)}}function R(r){let n=0;const e=[];for(let t=0;t<r.length;t++){const i=r[t],a=b(i.format).stride/4;n+=a,e.push({stride:a,updateFunction:i.updateFunction||Ft[i.attributeName]})}return(t,i,a)=>{let o=0;for(let c=0;c<e.length;c++){const s=e[c];s.updateFunction(t,i,a,o,n),o+=s.stride}}}function It(){return Tt}function Tt(r,n,e){const t=r.gl,i=r.shader,a=i._getProgramData(n.glProgram);for(const o in n.groups){const c=n.groups[o];for(const s in c.resources){const u=c.resources[s];if(u instanceof E)u.ubo?i.bindUniformBlock(u,n._uniformBindMap[o][s],e.blockIndex++):i.updateUniformGroup(u);else if(u instanceof O)i.bindUniformBlock(u,n._uniformBindMap[o][s],e.blockIndex++);else if(u instanceof V){r.texture.bind(u,e.textureCount);const f=n._uniformBindMap[o][s],l=a.uniformData[f];l&&(l.value!==e.textureCount&&t.uniform1i(l.location,e.textureCount),e.textureCount++)}}}}const zt=[(r,n,e,t,i)=>{const a=t[r].toArray(!0);n[e]=a[0],n[e+1]=a[1],n[e+2]=a[2],n[e+4]=a[3],n[e+5]=a[4],n[e+6]=a[5],n[e+8]=a[6],n[e+9]=a[7],n[e+10]=a[8]},(r,n,e,t,i)=>{i=t[r],n[e]=i.x,n[e+1]=i.y,n[e+2]=i.width,n[e+3]=i.height},(r,n,e,t,i)=>{i=t[r],n[e]=i.x,n[e+1]=i.y},(r,n,e,t,i)=>{i=t[r],n[e]=i.red,n[e+1]=i.green,n[e+2]=i.blue,n[e+3]=i.alpha},(r,n,e,t,i)=>{i=t[r],n[e]=i.red,n[e+1]=i.green,n[e+2]=i.blue}],Et={f32:(r,n,e,t,i)=>{n[e]=i},i32:(r,n,e,t,i)=>{n[e]=i},"vec2<f32>":(r,n,e,t,i)=>{n[e]=i[0],n[e+1]=i[1]},"vec3<f32>":(r,n,e,t,i)=>{n[e]=i[0],n[e+1]=i[1],n[e+2]=i[2]},"vec4<f32>":(r,n,e,t,i)=>{n[e]=i[0],n[e+1]=i[1],n[e+2]=i[2],n[e+3]=i[3]},"mat2x2<f32>":(r,n,e,t,i)=>{n[e]=i[0],n[e+1]=i[1],n[e+2]=i[2],n[e+3]=i[3]},"mat3x3<f32>":(r,n,e,t,i)=>{n[e]=i[0],n[e+1]=i[1],n[e+2]=i[2],n[e+4]=i[3],n[e+5]=i[4],n[e+6]=i[5],n[e+8]=i[6],n[e+9]=i[7],n[e+10]=i[8]},"mat4x4<f32>":(r,n,e,t,i)=>{for(let a=0;a<16;a++)n[e+a]=i[a]},"mat3x2<f32>":(r,n,e,t,i)=>{for(let a=0;a<6;a++)n[e+(a/3|0)*4+a%3]=i[a]},"mat4x2<f32>":(r,n,e,t,i)=>{for(let a=0;a<8;a++)n[e+(a/4|0)*4+a%4]=i[a]},"mat2x3<f32>":(r,n,e,t,i)=>{for(let a=0;a<6;a++)n[e+(a/2|0)*4+a%2]=i[a]},"mat4x3<f32>":(r,n,e,t,i)=>{for(let a=0;a<12;a++)n[e+(a/4|0)*4+a%4]=i[a]},"mat2x4<f32>":(r,n,e,t,i)=>{for(let a=0;a<8;a++)n[e+(a/2|0)*4+a%2]=i[a]},"mat3x4<f32>":(r,n,e,t,i)=>{for(let a=0;a<12;a++)n[e+(a/3|0)*4+a%3]=i[a]}},wt={f32:(r,n,e,t,i)=>{n[e]=i},i32:(r,n,e,t,i)=>{n[e]=i},"vec2<f32>":(r,n,e,t,i)=>{n[e]=i[0],n[e+1]=i[1]},"vec3<f32>":(r,n,e,t,i)=>{n[e]=i[0],n[e+1]=i[1],n[e+2]=i[2]},"vec4<f32>":(r,n,e,t,i)=>{n[e]=i[0],n[e+1]=i[1],n[e+2]=i[2],n[e+3]=i[3]},"mat2x2<f32>":(r,n,e,t,i)=>{n[e]=i[0],n[e+1]=i[1],n[e+4]=i[2],n[e+5]=i[3]},"mat3x3<f32>":(r,n,e,t,i)=>{n[e]=i[0],n[e+1]=i[1],n[e+2]=i[2],n[e+4]=i[3],n[e+5]=i[4],n[e+6]=i[5],n[e+8]=i[6],n[e+9]=i[7],n[e+10]=i[8]},"mat4x4<f32>":(r,n,e,t,i)=>{for(let a=0;a<16;a++)n[e+a]=i[a]},"mat3x2<f32>":(r,n,e,t,i)=>{for(let a=0;a<6;a++)n[e+(a/3|0)*4+a%3]=i[a]},"mat4x2<f32>":(r,n,e,t,i)=>{for(let a=0;a<8;a++)n[e+(a/4|0)*4+a%4]=i[a]},"mat2x3<f32>":(r,n,e,t,i)=>{for(let a=0;a<6;a++)n[e+(a/2|0)*4+a%2]=i[a]},"mat4x3<f32>":(r,n,e,t,i)=>{for(let a=0;a<12;a++)n[e+(a/4|0)*4+a%4]=i[a]},"mat2x4<f32>":(r,n,e,t,i)=>{for(let a=0;a<8;a++)n[e+(a/2|0)*4+a%2]=i[a]},"mat3x4<f32>":(r,n,e,t,i)=>{for(let a=0;a<12;a++)n[e+(a/3|0)*4+a%3]=i[a]}};function Bt(r){return q(r,wt,n=>{const e=Math.max(B[n.data.type]/16,1),t=n.data.value.length/n.data.size,i=(4-t%4)%4;return(a,o,c,s,u)=>{let f=0;for(let l=0;l<n.data.size*e;l++){for(let m=0;m<t;m++)o[c++]=u[f++];c+=i}}})}function Ot(r){return q(r,Et,n=>{const{size:e,align:t}=p[n.data.type],i=(e-t)/4;return(a,o,c,s,u)=>{let f=0;for(let l=0;l<n.data.size*(e/4);l++){for(let m=0;m<e/4;m++)o[c++]=u[f++];c+=i}}})}function q(r,n,e){const t={};for(const i in r){const a=r[i],o=a.data;let c=!1;t[o.name]={offset:a.offset/4,func:null};for(let s=0;s<v.length;s++){const u=v[s];if(o.type===u.type&&u.test(o)){t[o.name].func=zt[s],c=!0;break}}c||(o.size===1?t[o.name].func=n[o.type]:t[o.name].func=e(a))}return(i,a,o)=>{for(const c in t)t[c].func(c,a,o+t[c].offset,i,i[c])}}const Lt={f32(r,n,e,t,i,a,o){e!==t&&(n.value=t,o.uniform1f(i[r].location,t))},"vec2<f32>"(r,n,e,t,i,a,o){(e[0]!==t[0]||e[1]!==t[1])&&(e[0]=t[0],e[1]=t[1],o.uniform2f(i[r].location,t[0],t[1]))},"vec3<f32>"(r,n,e,t,i,a,o){(e[0]!==t[0]||e[1]!==t[1]||e[2]!==t[2])&&(e[0]=t[0],e[1]=t[1],e[2]=t[2],o.uniform3f(i[r].location,t[0],t[1],t[2]))},"vec4<f32>"(r,n,e,t,i,a,o){(e[0]!==t[0]||e[1]!==t[1]||e[2]!==t[2]||e[3]!==t[3])&&(e[0]=t[0],e[1]=t[1],e[2]=t[2],e[3]=t[3],o.uniform4f(i[r].location,t[0],t[1],t[2],t[3]))},i32(r,n,e,t,i,a,o){e!==t&&(n.value=t,o.uniform1i(i[r].location,t))},"vec2<i32>"(r,n,e,t,i,a,o){(e[0]!==t[0]||e[1]!==t[1])&&(e[0]=t[0],e[1]=t[1],o.uniform2i(i[r].location,t[0],t[1]))},"vec3<i32>"(r,n,e,t,i,a,o){(e[0]!==t[0]||e[1]!==t[1]||e[2]!==t[2])&&(e[0]=t[0],e[1]=t[1],e[2]=t[2],o.uniform3i(i[r].location,t[0],t[1],t[2]))},"vec4<i32>"(r,n,e,t,i,a,o){(e[0]!==t[0]||e[1]!==t[1]||e[2]!==t[2]||e[3]!==t[3])&&(e[0]=t[0],e[1]=t[1],e[2]=t[2],e[3]=t[3],o.uniform4i(i[r].location,t[0],t[1],t[2],t[3]))},u32(r,n,e,t,i,a,o){e!==t&&(n.value=t,o.uniform1ui(i[r].location,t))},"vec2<u32>"(r,n,e,t,i,a,o){(e[0]!==t[0]||e[1]!==t[1])&&(e[0]=t[0],e[1]=t[1],o.uniform2ui(i[r].location,t[0],t[1]))},"vec3<u32>"(r,n,e,t,i,a,o){(e[0]!==t[0]||e[1]!==t[1]||e[2]!==t[2])&&(e[0]=t[0],e[1]=t[1],e[2]=t[2],o.uniform3ui(i[r].location,t[0],t[1],t[2]))},"vec4<u32>"(r,n,e,t,i,a,o){(e[0]!==t[0]||e[1]!==t[1]||e[2]!==t[2]||e[3]!==t[3])&&(e[0]=t[0],e[1]=t[1],e[2]=t[2],e[3]=t[3],o.uniform4ui(i[r].location,t[0],t[1],t[2],t[3]))},bool(r,n,e,t,i,a,o){e!==t&&(n.value=t,o.uniform1i(i[r].location,t))},"vec2<bool>"(r,n,e,t,i,a,o){(e[0]!==t[0]||e[1]!==t[1])&&(e[0]=t[0],e[1]=t[1],o.uniform2i(i[r].location,t[0],t[1]))},"vec3<bool>"(r,n,e,t,i,a,o){(e[0]!==t[0]||e[1]!==t[1]||e[2]!==t[2])&&(e[0]=t[0],e[1]=t[1],e[2]=t[2],o.uniform3i(i[r].location,t[0],t[1],t[2]))},"vec4<bool>"(r,n,e,t,i,a,o){(e[0]!==t[0]||e[1]!==t[1]||e[2]!==t[2]||e[3]!==t[3])&&(e[0]=t[0],e[1]=t[1],e[2]=t[2],e[3]=t[3],o.uniform4i(i[r].location,t[0],t[1],t[2],t[3]))},"mat2x2<f32>"(r,n,e,t,i,a,o){o.uniformMatrix2fv(i[r].location,!1,t)},"mat3x3<f32>"(r,n,e,t,i,a,o){o.uniformMatrix3fv(i[r].location,!1,t)},"mat4x4<f32>"(r,n,e,t,i,a,o){o.uniformMatrix4fv(i[r].location,!1,t)}},kt={f32(r,n,e,t,i,a,o){o.uniform1fv(i[r].location,t)},"vec2<f32>"(r,n,e,t,i,a,o){o.uniform2fv(i[r].location,t)},"vec3<f32>"(r,n,e,t,i,a,o){o.uniform3fv(i[r].location,t)},"vec4<f32>"(r,n,e,t,i,a,o){o.uniform4fv(i[r].location,t)},"mat2x2<f32>"(r,n,e,t,i,a,o){o.uniformMatrix2fv(i[r].location,!1,t)},"mat3x3<f32>"(r,n,e,t,i,a,o){o.uniformMatrix3fv(i[r].location,!1,t)},"mat4x4<f32>"(r,n,e,t,i,a,o){o.uniformMatrix4fv(i[r].location,!1,t)},i32(r,n,e,t,i,a,o){o.uniform1iv(i[r].location,t)},"vec2<i32>"(r,n,e,t,i,a,o){o.uniform2iv(i[r].location,t)},"vec3<i32>"(r,n,e,t,i,a,o){o.uniform3iv(i[r].location,t)},"vec4<i32>"(r,n,e,t,i,a,o){o.uniform4iv(i[r].location,t)},u32(r,n,e,t,i,a,o){o.uniform1iv(i[r].location,t)},"vec2<u32>"(r,n,e,t,i,a,o){o.uniform2iv(i[r].location,t)},"vec3<u32>"(r,n,e,t,i,a,o){o.uniform3iv(i[r].location,t)},"vec4<u32>"(r,n,e,t,i,a,o){o.uniform4iv(i[r].location,t)},bool(r,n,e,t,i,a,o){o.uniform1iv(i[r].location,t)},"vec2<bool>"(r,n,e,t,i,a,o){o.uniform2iv(i[r].location,t)},"vec3<bool>"(r,n,e,t,i,a,o){o.uniform3iv(i[r].location,t)},"vec4<bool>"(r,n,e,t,i,a,o){o.uniform4iv(i[r].location,t)}},$t=[(r,n,e,t,i,a,o)=>{o.uniformMatrix3fv(i[r].location,!1,a[r].toArray(!0))},(r,n,e,t,i,a,o)=>{e=i[r].value,t=a[r],(e[0]!==t.x||e[1]!==t.y||e[2]!==t.width||e[3]!==t.height)&&(e[0]=t.x,e[1]=t.y,e[2]=t.width,e[3]=t.height,o.uniform4f(i[r].location,t.x,t.y,t.width,t.height))},(r,n,e,t,i,a,o)=>{e=i[r].value,t=a[r],(e[0]!==t.x||e[1]!==t.y)&&(e[0]=t.x,e[1]=t.y,o.uniform2f(i[r].location,t.x,t.y))},(r,n,e,t,i,a,o)=>{e=i[r].value,t=a[r],(e[0]!==t.red||e[1]!==t.green||e[2]!==t.blue||e[3]!==t.alpha)&&(e[0]=t.red,e[1]=t.green,e[2]=t.blue,e[3]=t.alpha,o.uniform4f(i[r].location,t.red,t.green,t.blue,t.alpha))},(r,n,e,t,i,a,o)=>{e=i[r].value,t=a[r],(e[0]!==t.red||e[1]!==t.green||e[2]!==t.blue)&&(e[0]=t.red,e[1]=t.green,e[2]=t.blue,o.uniform3f(i[r].location,t.red,t.green,t.blue))}];function Gt(r,n){const e={};for(const t in r.uniformStructures){if(!n[t])continue;const i=r.uniformStructures[t];let a=!1;for(let o=0;o<v.length;o++){const c=v[o];if(i.type===c.type&&c.test(i)){e[t]=$t[o],a=!0;break}}if(!a){const o=i.size===1?Lt:kt;e[t]=o[i.type]}}return(t,i,a)=>{const o=a.gl;for(const c in e){const s=i[c],u=t[c],f=t[c].value;e[c](c,u,f,s,t,i,o)}}}function Mt(){Object.assign(it.prototype,{_unsafeEvalCheck(){}}),Object.assign(w.prototype,{_systemCheck(){}}),Object.assign(J.prototype,{_generateUniformsSync:Gt}),Object.assign(H.prototype,{_generateUboSync:Bt}),Object.assign(Z.prototype,{_generateUboSync:Ot}),Object.assign(X.prototype,{_generateShaderSync:It}),Object.assign(Pt.prototype,{generateParticleUpdate:Dt})}Mt();const z=document.getElementById("fusion-app");if(!z)throw new Error("Mount target #fusion-app not found in DOM.");if(window.location.pathname==="/setup"){const{default:r}=await L(async()=>{const{default:n}=await import("./SetupWizard-BLJlrzPP.js");return{default:n}},__vite__mapDeps([0,1,2,3]));k(r,{target:z})}else{const{default:r}=await L(async()=>{const{default:n}=await import("./App-3DoztqP9.js").then(e=>e.aO);return{default:n}},__vite__mapDeps([4,1,2,5,6]));k(r,{target:z})}export{O as B,Z as G,H as a,J as b,X as c};
//# sourceMappingURL=index-BO7xCEie.js.map
