# Google Drive Sync ผ่านหน้า UI

ระบบนี้ใช้ Google OAuth + Google Drive API โดยตรงสำหรับปุ่ม `Sync to Google Drive` ในหน้า `/expense-requests`

## 1. สร้าง OAuth Client ใน Google Cloud

1. เปิด Google Cloud Console
2. สร้างหรือเลือก project
3. Enable `Google Drive API`
4. สร้าง OAuth Client type `Web application`
5. เพิ่ม Authorized JavaScript origin:

```text
http://localhost:8787
```

ช่องนี้ต้องเป็น origin เท่านั้น ห้ามมี path ต่อท้าย เช่น `/api/...`

6. เพิ่ม Authorized redirect URI:

```text
http://localhost:8787/api/google-drive/oauth2callback
```

7. ถ้า OAuth app ยังอยู่สถานะ `Testing` ให้เพิ่มบัญชี Google ที่จะใช้ login ใน `Audience` > `Test users`:

```text
sweethousecute.manage@gmail.com
```

ถ้าไม่เพิ่มบัญชีนี้ Google จะแสดงข้อความ `Access blocked` เพราะ app ยังไม่ได้ผ่าน Google verification

## 2. ตั้งค่าในเว็บ local

1. เปิด `http://localhost:8787/google-drive`
2. ใส่ `Google OAuth Client ID`
3. ใส่ `Google OAuth Client Secret`
4. ตรวจ `Google Drive base folder`
5. กด `บันทึกการตั้งค่า`
6. กด `Login with Google`

ระบบจะ redirect ไปหน้า Google เพื่อให้อนุญาต scope:

```text
https://www.googleapis.com/auth/drive.file
```

scope นี้ให้ระบบจัดการไฟล์และโฟลเดอร์ที่ระบบสร้าง/อัปโหลดเอง

## 3. Workflow sync เอกสาร

1. สร้างใบเบิกจ่ายจากหน้า `/expense-request`
2. ตรวจ PDF และ raw files ใน local folder
3. ไปหน้า `/expense-requests`
4. กด `Sync to Google Drive`
5. ระบบจะสร้างโฟลเดอร์บน Drive และ upload ทั้ง folder เอกสาร
6. ระบบบันทึกผลไว้ที่ `data/drive-sync.json`

## 4. ไฟล์ config ในเครื่อง

ระบบเก็บ credential และ token ไว้ในเครื่องนี้:

```text
config/google-drive-config.json
config/google-drive-token.json
```

ไฟล์ใน `config/` เป็นข้อมูลลับของเครื่อง local และไม่ควรถูก commit หรือแชร์ต่อ
