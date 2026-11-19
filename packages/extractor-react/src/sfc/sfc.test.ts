import { blankOutside } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { positionAt, topLevelBlocks } from './blocks.js';
import { handlersOf, svelteMarkupEvents, vueTemplateEvents } from './events.js';
import { componentNameOf, SVELTE_FORMAT, VUE_FORMAT } from './formats.js';

const VUE = [
  '<template>',
  '  <div class="a > b">',
  '    <template v-if="open"><button @click="save">Save</button></template>',
  '    <button v-on:submit.prevent="send(form)" @input="typed">Send</button>',
  '    <p>{{ count < 3 ? "few" : "many" }}</p>',
  '    <Row @remove-item="(id) => store.remove(id)" @update:model-value="x = $event" />',
  '  </div>',
  '</template>',
  '',
  '<script setup lang="ts">',
  "const save = async (): Promise<void> => { await $fetch('/api/orders', { method: 'POST' }); };",
  '</script>',
  '<style>.a { color: red; }</style>',
].join('\n');

/** The made-up file's text for a component, as the core writes it. */
const virtual = (text: string, format = VUE_FORMAT): string => {
  const scripts = format.scripts(text, 'x');
  return blankOutside(text, scripts?.ranges ?? []);
};

describe('a component file, read in place (P233)', () => {
  it('finds the top-level blocks past a nested template, a quoted `>` and a comment', () => {
    const blocks = topLevelBlocks(`<!-- <script> -->\n${VUE}`);
    expect(blocks.map((block) => block.name)).toEqual(['template', 'script', 'style']);
    expect(blocks[1]?.attributes.get('setup')).toBe(true);
    expect(blocks[1]?.attributes.get('lang')).toBe('ts');
  });

  it('keeps every line and column of the script where it is in the file', () => {
    const made = virtual(VUE);
    expect(made.length).toBe(VUE.length);
    const at = VUE.indexOf('$fetch');
    expect(made.indexOf('$fetch')).toBe(at);
    expect(positionAt(made, at)).toEqual(positionAt(VUE, at));
    expect(positionAt(VUE, at)).toEqual({ line: 11, column: 49 });
    // The markup is gone: the checker reads the script and nothing else.
    expect(made).not.toContain('<button');
    expect(made.split('\n')).toHaveLength(VUE.split('\n').length);
  });

  it('keeps CRLF line ends and a byte-order mark, so lines still agree', () => {
    const crlf = `﻿${VUE.replaceAll('\n', '\r\n')}`;
    const made = virtual(crlf);
    const at = crlf.indexOf('$fetch');
    expect(made.indexOf('$fetch')).toBe(at);
    expect(positionAt(made, at).line).toBe(11);
  });

  it('reads a script written before the template as well as after it', () => {
    const before = `<script setup>\nfunction go() {}\n</script>\n<template><a @click="go">x</a></template>`;
    expect(virtual(before).indexOf('function go')).toBe(before.indexOf('function go'));
    expect(vueTemplateEvents(before).map((event) => [event.event, event.line])).toEqual([['click', 4]]);
  });

  it('reads both Svelte scripts and leaves the markup out', () => {
    const svelte = `<script context="module">export const prerender = true;</script>\n<script lang="ts">\n  const send = () => fetch('/api/x');\n</script>\n<button on:click={send}>Send</button>\n<style>b{}</style>`;
    const made = virtual(svelte, SVELTE_FORMAT);
    expect(made).toContain('export const prerender');
    expect(made.indexOf("fetch('/api/x')")).toBe(svelte.indexOf("fetch('/api/x')"));
    expect(made).not.toContain('<button');
  });

  it('names a component by its file, or by its folder where many share the name', () => {
    expect(componentNameOf('src/views/OrdersPage.vue')).toBe('OrdersPage');
    expect(componentNameOf('pages/orders/index.vue')).toBe('orders/index');
    expect(componentNameOf('pages/orders/[id].vue')).toBe('orders/[id]');
    expect(componentNameOf('src/routes/+page.svelte')).toBe('routes/+page');
  });
});

describe('the event bindings of a template (P233)', () => {
  it('reads @, v-on:, modifiers and custom events, and leaves typing and v-model updates out', () => {
    const events = vueTemplateEvents(VUE);
    expect(events.map((event) => [event.event, event.source, event.line, event.column])).toEqual([
      ['click', 'save', 3, 35],
      ['submit', 'send(form)', 4, 13],
      ['remove-item', '(id) => store.remove(id)', 6, 10],
    ]);
    expect(events.map((event) => event.handlers)).toEqual([
      [{ kind: 'name', name: 'save' }],
      [{ kind: 'name', name: 'send' }],
      [{ kind: 'member', object: 'store', name: 'remove' }],
    ]);
  });

  it('reads Svelte 4 and 5 bindings, and the shorthand', () => {
    const svelte = `<script>let n = 0;</script>\n{#if n < 3}<button on:click|preventDefault={save}>a</button>{/if}\n<button onclick={() => api.send(n)}>b</button>\n<button {onclick}>c</button>\n<input oninput={typed} />`;
    expect(svelteMarkupEvents(svelte).map((event) => [event.event, event.handlers, event.line])).toEqual([
      ['click', [{ kind: 'name', name: 'save' }], 2],
      ['click', [{ kind: 'member', object: 'api', name: 'send' }], 3],
      ['click', [{ kind: 'name', name: 'onclick' }], 4],
    ]);
  });

  it('follows every call of a handler written as statements, and none of an assignment', () => {
    expect(handlersOf('a(); b(x)')).toEqual([
      { kind: 'name', name: 'a' },
      { kind: 'name', name: 'b' },
    ]);
    expect(handlersOf('open = true')).toEqual([]);
    expect(handlersOf("$emit('close')")).toEqual([]);
    expect(handlersOf('async () => { await save(); }')).toEqual([{ kind: 'name', name: 'save' }]);
  });
});
