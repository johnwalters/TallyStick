import assert from 'node:assert/strict';
import test from 'node:test';
import { routePrintCommand } from './report-preview-print-command';

test('Command-P opens a preview from the main application window without invoking system print', () => {
  const events: string[] = [];
  const main = { webContents: { send: (channel: string) => events.push(`send:${channel}`), print: () => events.push('print') } };
  routePrintCommand(main, main);
  assert.deepEqual(events, ['send:report-preview:request-open']);
});

test('File > Print is explicit within a preview window and never prints when no window is focused', () => {
  const events: string[] = [];
  const main = { webContents: { send: () => events.push('main-send'), print: () => events.push('main-print') } };
  const preview = { webContents: { send: () => events.push('preview-send'), print: () => events.push('preview-print') } };
  routePrintCommand(preview, main);
  routePrintCommand(undefined, main);
  assert.deepEqual(events, ['preview-print']);
});
