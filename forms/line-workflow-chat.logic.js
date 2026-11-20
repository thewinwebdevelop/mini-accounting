"use strict";

const PREFIX = 'invoice-workflow:';
function button(label, data) {
  return {
    type: 'action',
    action: {
      type: 'postback',
      label: Array.from(label).slice(0, 20).join(''),
      data: PREFIX + JSON.stringify(data)
    }
  };
}
function buildWorkflowChoices({
  batch,
  page = 0
}) {
  const choices = batch.templateChoices || [];
  const pages = Math.max(1, Math.ceil(choices.length / 10));
  page = Math.max(0, Math.min(pages - 1, Number.isInteger(page) ? page : 0));
  const rows = choices.slice(page * 10, page * 10 + 10);
  const base = {
    id: batch.id,
    revision: batch.revision
  };
  const items = rows.map((t, i) => button(`${page * 10 + i + 1}. ${t.name}`, {
    ...base,
    action: 'select',
    templateId: t.templateId
  }));
  if (page > 0) items.push(button('ก่อนหน้า', {
    ...base,
    action: 'page',
    page: page - 1
  }));
  if (page < pages - 1) items.push(button('ถัดไป', {
    ...base,
    action: 'page',
    page: page + 1
  }));
  items.push(button('ยกเลิก', {
    ...base,
    action: 'cancel'
  }));
  return {
    type: 'text',
    text: rows.length ? 'เลือก workflow โดยกดปุ่มหรือพิมพ์หมายเลข\n' + rows.map((t, i) => `${page * 10 + i + 1}. ${t.name}`).join('\n') : 'ไม่มี workflow ที่เปิดใช้งาน',
    quickReply: {
      items
    }
  };
}
function reduceLineWorkflowEvent({
  event,
  batch,
  templates = []
}) {
  if (event.source?.type && event.source.type !== 'user') return {
    command: 'ignore'
  };
  const text = event.type === 'message' && event.message?.type === 'text' ? String(event.message.text || '').trim() : '';
  if (text === 'สร้างเอกสารด้วยใบกำกับภาษี') return {
    command: 'start',
    patch: {
      templateChoices: templates.filter(t => t.active !== false),
      state: 'selecting'
    }
  };
  let action;
  if (event.type === 'postback' && String(event.postback?.data || '').startsWith(PREFIX)) {
    try {
      action = JSON.parse(event.postback.data.slice(PREFIX.length));
    } catch {
      return {
        command: 'ignore'
      };
    }
    if (!batch || action.id !== batch.id || action.revision !== batch.revision) return {
      command: 'stale'
    };
  }
  if (!batch) return {
    command: event.message?.type === 'image' || event.message?.type === 'file' ? 'legacy' : 'ignore'
  };
  if (action?.action === 'cancel' || text === 'ยกเลิก') return {
    command: 'cancel',
    patch: {
      state: 'cancelled'
    }
  };
  if (action?.action === 'page' && batch.state === 'selecting') return {
    command: 'page',
    reply: buildWorkflowChoices({
      batch,
      page: action.page
    })
  };
  if (batch.state === 'selecting') {
    const choice = action?.action === 'select' ? (batch.templateChoices || []).find(t => t.templateId === action.templateId) : /^\d+$/.test(text) ? batch.templateChoices?.[Number(text) - 1] : null;
    if (choice) {
      const current = templates.find(t => t.templateId === choice.templateId && t.active !== false);
      if (!current || JSON.stringify(current) !== JSON.stringify(choice)) return {
        command: 'stale'
      };
      return {
        command: 'select',
        patch: {
          templateSnapshot: choice,
          state: 'collecting'
        }
      };
    }
  }
  if (batch.state === 'collecting' && (action?.action === 'finish' || text === 'ส่งครบแล้ว')) return batch.evidenceIds?.length ? {
    command: 'finish',
    patch: {
      state: 'scanning'
    }
  } : {
    command: 'empty'
  };
  if (batch.state === 'collecting' && ['image', 'file'].includes(event.message?.type)) return {
    command: 'attach'
  };
  if (text === 'ทำรายการเดิมต่อ' || action?.action === 'resume') return {
    command: 'resume'
  };
  return {
    command: 'ignore'
  };
}
module.exports = {
  buildWorkflowChoices,
  reduceLineWorkflowEvent
};
