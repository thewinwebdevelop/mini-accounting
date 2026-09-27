# Deploy to Google Cloud Run + Supabase

โปรเจกต์นี้รองรับการรัน backend เป็น stateless container บน Cloud Run โดยใช้
Supabase เป็นฐานข้อมูลและ private Storage หลัก ส่วนไฟล์ชั่วคราวระหว่างสร้าง
เอกสารจะอยู่ใน `/tmp` ของแต่ละ instance เท่านั้น

Cloud Run จะหยุดตั้งแต่ startup หากตรวจพบการตั้งค่า persistence แบบ `local`,
`shadow`, `dual-write` หรือ `DATA_BACKEND_FALLBACK=local` เพื่อป้องกันข้อมูล
หายเมื่อ instance ถูก recycle; ให้ใช้ `supabase-read` และ `LINE_INTAKE_BACKEND=supabase`
ตามตัวอย่างด้านล่าง

Cloud Run ต้องให้แอป listen ที่ `0.0.0.0` และ port ที่อยู่ในตัวแปร `PORT`;
โค้ดจะเปิดโหมดนี้อัตโนมัติเมื่อมี `K_SERVICE` หรือ `CLOUD_RUN=1` ตาม runtime
contract ของ Cloud Run: <https://cloud.google.com/run/docs/container-contract>

## 1. เตรียม Supabase

รัน migration ตามลำดับใน `supabase/migrations/` ผ่าน Supabase SQL Editor หรือ
Supabase CLI โดยเฉพาะตาราง `documents`, `document_files`,
`line_intake_items`, `storage_migration_records` และ bucket private
`sweet-house-files`.

จากนั้น migrate ข้อมูลเดิมจากเครื่องบริษัทตามคู่มือ
`docs/supabase-migration-runbook.md` ก่อนเปิดใช้ production read mode

## 2. เตรียม Google Cloud

เปิดใช้งาน Cloud Run, Artifact Registry และ Secret Manager แล้วสร้าง secret
อย่างน้อย:

- `sweet-house-supabase-secret` — Supabase server secret/service key
- `sweet-house-session-secret` — random session signing secret
- `sweet-house-line-channel-secret` — LINE Messaging API channel secret
- `sweet-house-line-access-token` — LINE Messaging API channel access token

Supabase secret/service key ใช้เฉพาะ backend เท่านั้น ห้ามใส่ใน frontend หรือ
ส่งไปใน LINE Mini App; Supabase เองจัดประเภท key นี้สำหรับ server-side code:
<https://supabase.com/docs/guides/getting-started/api-keys>

## 3. Deploy จาก repository

```bash
gcloud run deploy sweet-house \
  --source . \
  --region asia-southeast1 \
  --allow-unauthenticated \
  --set-env-vars CLOUD_RUN=1,NODE_ENV=production,SWEET_HOUSE_AUTH_MODE=line,SUPABASE_URL=https://YOUR_PROJECT.supabase.co,SUPABASE_STORAGE_BUCKET=sweet-house-files,LINE_INTAKE_BACKEND=supabase,DATA_BACKEND=supabase-read,DATA_BACKEND_DOCUMENTS=supabase-read,DATA_BACKEND_INVENTORY=supabase-read,DATA_BACKEND_FILES=supabase-read \
  --set-secrets SUPABASE_SERVICE_ROLE_KEY=sweet-house-supabase-secret:latest,SWEET_HOUSE_SESSION_SECRET=sweet-house-session-secret:latest
```

ถ้า project ใช้ Artifact Registry อยู่แล้ว สามารถ build image เองจาก
`Dockerfile` แล้ว deploy ด้วย `gcloud run deploy --image ...` ได้เช่นกัน

หลัง deploy ให้ดึง URL:

```bash
SERVICE_URL="$(gcloud run services describe sweet-house --region asia-southeast1 --format='value(status.url)')"
curl -fsS "$SERVICE_URL/healthz"
```

ตั้งค่า origin ให้ตรงกับ URL จริง แล้ว deploy/update service อีกครั้ง:

```bash
gcloud run services update sweet-house \
  --region asia-southeast1 \
  --update-env-vars APP_PUBLIC_ORIGIN="$SERVICE_URL",LINE_INTAKE_MINI_APP_URL="$SERVICE_URL/line-intake",SWEET_HOUSE_COOKIE_SECURE=1
```

`/healthz` จะตอบโดยไม่ต้อง login เพื่อใช้เป็น startup/readiness probe; Cloud
Run รองรับ HTTP health check endpoint โดยตรง:
<https://cloud.google.com/run/docs/configuring/healthchecks>

## 3.1 ทางเลือก: build image ด้วย Cloud Build

ถ้าเครื่อง local ไม่มี Docker daemon ให้ใช้ Cloud Build แทน:

```bash
IMAGE="asia-southeast1-docker.pkg.dev/YOUR_GCP_PROJECT/sweet-house/sweet-house:$(date +%Y%m%d%H%M%S)"
gcloud builds submit . \
  --config cloudbuild.yaml \
  --substitutions="_IMAGE=$IMAGE"
gcloud run deploy sweet-house \
  --image "$IMAGE" \
  --region asia-southeast1 \
  --allow-unauthenticated
```

ไฟล์ `deploy/cloud-run.service.yaml` เป็น template สำหรับ deploy แบบ YAML
พร้อม startup probe และ Secret Manager references; ให้แทนค่าที่ขึ้นต้นด้วย
`REPLACE_` ก่อนใช้ `gcloud run services replace`.

## 4. ตั้งค่า LINE

- Webhook URL: `$SERVICE_URL/api/webhooks/line`
- Mini App URL: `$SERVICE_URL/line-intake` หรือ URL ที่ใช้เป็น entry point ของ
  Mini App
- ใส่ `LINE_CHANNEL_SECRET` และ `LINE_CHANNEL_ACCESS_TOKEN` เป็น Cloud Run
  secret/env vars ตาม channel ที่ใช้กับ Messaging API
- ทดสอบ login ผ่าน LINE และส่งรูป/PDF เข้า webhook หลัง `/healthz` ผ่าน

## 5. ตรวจสอบ image ก่อน deploy

```bash
docker build -t sweet-house:cloud-run .
docker run --rm -p 8080:8080 \
  -e CLOUD_RUN=1 \
  -e SUPABASE_URL="https://YOUR_PROJECT.supabase.co" \
  -e SUPABASE_SERVICE_ROLE_KEY="SERVER_ONLY_SECRET" \
  -e SWEET_HOUSE_SESSION_SECRET="LOCAL_TEST_SECRET" \
  -e SWEET_HOUSE_AUTH_MODE=line \
  sweet-house:cloud-run
curl -fsS http://localhost:8080/healthz
```

ห้ามใช้ service key จริงใน shell history หรือ image test; ให้ใช้ Secret Manager
เมื่อ deploy จริง
