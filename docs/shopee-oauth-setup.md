# ตั้งค่า Shopee OAuth

## 1. สร้างแอปใน Shopee Open Platform

สร้างแอปสำหรับร้านค้า แล้วเตรียมค่า `Partner ID` และ `Partner Key` จาก Shopee Open Platform Console

ตั้ง Callback URL ให้ตรงกับค่าที่ใช้รันระบบ:

```text
http://127.0.0.1:8787/api/shopee/callback
```

ถ้ารันบน server จริง ให้ใช้ HTTPS URL ของ server เช่น:

```text
https://your-domain.example/api/shopee/callback
```

## 2. ตั้งค่า environment ก่อน start server

```bash
export SHOPEE_PARTNER_ID="ใส่ Partner ID"
export SHOPEE_PARTNER_KEY="ใส่ Partner Key"
export SHOPEE_API_BASE_URL="https://partner.shopeemobile.com"
export SHOPEE_CALLBACK_URL="http://127.0.0.1:8787/api/shopee/callback"
export SHOPEE_APP_ORIGIN="http://127.0.0.1:8787"
```

ห้ามใส่ Partner Key หรือ token ใน browser code หรือ commit ลง Git

## 3. เชื่อมต่อร้าน

1. เปิด `/shopee-connection`
2. กด `Connect Shopee`
3. Login ด้วยบัญชีร้านค้าใน Shopee และกดอนุมัติสิทธิ์
4. Shopee จะ redirect กลับมาที่ callback
5. ระบบจะแลก authorization code เป็น access/refresh token และกลับมาหน้า Connection พร้อมสถานะ Connected
6. กด `Sync orders`

ระบบใช้ OAuth `state` แบบใช้ครั้งเดียวและหมดอายุใน 10 นาที เพื่อป้องกัน callback ที่ไม่ได้เริ่มจากหน้า Connect
