'use strict';

(async function () {
  const $ = selector => document.querySelector(selector);
  const pendingKey = 'assistantInvoicePendingRequest';
  function status(message, error = false) {
    $('#status').textContent = message;
    $('#status').dataset.error = String(error);
  }
  async function json(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options
    });
    if (response.status === 401) {
      location.assign('/line-auth?returnTo=' + encodeURIComponent(location.pathname));
      throw new Error('กรุณาเข้าสู่ระบบ');
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'นำเข้าไม่สำเร็จ');
    return result;
  }
  function base64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error('อ่านไฟล์ต้นฉบับไม่สำเร็จ'));
      reader.readAsDataURL(file);
    });
  }
  $('#evidence').onchange = () => {
    $('#file-order').replaceChildren();
    [...$('#evidence').files].forEach((file, i) => {
      const li = document.createElement('li');
      li.textContent = file.name + (i === 0 ? ' (ใบกำกับภาษีหลัก)' : '');
      $('#file-order').append(li);
    });
  };
  $('#import-form').onsubmit = async event => {
    event.preventDefault();
    $('#import').disabled = true;
    try {
      status('กำลังตรวจไฟล์และนำเข้าข้อมูล…');
      let extraction;
      try {
        if ($('#extraction').files[0].size > 2 * 1024 * 1024) throw new Error();
        extraction = JSON.parse(await $('#extraction').files[0].text());
      } catch {
        throw new Error('ไฟล์ข้อมูล JSON ไม่ถูกต้อง หรือเกิน 2 MiB');
      }
      const originals = [...$('#evidence').files];
      if (originals.reduce((n, f) => n + f.size, 0) > 20 * 1024 * 1024) throw new Error('ไฟล์ต้นฉบับรวมต้องไม่เกิน 20 MiB');
      const files = [];
      for (const file of originals) files.push({
        name: file.name,
        dataBase64: await base64(file)
      });
      const body = {
        templateId: $('#template').value,
        extraction,
        files
      };
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(body))))].map(n => n.toString(16).padStart(2, '0')).join('');
      let pending;
      try {
        pending = JSON.parse(sessionStorage.getItem(pendingKey));
      } catch {}
      const requestId = pending?.digest === digest ? pending.requestId : crypto.randomUUID();
      sessionStorage.setItem(pendingKey, JSON.stringify({
        digest,
        requestId
      }));
      const result = await json('/api/assistant-invoice-imports', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          ...body,
          requestId
        })
      });
      sessionStorage.removeItem(pendingKey);
      location.assign('/line-workflow-review?batchId=' + encodeURIComponent(result.batch.id));
    } catch (error) {
      status(error.message, true);
    } finally {
      $('#import').disabled = false;
    }
  };
  try {
    const result = await json('/api/workflow-templates');
    $('#template').replaceChildren(new Option('เลือก workflow', ''));
    for (const template of result.templates || []) {
      if (template.active !== false) $('#template').append(new Option(template.name, template.templateId));
    }
    $('#import').disabled = $('#template').options.length < 2;
    if ($('#import').disabled) status('ยังไม่มี workflow ที่เปิดใช้งาน', true);
  } catch (error) {
    status(error.message, true);
  }
})();
