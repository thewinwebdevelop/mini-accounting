window.addEventListener("DOMContentLoaded", () => {
  const form = document.querySelector("#userProfileForm");
  const message = document.querySelector("#userProfileMessage");
  const positionHint = document.querySelector("#companyPositionHint");
  const authStatus = document.querySelector("[data-line-auth-status]");
  const authenticatedContent = [...document.querySelectorAll("[data-authenticated-content]")];

  if (!form || !message) return;

  function setMessage(text, kind = "") {
    message.className = `message ${kind}`.trim();
    message.textContent = text;
  }

  async function readJson(response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers: { "content-type": "application/json", ...(options.headers || {}) },
    });
    const result = await readJson(response);
    if (!response.ok) throw new Error(result.error || "ไม่สามารถโหลดข้อมูลได้");
    return result;
  }

  async function requireSession() {
    const response = await fetch("/api/auth/me", { credentials: "same-origin" });
    let session = {};
    try {
      session = await response.json();
    } catch {
      session = {};
    }
    if (!response.ok || session.authenticated !== true) {
      const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.location.replace(`/line-auth?returnTo=${encodeURIComponent(returnTo)}`);
      return false;
    }
    authenticatedContent.forEach((element) => { element.hidden = false; });
    if (authStatus) authStatus.hidden = true;
    return true;
  }

  function fillProfile(profile) {
    form.elements.firstName.value = profile.firstName || "";
    form.elements.lastName.value = profile.lastName || "";
    form.elements.companyPositionId.value = profile.companyPositionId || "";
  }

  function fillPositions(positions, selectedId, selectedLabel) {
    const select = form.elements.companyPositionId;
    select.replaceChildren(new Option("เลือกตำแหน่ง", ""));
    let selectedIsInactive = Boolean(selectedId);
    for (const position of positions) {
      const option = new Option(position.label, position.id);
      option.selected = position.id === selectedId;
      if (option.selected) selectedIsInactive = false;
      select.append(option);
    }
    if (selectedIsInactive && selectedLabel) {
      const option = new Option(`${selectedLabel} (ปิดใช้งาน)`, selectedId);
      option.selected = true;
      option.disabled = true;
      select.append(option);
      positionHint.textContent = "ตำแหน่งเดิมถูกปิดใช้งานแล้ว กรุณาเลือกตำแหน่งใหม่";
    } else {
      positionHint.textContent = "เลือกจากตำแหน่งที่ใช้งานอยู่";
    }
  }

  async function load() {
    try {
      if (!await requireSession()) return;
      const [{ profile }, { positions }] = await Promise.all([
        api("/api/auth/profile"),
        api("/api/company-positions"),
      ]);
      fillProfile(profile || {});
      fillPositions(positions || [], profile?.companyPositionId, profile?.companyPositionLabel);
      setMessage("");
    } catch (error) {
      setMessage(error.message || "ไม่สามารถโหลดข้อมูลส่วนตัวได้", "error");
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage("กำลังบันทึกข้อมูลส่วนตัว...");
    try {
      const result = await api("/api/auth/profile", {
        method: "PATCH",
        body: JSON.stringify({
          firstName: form.elements.firstName.value,
          lastName: form.elements.lastName.value,
          companyPositionId: form.elements.companyPositionId.value,
        }),
      });
      fillProfile(result.profile || {});
      setMessage("บันทึกข้อมูลส่วนตัวแล้ว");
    } catch (error) {
      setMessage(error.message || "บันทึกข้อมูลส่วนตัวไม่สำเร็จ", "error");
    }
  });

  load();
});
