"use strict";

const {
  createLineWorkflowStore
} = require('./line-workflow-store.logic.js');
const {
  reduceLineWorkflowEvent,
  buildWorkflowChoices
} = require('./line-workflow-chat.logic.js');
const {
  normalizeInvoiceExtraction,
  buildReviewedWorkflowContext,
  validateReviewedWorkflowContext
} = require('./line-workflow-review.logic.js');
const {
  executeLineWorkflowBatch
} = require('./line-workflow-execution.logic.js');
const {
  ACTIONS,
  assertPermission
} = require('./authorization.logic.js');
const {
  spawn
} = require('node:child_process');
const {
  homedir
} = require('node:os');
const path = require('node:path');
const {
  createHash
} = require('node:crypto');
const fail = (statusCode, message) => {
  throw Object.assign(new Error(message), {
    statusCode
  });
};
async function inspectMedia(bytes, contentType, maxPages) {
  const pdf = bytes.subarray(0, 5).toString() === '%PDF-';
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!pdf && !png && !jpeg) fail(400, 'รองรับไฟล์ PDF, PNG และ JPEG ที่อ่านได้เท่านั้น');
  const python = process.env.SWEET_HOUSE_PYTHON_BIN || process.env.SWEET_HOUSE_PYTHON || path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3');
  const code = pdf ? 'import sys,io\nfrom pypdf import PdfReader\nr=PdfReader(io.BytesIO(sys.stdin.buffer.read()))\nassert not r.is_encrypted,"Encrypted PDF"\nprint(len(r.pages))' : 'import sys,io\nfrom PIL import Image\nImage.MAX_IMAGE_PIXELS=40000000\ni=Image.open(io.BytesIO(sys.stdin.buffer.read()))\ni.verify()\nprint(1)';
  try {
    const count = await new Promise((resolve, reject) => {
      const child = spawn(python, ['-c', code], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      let out = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('Inspection timed out'));
      }, 15000);
      child.stdout.on('data', x => {
        out += x;
      });
      child.stderr.resume();
      child.on('error', e => {
        clearTimeout(timer);
        reject(e);
      });
      child.stdin.on('error', () => {});
      child.on('close', exit => {
        clearTimeout(timer);
        exit === 0 ? resolve(Number(out.trim())) : reject(new Error('Invalid media'));
      });
      child.stdin.end(bytes);
    });
    if (!count || count > maxPages) fail(400, 'PDF เกินจำนวนหน้าที่รับได้');
  } catch (e) {
    fail(400, e.statusCode ? e.message : 'ไฟล์เสียหาย มีรหัสผ่าน หรืออ่านไม่ได้');
  }
  return pdf ? 'application/pdf' : png ? 'image/png' : 'image/jpeg';
}
function createLineWorkflowController(o) {
  const {
    rootDir,
    env,
    intakeStore,
    templates,
    scan,
    download,
    reply,
    mediaEvent,
    nativeFactory
  } = o;
  const store = createLineWorkflowStore({
    rootDir,
    env
  });
  const enabled = env.LINE_WORKFLOW_ENABLED === '1';
  let mediaGate = Promise.resolve();
  const maxFiles = Number(env.LINE_WORKFLOW_MAX_FILES || 20),
    maxPages = Number(env.LINE_WORKFLOW_MAX_PDF_PAGES || 100);
  const scopeOf = e => ({
    channelId: String(env.LINE_CHANNEL_ID || 'oa'),
    conversationId: e.source.userId,
    lineUserId: e.source.userId
  });
  const reviewUrl = id => {
    const url = new URL('/line-workflow-review', env.APP_PUBLIC_ORIGIN || env.LINE_INTAKE_MINI_APP_URL || 'https://localhost');
    url.searchParams.set('batchId', id);
    return url.toString();
  };
  const collect = b => ({
    type: 'text',
    text: `${b.templateSnapshot?.name || ''}\nรับแล้ว ${b.evidenceIds.length} ไฟล์ (สูงสุด ${maxFiles} ไฟล์, 20 MiB/ไฟล์, PDF ${maxPages} หน้า)\nส่งใบกำกับภาษีและหลักฐาน แล้วกดส่งครบแล้ว`,
    quickReply: {
      items: [{
        type: 'action',
        action: {
          type: 'camera',
          label: 'ถ่ายรูป'
        }
      }, {
        type: 'action',
        action: {
          type: 'cameraRoll',
          label: 'เลือกรูป'
        }
      }, ...['ส่งครบแล้ว', 'ยกเลิก'].map(text => ({
        type: 'action',
        action: {
          type: 'message',
          label: text,
          text
        }
      }))]
    }
  });
  const reviewReply = b => ({
    type: 'text',
    text: 'รับไฟล์ครบแล้ว เปิดฟอร์มเพื่อตรวจและแก้ไขข้อมูลก่อนสร้างเอกสาร',
    quickReply: {
      items: [{
        type: 'action',
        action: {
          type: 'uri',
          label: 'ตรวจสอบข้อมูล',
          uri: reviewUrl(b.id)
        }
      }]
    }
  });
  async function chat(event) {
    if (!enabled || event.source?.type === 'group' || event.source?.type === 'room' || !event.source?.userId) return null;
    const scope = scopeOf(event);
    let b = await store.findActive({
      scope
    });
    const list = await templates();
    let action = reduceLineWorkflowEvent({
      event,
      batch: b,
      templates: list
    });
    if (['ignore', 'legacy'].includes(action.command)) return null;
    const eventId = event.webhookEventId || event.message?.id;
    if (!eventId) fail(400, 'Missing event identity');
    const claim = await store.acceptEvent({
      scope,
      eventId,
      messageId: event.message?.id
    });
    if (!claim.accepted) return {
      duplicate: true,
      batchId: b?.id
    };
    try {
      let message;
      if (action.command === 'start') {
        if (b && b.confirmedRevision !== undefined) message = reviewReply(b);else {
          b = b || (await store.begin({
            scope,
            eventId
          }));
          b = await store.update({
            id: b.id,
            expectedRevision: b.revision,
            patch: action.patch
          });
          message = buildWorkflowChoices({
            batch: b
          });
        }
      } else if (action.command === 'select') {
        b = await store.update({
          id: b.id,
          expectedRevision: b.revision,
          patch: action.patch
        });
        message = collect(b);
      } else if (action.command === 'attach') {
        if (b.evidenceIds.length >= maxFiles) fail(400, 'เกินจำนวนไฟล์ที่รับได้');
        const media = mediaEvent(event);
        if (!media) fail(400, 'รองรับรูปหรือ PDF เท่านั้น');
        const content = await download(media.messageId);
        const contentType = await inspectMedia(content.bytes, content.contentType, maxPages);
        const previous = mediaGate;
        let release;
        mediaGate = new Promise(resolve => {
          release = resolve;
        });
        await previous;
        try {
          const stored = await intakeStore.create({
            ...media,
            contentType,
            bytes: content.bytes
          });
          b = await store.appendEvidence({
            id: b.id,
            evidenceId: stored.item.id,
            hash: stored.item.sha256,
            maxFiles
          });
        } finally {
          release();
        }
        message = collect(b);
      } else if (action.command === 'finish') {
        b = await store.queueScan({
          id: b.id
        });
        message = reviewReply(b);
      } else if (action.command === 'cancel') {
        b = await store.update({
          id: b.id,
          expectedRevision: b.revision,
          patch: action.patch
        });
        message = {
          type: 'text',
          text: 'ยกเลิกรายการแล้ว'
        };
      } else if (action.command === 'page') message = action.reply;else if (action.command === 'resume') message = b.state === 'selecting' ? buildWorkflowChoices({
        batch: b
      }) : b.state === 'collecting' ? collect(b) : reviewReply(b);else message = {
        type: 'text',
        text: action.command === 'empty' ? 'กรุณาส่งใบกำกับภาษีก่อน' : 'ตัวเลือกหมดอายุ กรุณาเริ่มเลือก workflow ใหม่'
      };
      await store.finishEvent({
        scope,
        eventId,
        status: 'completed'
      });
      if (event.replyToken) try {
        await reply(event.replyToken, [message]);
      } catch (e) {
        console.warn('[line-workflow] reply failed', e.code || 'LINE_REPLY_FAILED');
      }
      return {
        batchId: b?.id,
        command: action.command
      };
    } catch (e) {
      await store.finishEvent({
        scope,
        eventId,
        status: 'retryable'
      });
      if (event.replyToken) try {
        await reply(event.replyToken, [{
          type: 'text',
          text: e.message
        }]);
      } catch {}
      throw e;
    }
  }
  // Authenticated imports use app ownership; their synthetic storage scope is never a LINE recipient.
  async function importAssistant({
    body,
    actor
  }) {
    if (!enabled) fail(404, 'Feature disabled');
    assertPermission(actor, ACTIONS.DOCUMENT_CREATE);
    if (!actor?.userId) fail(403, 'กรุณาเข้าสู่ระบบ');
    if (!/^[a-f0-9-]{36}$/i.test(body.requestId || '')) fail(400, 'ต้องระบุ requestId แบบ UUID');
    if (!body.extraction || typeof body.extraction !== 'object' || Array.isArray(body.extraction)) fail(400, 'กรุณาแนบข้อมูลที่ผู้ช่วยอ่านจากใบกำกับภาษี');
    if (!Array.isArray(body.files) || !body.files.length || body.files.length > maxFiles) fail(400, 'กรุณาแนบไฟล์ต้นฉบับตามจำนวนที่ระบบรองรับ');
    if (Buffer.byteLength(JSON.stringify(body.extraction)) > 2 * 1024 * 1024) fail(400, 'ข้อมูล JSON ต้องไม่เกิน 2 MiB');
    if (body.extraction.lines && (!Array.isArray(body.extraction.lines) || body.extraction.lines.length > 1000)) fail(400, 'รองรับไม่เกิน 1000 รายการ');
    const extracted = normalizeInvoiceExtraction(body.extraction);
    const files = [];
    let total = 0;
    for (const file of body.files) {
      if (typeof file.dataBase64 !== 'string') fail(400, 'ข้อมูลไฟล์ไม่ถูกต้อง');
      if (file.dataBase64.length > Math.ceil(20 * 1024 * 1024 / 3) * 4) fail(400, 'ไฟล์เกินขนาดที่รองรับ (รวมไม่เกิน 20 MiB)');
      if (file.dataBase64.length % 4 || /[^A-Za-z0-9+/=]/.test(file.dataBase64)) fail(400, 'ข้อมูลไฟล์ไม่ถูกต้อง');
      const bytes = Buffer.from(file.dataBase64, 'base64');
      if (bytes.toString('base64') !== file.dataBase64) fail(400, 'ข้อมูลไฟล์ไม่ถูกต้อง');
      total += bytes.length;
      if (!bytes.length || bytes.length > Number(env.LINE_INTAKE_MAX_BYTES || 20 * 1024 * 1024) || total > 20 * 1024 * 1024) fail(400, 'ไฟล์เกินขนาดที่รองรับ (รวมไม่เกิน 20 MiB)');
      const contentType = await inspectMedia(bytes, '', maxPages);
      files.push({
        bytes,
        contentType,
        name: path.basename(String(file.name || 'invoice')),
        hash: createHash('sha256').update(bytes).digest('hex')
      });
    }
    const digest = createHash('sha256').update(JSON.stringify({
      templateId: body.templateId,
      extracted,
      files: files.map(f => [f.name, f.hash])
    })).digest('hex');
    const existing = await store.findAssistantImport({
      actor,
      requestId: body.requestId
    });
    const template = existing?.templateSnapshot || (await templates()).find(t => t.templateId === body.templateId && t.active !== false);
    if (!template) fail(400, 'กรุณาเลือก workflow ที่เปิดใช้งานในระบบ');
    let b = await store.beginAssistantImport({
      actor,
      requestId: body.requestId,
      digest,
      template
    });
    if (b.state !== 'collecting') return view(b.id, actor);
    // Share the intake file lock with LINE so local metadata writes cannot replace each other.
    const previous = mediaGate;
    let release;
    mediaGate = new Promise(resolve => {
      release = resolve;
    });
    await previous;
    try {
      b = await store.get(b.id);
      if (b.state !== 'collecting') return view(b.id, actor);
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const stored = await intakeStore.create({
          eventId: `assistant:${b.id}:${i}`,
          messageId: `assistant:${b.id}:${i}`,
          lineUserId: b.lineUserId,
          mediaKind: f.contentType === 'application/pdf' ? 'file' : 'image',
          originalName: f.name,
          contentType: f.contentType,
          bytes: f.bytes
        });
        b = await store.appendEvidence({
          id: b.id,
          evidenceId: stored.item.id,
          hash: f.hash,
          maxFiles
        });
      }
      await store.update({
        id: b.id,
        expectedRevision: b.revision,
        patch: {
          state: 'needs_review',
          extractedContext: extracted
        }
      });
    } finally {
      release();
    }
    return view(b.id, actor);
  }
  async function view(id, actor) {
    let b = await store.getForActor(id, actor);
    const files = [];
    for (const evidenceId of b.evidenceIds) {
      const i = await intakeStore.getForUser(evidenceId, b.lineUserId);
      files.push({
        id: i.id,
        name: i.originalName,
        type: i.contentType,
        url: `/api/line-workflow-batches/${id}/evidence/${i.id}`
      });
    }
    if (b.source !== 'assistant' && b.confirmedRevision === undefined && b.primaryEvidenceId && !b.extractedContext) {
      const item = await intakeStore.getForUser(b.primaryEvidenceId, b.lineUserId);
      const f = await intakeStore.readOriginal(item);
      let result;
      try {
        result = await scan(f);
      } catch (e) {
        result = {
          fields: {},
          warnings: [e.message]
        };
      }
      const extracted = normalizeInvoiceExtraction(result);
      b = await store.update({
        id: b.id,
        expectedRevision: b.revision,
        patch: {
          extractedContext: extracted,
          state: 'needs_review'
        }
      });
    }
    return {
      batch: b,
      files,
      edits: b.reviewedContext || {
        ...b.extractedContext?.fields,
        lines: b.extractedContext?.lines || []
      },
      workflowUrl: b.transactionNo ? `/workflow-transaction?transactionNo=${encodeURIComponent(b.transactionNo)}` : '',
      canAutomatic: ['owner', 'accounting', 'admin'].includes(actor.role)
    };
  }
  async function api({
    id,
    action,
    method,
    body = {},
    actor,
    evidenceId
  }) {
    if (!enabled) fail(404, 'Feature disabled');
    assertPermission(actor, ACTIONS.DOCUMENT_READ);
    let b = await store.getForActor(id, actor);
    if (evidenceId) {
      if (!b.evidenceIds.includes(evidenceId)) fail(403, 'ไม่มีสิทธิ์เข้าถึงไฟล์');
      const item = await intakeStore.getForUser(evidenceId, b.lineUserId);
      return {
        original: await intakeStore.readOriginal(item)
      };
    }
    if (method === 'GET') return view(id, actor);
    if (action === 'primary') {
      if (!b.evidenceIds.includes(body.primaryEvidenceId)) fail(400, 'เลือกใบกำกับภาษีหลัก');
      if (body.primaryEvidenceId === b.primaryEvidenceId) return view(id, actor);
      await store.update({
        id,
        expectedRevision: body.expectedRevision,
        patch: {
          primaryEvidenceId: body.primaryEvidenceId,
          extractedContext: b.source === 'assistant' ? normalizeInvoiceExtraction({
            warnings: ['เปลี่ยนใบกำกับภาษีหลักแล้ว กรุณากรอกข้อมูลใหม่ หรือให้ผู้ช่วยอ่านและนำเข้าเป็นรายการใหม่']
          }) : null,
          reviewedContext: null,
          state: 'needs_review'
        }
      });
      return view(id, actor);
    }
    if (action === 'review') {
      if (body.primaryEvidenceId && body.primaryEvidenceId !== b.primaryEvidenceId) fail(409, 'กรุณาเลือกและอ่านใบกำกับภาษีหลักใหม่ก่อน');
      if (!b.evidenceIds.includes(body.primaryEvidenceId || b.primaryEvidenceId)) fail(400, 'เลือกใบกำกับภาษีหลัก');
      const edits = normalizeInvoiceExtraction({
        fields: body.edits,
        lines: body.edits?.lines
      });
      return {
        batch: await store.update({
          id,
          expectedRevision: body.expectedRevision,
          patch: {
            reviewedContext: {
              ...edits.fields,
              lines: edits.lines
            },
            primaryEvidenceId: body.primaryEvidenceId || b.primaryEvidenceId,
            state: 'ready'
          }
        })
      };
    }
    if (action === 'confirm') {
      assertPermission(actor, ACTIONS.DOCUMENT_CREATE);
      if (body.mode === 'automatic') {
        for (const permission of [ACTIONS.DOCUMENT_SUBMIT, ACTIONS.DOCUMENT_APPROVE, ACTIONS.DOCUMENT_COMPLETE]) assertPermission(actor, permission);
        if (b.templateSnapshot.documentSteps.some(s => s.receiptType === 'stock_purchase')) assertPermission(actor, ACTIONS.STOCK_RECEIVE);
      }
      if (b.confirmedRevision === undefined) {
        const current = (await templates()).find(t => t.templateId === b.templateSnapshot.templateId);
        if (!current || current.active === false || JSON.stringify(current) !== JSON.stringify(b.templateSnapshot)) fail(409, 'Workflow เปลี่ยนแล้ว กรุณาเริ่มรายการใหม่');
        const context = buildReviewedWorkflowContext({
          edits: b.reviewedContext || {}
        });
        const validation = validateReviewedWorkflowContext({
          context,
          template: b.templateSnapshot,
          mode: body.mode
        });
        if (validation.errors.length) fail(400, validation.errors.join('\n'));
        await o.validateStock(context.lines);
        return store.confirm({
          id,
          expectedRevision: body.expectedRevision,
          mode: body.mode,
          context,
          actor
        });
      }
      return store.confirm({
        id,
        expectedRevision: body.expectedRevision,
        mode: body.mode,
        context: b.confirmedContext,
        actor
      });
    }
    if (action === 'run') {
      await executeLineWorkflowBatch({
        batchId: id,
        store,
        native: nativeFactory({
          actor,
          store
        })
      });
      await notify(id);
      return view(id, actor);
    }
    if (action === 'resume') {
      await store.resume({
        id,
        actor
      });
      return view(id, actor);
    }
    fail(404, 'ไม่พบคำสั่ง');
  }
  async function notify(batchId) {
    if (!o.push) return {
      idle: true
    };
    const job = await store.claimJob({
      batchId,
      kind: 'notice',
      workerId: 'notice',
      leaseMs: 60000
    });
    if (!job) return {
      idle: true
    };
    const lease = {
      jobId: job.id,
      leaseToken: job.leaseToken
    };
    const batch = await store.get(batchId);
    try {
      if (batch.state === job.batchState) {
        const text = batch.state === 'completed' ? 'สร้างและ Complete เอกสารครบทุกขั้นตอนแล้ว' : batch.state === 'manual' ? 'สร้างเอกสารขั้นตอนแรกแล้ว พร้อมให้คุณดำเนินการเอง' : 'มีขั้นตอนที่ต้องตรวจสอบ เปิดรายการเพื่อทำต่อ';
        await o.push({
          to: batch.lineUserId,
          retryKey: job.retryKey,
          messages: [{
            type: 'text',
            text: text + '\n' + reviewUrl(batchId)
          }]
        });
      }
      await store.finishJob({
        ...lease,
        result: {
          notificationSent: true
        }
      });
      return {
        notified: true
      };
    } catch (error) {
      await store.failJob({
        ...lease,
        error: error.message,
        retryAt: Date.now() + 60000
      });
      return {
        notificationPending: true
      };
    }
  }
  async function work() {
    const pending = await store.nextJob({});
    if (!pending) return {
      idle: true
    };
    if (pending.kind === 'notice') return notify(pending.batchId);
    if (pending.kind === 'scan') {
      const job = await store.claimJob({
        kind: 'scan',
        batchId: pending.batchId,
        workerId: 'scan',
        leaseMs: 60000
      });
      if (!job) return {
        idle: true
      };
      const lease = {
        jobId: job.id,
        leaseToken: job.leaseToken
      };
      try {
        const b = await store.get(job.batchId);
        if (b.state === 'cancelled' || b.confirmedRevision !== undefined || b.extractedContext) {
          await store.finishJob({
            ...lease,
            result: {
              state: b.state
            }
          });
          return {
            processed: true
          };
        }
        const item = await intakeStore.getForUser(b.primaryEvidenceId, b.lineUserId);
        const f = await intakeStore.readOriginal(item);
        const result = await scan(f);
        await store.finishJob({
          ...lease,
          result: {
            state: 'needs_review',
            extractedContext: normalizeInvoiceExtraction(result)
          }
        });
        return {
          processed: true
        };
      } catch (error) {
        await store.failJob({
          ...lease,
          error: error.message
        });
        return {
          error: error.message
        };
      }
    }
    const batch = await store.get(pending.batchId);
    let actor;
    try {
      actor = await o.resolveActor(batch);
    } catch (error) {
      const job = await store.claimJob({
        batchId: batch.id,
        kind: 'execute',
        workerId: 'worker',
        leaseMs: 60000
      });
      if (job) await store.failJob({
        jobId: job.id,
        leaseToken: job.leaseToken,
        error: error.message
      });
      return {
        error: error.message
      };
    }
    if (!actor) throw new Error('ไม่พบบัญชีผู้ใช้สำหรับดำเนินการ');
    await executeLineWorkflowBatch({
      batchId: batch.id,
      store,
      native: nativeFactory({
        actor,
        store
      })
    });
    return {
      processed: true
    };
  }
  return {
    chat,
    importAssistant,
    api,
    work,
    store,
    enabled
  };
}
module.exports = {
  createLineWorkflowController,
  inspectMedia
};
