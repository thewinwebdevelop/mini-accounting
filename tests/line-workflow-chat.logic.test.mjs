import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkflowChoices, reduceLineWorkflowEvent } from '../forms/line-workflow-chat.logic.js';
const templates = Array.from({
  length: 15
}, (_, i) => ({
  templateId: `t${i}`,
  name: `Workflow ${i}`,
  active: true
}));
const batch = {
  id: 'b',
  revision: 3,
  state: 'selecting',
  templateChoices: templates
};
test('pages choices within LINE limits and binds buttons to revision', () => {
  const message = buildWorkflowChoices({
    batch,
    page: 0
  });
  assert.ok(message.quickReply.items.length <= 13);
  assert.match(message.quickReply.items[0].action.data, /invoice-workflow:/);
  assert.match(message.text, /Workflow 0/);
});
test('numeric reply uses displayed snapshot and rejects stale postback', () => {
  assert.equal(reduceLineWorkflowEvent({
    event: {
      type: 'message',
      source: {
        type: 'user'
      },
      message: {
        type: 'text',
        text: '2'
      }
    },
    batch,
    templates: [...templates].reverse()
  }).patch.templateSnapshot.templateId, 't1');
  const action = buildWorkflowChoices({
    batch,
    page: 0
  }).quickReply.items[0].action;
  assert.equal(reduceLineWorkflowEvent({
    event: {
      type: 'postback',
      source: {
        type: 'user'
      },
      postback: {
        data: action.data
      }
    },
    batch: {
      ...batch,
      revision: 4
    },
    templates
  }).command, 'stale');
});
test('group chat cannot enter private workflow conversation', () => {
  assert.equal(reduceLineWorkflowEvent({
    event: {
      type: 'message',
      source: {
        type: 'group'
      },
      message: {
        type: 'text',
        text: 'สร้างเอกสารด้วยใบกำกับภาษี'
      }
    },
    templates
  }).command, 'ignore');
});
