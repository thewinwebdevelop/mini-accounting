import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLineWorkflowController } from '../forms/line-workflow-controller.logic.js';
import { createLocalLineIntakeStore } from '../forms/line-intake.logic.js';
const png = 'iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAIAAAADnC86AAAATElEQVR4nO3NsQHAMAzDMIf//+yu0QPMUOEBnN2dF3iyTmMRZnZrrMGrUmMNXpUaa/Cq1FiDV6XGGrwqNdbgVamxBq9KjTV41fw8/gCD6wNNCJl4CAAAAABJRU5ErkJggg==';
const actor = {
  userId: 'app1',
  role: 'owner'
};
function fixture(t) {
  const rootDir = mkdtempSync(join(tmpdir(), 'assistant-invoice-'));
  let scans = 0;
  const catalog = [{
    templateId: "existing",
    active: true,
    name: "Existing",
    documentSteps: []
  }];
  const c = createLineWorkflowController({
    rootDir,
    env: {
      LINE_WORKFLOW_ENABLED: '1'
    },
    intakeStore: createLocalLineIntakeStore({
      rootDir
    }),
    templates: async () => catalog,
    scan: async () => {
      scans++;
      throw Error('OCR must not run');
    }
  });
  t.after(() => {
    c.store.close();
    rmSync(rootDir, {
      recursive: true,
      force: true
    });
  });
  return {
    c,
    catalog,
    scans: () => scans
  };
}
const body = () => ({
  requestId: '6702fb75-76f7-480e-9379-a630ef57919c',
  templateId: 'existing',
  extraction: {
    fields: {
      vendorName: 'Read by assistant',
      documentNo: 'INV-1'
    },
    lines: [{
      description: 'Paper',
      quantity: '1',
      unitCost: '100',
      amountBeforeVat: '100',
      vatAmount: '7',
      withholdingTax: '0'
    }]
  },
  files: [{
    name: 'invoice.png',
    dataBase64: png
  }]
});
test('assistant import persists private review without LINE identity, OCR, confirmation or duplicate batch', async t => {
  const {
    c,
    scans
  } = fixture(t);
  const input = body();
  const first = await c.importAssistant({
    body: input,
    actor
  });
  assert.equal(first.batch.state, 'needs_review');
  assert.equal(first.edits.vendorName, 'Read by assistant');
  assert.equal(first.batch.confirmedRevision, undefined);
  assert.equal(first.batch.transactionNo, undefined);
  const again = await c.importAssistant({
    body: input,
    actor
  });
  assert.equal(again.batch.id, first.batch.id);
  assert.equal(again.files.length, 1);
  assert.equal((await c.api({
    id: first.batch.id,
    method: 'GET',
    actor
  })).edits.documentNo, 'INV-1');
  assert.equal(scans(), 0);
  await assert.rejects(() => c.api({
    id: first.batch.id,
    method: 'GET',
    actor: {
      ...actor,
      userId: 'other'
    }
  }), {
    statusCode: 403
  });
  await assert.rejects(() => c.importAssistant({
    body: {
      ...input,
      extraction: {
        fields: {
          vendorName: 'Changed'
        }
      }
    },
    actor
  }), {
    statusCode: 409
  });
  await c.api({
    id: first.batch.id,
    action: 'primary',
    method: 'POST',
    body: {
      expectedRevision: again.batch.revision,
      primaryEvidenceId: again.files[0].id
    },
    actor
  });
  assert.equal(scans(), 0);
});
test('assistant import rejects missing actor, unknown workflow and corrupt evidence before creating batch', async t => {
  const {
    c
  } = fixture(t);
  await assert.rejects(() => c.importAssistant({
    body: body(),
    actor: {
      role: 'owner'
    }
  }), {
    statusCode: 403
  });
  await assert.rejects(() => c.importAssistant({
    body: {
      ...body(),
      templateId: 'missing'
    },
    actor
  }), {
    statusCode: 400
  });
  await assert.rejects(() => c.importAssistant({
    body: {
      ...body(),
      files: [{
        name: 'bad.pdf',
        dataBase64: Buffer.from('garbage').toString('base64')
      }]
    },
    actor
  }), {
    statusCode: 400
  });
  assert.equal(c.store.findActive({
    scope: {
      channelId: 'assistant',
      conversationId: body().requestId,
      lineUserId: 'assistant:app1'
    }
  }), null);
});
test('assistant retry returns same batch after workflow is removed', async t => {
  const {
    c,
    catalog
  } = fixture(t);
  const input = body();
  const first = await c.importAssistant({
    body: input,
    actor
  });
  catalog.length = 0;
  assert.equal((await c.importAssistant({
    body: input,
    actor
  })).batch.id, first.batch.id);
});
test('assistant import rejects a combined upload that is too large for the JSON transport', async t => {
  const {
    c
  } = fixture(t);
  const input = {
    ...body(),
    files: [{
      name: 'large.png',
      dataBase64: Buffer.alloc(21 * 1024 * 1024).toString('base64')
    }]
  };
  await assert.rejects(() => c.importAssistant({
    body: input,
    actor
  }), /รวมไม่เกิน 20 MiB/);
});
