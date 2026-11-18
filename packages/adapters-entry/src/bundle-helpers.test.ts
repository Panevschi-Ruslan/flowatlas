import { Project, SyntaxKind } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { calleeShapeOf, holdsBundlerHelpers, webpackLoaderOf } from './bundle-helpers.js';

/** The shape of the helper each `const` of a file is, by its name. */
const shapes = (code: string): Record<string, string | undefined> => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { allowJs: true } });
  const file = project.createSourceFile('/repo/bundle.js', code);
  return Object.fromEntries(file.getDescendantsOfKind(SyntaxKind.VariableDeclaration).map((each) => [each.getName(), calleeShapeOf(each.getNameNode())]));
};

describe("a bundler's helpers told by their shape, whatever they are named (P355)", () => {
  it("reads esbuild's minified wrapper, export and interop helpers", () => {
    expect(
      shapes(
        [
          'var c=Object.defineProperty,u=Object.getOwnPropertyNames;',
          'var p=(t,e)=>function(){return e||(0,t[u(t)[0]])((e={exports:{}}).exports,e),e.exports};',
          'var f=(t,e)=>{for(var o in e)c(t,o,{get:e[o],enumerable:!0})};',
          'var x=(t,e)=>{for(let r of u(e))c(t,r,{get:()=>e[r]});return t};',
          'var g=t=>x(c({},"__esModule",{value:!0}),t);',
          'var w=(t,e,o)=>(o={},x(e||!t||!t.__esModule?c(o,"default",{value:t}):o,t));',
        ].join('\n'),
      ),
    ).toEqual({ c: undefined, u: undefined, p: 'wrapper', f: 'export', x: undefined, g: 'interop', w: 'interop' });
  });

  it("reads rolldown's minified wrapper and TypeScript's interop however named", () => {
    expect(
      shapes(
        [
          'const o=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports);',
          'var d=(this&&this.d)||function(m){return m&&m.__esModule?m:{default:m}};',
          'const plain=(a,b)=>({a,b});',
        ].join('\n'),
      ),
    ).toEqual({ o: 'wrapper', d: 'interop', plain: undefined });
  });

  it("finds webpack's loader renamed, and a file as a bundle by its helpers", () => {
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { allowJs: true } });
    const bundle = project.createSourceFile(
      '/repo/bundle.js',
      'var e={1:t=>{t.exports={}}},t={};function r(o){var n=t[o];if(void 0!==n)return n.exports;var s=t[o]={exports:{}};return e[o](s,s.exports,r),s.exports}module.exports=r(1);',
    );
    expect(webpackLoaderOf(bundle)?.getText()).toMatch(/^function r\(o\)/);
    expect(holdsBundlerHelpers(bundle)).toBe(true);
    const own = project.createSourceFile('/repo/own.js', 'function load(id){return table[id]()}const table={1:()=>({})};module.exports=load(1);');
    expect(webpackLoaderOf(own)).toBeUndefined();
    expect(holdsBundlerHelpers(own)).toBe(false);
  });
});
