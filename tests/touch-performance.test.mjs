import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import { runInNewContext } from 'node:vm';

test('page-level pinch protection never installs scroll-blocking document touch listeners', () => {
  const source = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8').split('<script>')[1].split('</script>')[0];
  const ast = parse(source, { sourceType: 'module' });
  const listeners = [];
  const context = { document: { addEventListener(type, handler, options) { listeners.push({ type, handler, options }); } } };
  for (const declaration of ast.program.body.filter(node => node.type === 'FunctionDeclaration')) runInNewContext(source.slice(declaration.start, declaration.end), context);
  const app = ast.program.body.find(node => node.type === 'ExportDefaultDeclaration').declaration;
  const component = runInNewContext(`(${source.slice(app.start, app.end)})`, {
    ...context,
    uni: { getStorageSync: () => ({}), setStorageSync() {} }
  });
  component.onLaunch();
  assert.deepEqual(listeners.filter(item => ['touchstart', 'touchmove'].includes(item.type) && !item.options?.passive), [], 'CSS touch-action and viewport settings already enforce pinch policy without blocking one-finger scrolling');
});
