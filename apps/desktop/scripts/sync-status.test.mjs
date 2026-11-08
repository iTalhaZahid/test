import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require=createRequire(import.meta.url);
const source=readFileSync(new URL('../src/renderer/SyncStatusPill.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
test('header pill reflects backend reachability, synchronization and actionable errors',()=>{
  globalThis.window={posSync:{}};
  try {
    for(const [state,label] of [['offline','Working in offline Mode'],['syncing','Syncing'],['online','Synced'],['error','Sync needs attention'],['auth-required','Online sign-in required']]) {
      const module={exports:{}};
      new Function('require','module','exports',compiled)(name=>name==='react'?{...React,useState:()=>[{state,pending:2,message:'Connection detail'},()=>{}],useEffect:()=>{}}:require(name),module,module.exports);
      const html=renderToStaticMarkup(React.createElement(module.exports.SyncStatusPill));
      assert.ok(html.includes(label));assert.ok(html.includes('role="status"'));assert.ok(html.includes('Connection detail'));
      delete globalThis.window.posSync;
      assert.equal(renderToStaticMarkup(React.createElement(module.exports.SyncStatusPill)),'');
      globalThis.window.posSync={};
    }
  } finally { delete globalThis.window; }
});
