"use strict";

const {
  randomUUID
} = require('node:crypto');
const fail = (statusCode, message) => {
  throw Object.assign(new Error(message), {
    statusCode,
    code: 'LINE_WORKFLOW_STATE_ERROR'
  });
};
const key = s => JSON.stringify([s.channelId, s.conversationId, s.lineUserId]);
function transition(state, method, a) {
  state.batches ||= {};
  state.events ||= {};
  state.jobs ||= {};
  state.operations ||= {};
  const get = id => state.batches[id] || fail(404, 'ไม่พบรายการ');
  const owned = (id, actor) => {
    const b = get(id);
    if (b.source === 'assistant' ? !actor?.userId || b.ownerUserId !== actor.userId : !actor?.lineUserId || b.lineUserId !== actor.lineUserId || b.ownerUserId && b.ownerUserId !== actor.userId) fail(403, 'ไม่มีสิทธิ์เข้าถึงรายการ');
    return b;
  };
  const update = (b, p) => Object.assign(b, p, {
    revision: b.revision + 1
  });
  const queueNotice = b => {
    if (b.source === 'assistant') return;
    const id = b.id + ':notice:' + b.state;
    if (!state.jobs[id]) state.jobs[id] = {
      id,
      batchId: b.id,
      status: 'queued',
      kind: 'notice',
      batchState: b.state,
      retryKey: randomUUID(),
      leaseUntil: 0,
      retryAt: 0
    };
  };
  const lease = () => {
    const j = state.jobs[a.jobId];
    if (!j || j.status !== 'running' || j.leaseToken !== a.leaseToken || j.leaseUntil <= (a.now ?? Date.now())) fail(409, 'Worker lease expired');
    return j;
  };
  switch (method) {
    case 'getForActor':
      return owned(a.id, a.actor);
    case 'get':
      return get(a.id);
    case 'findActive':
      return Object.values(state.batches).find(b => key(b) === key(a.scope) && !['cancelled', 'completed', 'manual'].includes(b.state)) || null;
    case 'findByTransaction':
      return Object.values(state.batches).find(b => b.transactionNo === a.transactionNo) || null;
    case 'findAssistantImport':
      return Object.values(state.batches).find(b => b.source === 'assistant' && b.ownerUserId === a.actor.userId && b.importRequestId === a.requestId) || null;
    case 'beginAssistantImport':
      {
        const old = transition(state, 'findAssistantImport', a);
        if (old) {
          if (old.importDigest !== a.digest) fail(409, 'รหัสนำเข้านี้ใช้กับข้อมูลอื่นแล้ว กรุณาเริ่มรายการใหม่');
          return old;
        }
        const b = {
          id: randomUUID(),
          source: 'assistant',
          channelId: 'assistant',
          conversationId: a.requestId,
          lineUserId: 'assistant:' + a.actor.userId,
          ownerUserId: a.actor.userId,
          importRequestId: a.requestId,
          importDigest: a.digest,
          templateSnapshot: a.template,
          state: 'collecting',
          revision: 1,
          evidenceIds: [],
          steps: [],
          createdAt: new Date().toISOString()
        };
        state.batches[b.id] = b;
        return b;
      }
    case 'begin':
      {
        if (!a.scope?.channelId || !a.scope.lineUserId || !a.scope.conversationId) fail(400, 'Missing scope');
        const old = transition(state, 'findActive', a);
        if (old) return old;
        const b = {
          id: randomUUID(),
          ...a.scope,
          state: 'selecting',
          revision: 1,
          ownerUserId: '',
          evidenceIds: [],
          steps: [],
          createdAt: new Date().toISOString()
        };
        state.batches[b.id] = b;
        return b;
      }
    case 'update':
      {
        const b = get(a.id);
        if (b.revision !== a.expectedRevision) fail(409, 'ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่');
        if (b.confirmedRevision !== undefined) fail(409, 'ยืนยันรายการแล้ว');
        const allowed = ['state', 'templateChoices', 'templateSnapshot', 'evidenceIds', 'primaryEvidenceId', 'extractedContext', 'reviewedContext', 'error'];
        if (Object.keys(a.patch).some(k => !allowed.includes(k))) fail(400, 'Invalid field');
        return update(b, a.patch);
      }
    case 'appendEvidence':
      {
        const b = get(a.id);
        if (b.state !== 'collecting') fail(409, 'ส่งไฟล์ครบแล้ว กรุณาเริ่มรายการใหม่');
        b.evidenceHashes ||= [];
        if (b.evidenceHashes.includes(a.hash)) return b;
        if (b.evidenceIds.length >= a.maxFiles) fail(400, 'เกินจำนวนไฟล์ที่รับได้');
        return update(b, {
          evidenceIds: [...b.evidenceIds, a.evidenceId],
          evidenceHashes: [...b.evidenceHashes, a.hash],
          primaryEvidenceId: b.primaryEvidenceId || a.evidenceId
        });
      }
    case 'queueScan':
      {
        const b = get(a.id);
        if (b.state !== 'collecting' || !b.evidenceIds.length) fail(409, 'ไม่มีไฟล์รออ่าน');
        const id = randomUUID();
        state.jobs[id] = {
          id,
          batchId: b.id,
          status: 'queued',
          kind: 'scan',
          primaryEvidenceId: b.primaryEvidenceId,
          leaseUntil: 0,
          retryAt: 0
        };
        return update(b, {
          state: 'scanning',
          jobId: id
        });
      }
    case 'nextJob':
      return Object.values(state.jobs).find(j => j.status === 'queued' && j.retryAt <= Date.now() || j.status === 'running' && j.leaseUntil <= Date.now()) || null;
    case 'confirm':
      {
        const b = owned(a.id, a.actor);
        if (!['manual', 'automatic'].includes(a.mode)) fail(400, 'Invalid mode');
        if (b.confirmedRevision !== undefined) {
          if (b.confirmedRevision !== a.expectedRevision || b.mode !== a.mode) fail(409, 'รายการนี้ถูกยืนยันแล้ว');
          return {
            batch: b,
            jobId: b.jobId,
            idempotent: true
          };
        }
        if (b.state !== 'ready' || b.revision !== a.expectedRevision) fail(409, 'กรุณาตรวจสอบข้อมูลล่าสุด');
        const id = randomUUID();
        update(b, {
          confirmedRevision: a.expectedRevision,
          confirmedContext: a.context,
          mode: a.mode,
          ownerUserId: a.actor.userId,
          state: 'running',
          jobId: id
        });
        state.jobs[id] = {
          id,
          batchId: b.id,
          status: 'queued',
          leaseUntil: 0,
          retryAt: 0
        };
        return {
          batch: b,
          jobId: id,
          idempotent: false
        };
      }
    case 'acceptEvent':
      {
        const k = key(a.scope) + ':' + a.eventId;
        const old = state.events[k] || Object.values(state.events).find(e => e.scope === key(a.scope) && a.messageId && e.messageId === a.messageId);
        if (old && old.status !== 'retryable' && !(old.status === 'pending' && old.at + 60000 < Date.now())) return {
          accepted: false
        };
        state.events[k] = {
          scope: key(a.scope),
          messageId: a.messageId,
          status: 'pending',
          at: Date.now()
        };
        return {
          accepted: true
        };
      }
    case 'finishEvent':
      {
        const e = state.events[key(a.scope) + ':' + a.eventId];
        if (e) e.status = a.status;
        return true;
      }
    case 'claimJob':
      {
        const now = a.now ?? Date.now();
        const j = Object.values(state.jobs).find(j => (!a.batchId || j.batchId === a.batchId) && (!a.kind || (j.kind || 'execute') === a.kind) && (j.status === 'queued' && j.retryAt <= now || j.status === 'running' && j.leaseUntil <= now));
        if (!j) return null;
        Object.assign(j, {
          status: 'running',
          leaseToken: randomUUID(),
          leaseUntil: now + (a.leaseMs || 120000)
        });
        return {
          ...j,
          batch: get(j.batchId)
        };
      }
    case 'renew':
      {
        const j = lease();
        j.leaseUntil = (a.now ?? Date.now()) + (a.leaseMs || 120000);
        return true;
      }
    case 'checkpoint':
      {
        lease();
        const k = a.jobId + ':' + a.operationKey;
        const old = state.operations[k];
        if (old && JSON.stringify(old) !== JSON.stringify(a.result)) fail(409, 'Operation already reserved');
        return state.operations[k] = a.result;
      }
    case 'getCheckpoint':
      return state.operations[a.jobId + ':' + a.operationKey] || null;
    case 'progress':
      {
        const j = lease();
        return update(get(j.batchId), a.patch);
      }
    case 'finishJob':
      {
        const j = lease();
        j.status = 'completed';
        const b = get(j.batchId);
        if (j.kind === 'scan' && (b.state !== 'scanning' || b.jobId !== j.id || b.state === 'cancelled' || b.confirmedRevision !== undefined || b.extractedContext || j.primaryEvidenceId !== b.primaryEvidenceId)) return b;
        const result = update(b, a.result);
        if ((j.kind || 'execute') === 'execute') queueNotice(result);
        return result;
      }
    case 'failJob':
      {
        const j = lease();
        const b = get(j.batchId);
        if (j.kind === 'notice') {
          Object.assign(j, {
            status: 'queued',
            retryAt: a.retryAt || Date.now() + 60000
          });
          return b;
        }
        if (j.kind === 'scan' && (b.state !== 'scanning' || b.jobId !== j.id || b.state === 'cancelled' || b.confirmedRevision !== undefined || b.extractedContext || j.primaryEvidenceId !== b.primaryEvidenceId)) {
          j.status = 'completed';
          return b;
        }
        Object.assign(j, {
          status: a.retryAt ? 'queued' : 'paused',
          retryAt: a.retryAt || 0
        });
        const result = update(get(j.batchId), {
          state: 'paused',
          error: String(a.error)
        });
        if ((j.kind || 'execute') === 'execute') queueNotice(result);
        return result;
      }
    case 'resume':
      {
        const b = owned(a.id, a.actor);
        if (b.state !== 'paused') fail(409, 'รายการไม่อยู่ในสถานะทำต่อ');
        state.jobs[b.jobId].status = 'queued';
        return update(b, {
          state: state.jobs[b.jobId].kind === 'scan' ? 'scanning' : 'running',
          error: ''
        });
      }
    default:
      fail(400, 'Invalid operation');
  }
}
function bindStore(invoke) {
  const store = {};
  for (const method of ['get', 'queueScan', 'nextJob', 'appendEvidence', 'findActive', 'findByTransaction', 'findAssistantImport', 'beginAssistantImport', 'begin', 'update', 'confirm', 'acceptEvent', 'finishEvent', 'claimJob', 'checkpoint', 'renew', 'progress', 'finishJob', 'failJob', 'resume']) store[method] = a => invoke(method, a);
  store.get = id => invoke('get', typeof id === 'string' ? {
    id
  } : id);
  store.getForActor = (id, actor) => invoke('getForActor', {
    id,
    actor
  });
  store.getCheckpoint = (jobId, operationKey) => invoke('getCheckpoint', {
    jobId,
    operationKey
  });
  return store;
}
module.exports = {
  transition,
  bindStore
};
