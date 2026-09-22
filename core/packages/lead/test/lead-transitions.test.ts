import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyLeadTransition, leadTransitionRequiresReason } from '../src/index.ts';

test('standard forward path is STANDARD', () => {
  assert.equal(classifyLeadTransition('NEW', 'QUALIFIED'), 'STANDARD');
  assert.equal(classifyLeadTransition('QUALIFIED', 'PROPOSAL'), 'STANDARD');
  assert.equal(classifyLeadTransition('PROPOSAL', 'WON'), 'STANDARD');
  assert.equal(classifyLeadTransition('NEW', 'LOST'), 'STANDARD');
  assert.equal(classifyLeadTransition('QUALIFIED', 'LOST'), 'STANDARD');
});

test('skips, backward steps, and reopening a LOST lead are OVERRIDE (reason required)', () => {
  assert.equal(classifyLeadTransition('NEW', 'WON'), 'OVERRIDE');
  assert.equal(classifyLeadTransition('PROPOSAL', 'QUALIFIED'), 'OVERRIDE');
  assert.equal(classifyLeadTransition('QUALIFIED', 'NEW'), 'OVERRIDE');
  assert.equal(classifyLeadTransition('LOST', 'QUALIFIED'), 'OVERRIDE');
  assert.equal(leadTransitionRequiresReason('OVERRIDE'), true);
  assert.equal(leadTransitionRequiresReason('STANDARD'), false);
});

test('WON is terminal: it never transitions again', () => {
  assert.equal(classifyLeadTransition('WON', 'NEW'), 'ILLEGAL');
  assert.equal(classifyLeadTransition('WON', 'QUALIFIED'), 'ILLEGAL');
  assert.equal(classifyLeadTransition('WON', 'LOST'), 'ILLEGAL');
});

test('same stage is a NOOP, not a transition', () => {
  assert.equal(classifyLeadTransition('QUALIFIED', 'QUALIFIED'), 'NOOP');
});
