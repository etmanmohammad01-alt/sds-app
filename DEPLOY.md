# دليل النشر على Render (خطوة بخطوة)

الكود ده بقى شغال بقاعدة بيانات **PostgreSQL** بدل SQLite، عشان يناسب الاستضافة السحابية والبيانات متفضلش تتمسح لما السيرفر يعمل Restart.

## 1) اعمل حساب
افتح https://render.com واعمل حساب (ممكن بـ GitHub مباشرة).

## 2) ارفع الكود على GitHub
- اعمل Repository جديد على GitHub.
- ارفعله محتوى المجلد ده كامل (server.js, package.json, public/, DEPLOY.md).

## 3) اعمل قاعدة بيانات Postgres
- من لوحة Render: **New +** → **PostgreSQL**
- اديها اسم، واختار الخطة المجانية (Free) أو الأقرب لاحتياجك.
- بعد ما تتعمل، هتلاقي **Internal Database URL** أو **External Database URL** — انسخه.

## 4) اعمل Web Service
- من لوحة Render: **New +** → **Web Service**
- اختار الـ Repository اللي رفعته.
- Runtime: Node
- Build Command: `npm install`
- Start Command: `npm start`

## 5) ضيف Environment Variables
في إعدادات الـ Web Service → Environment:
| Key | Value |
|---|---|
| `DATABASE_URL` | (الرابط اللي نسخته من قاعدة الـ Postgres) |
| `JWT_SECRET` | أي نص عشوائي طويل وسري (غيّره عن القيمة الافتراضية) |

## 6) Deploy
دوس Create Web Service، وانتظر لغاية ما يخلص Build. هيديك رابط زي:
`https://sds-management-platform.onrender.com`

ده الرابط اللي تدوس عليه وتفتح البرنامج على طول من أي جهاز.

## 7) أول دخول
- Username: `admin`
- Password: `admin123`

**غيّر الباسورد ده فورًا بعد أول دخول** (من نفس الحساب لو فيه شاشة تغيير باسورد، أو مباشرة من قاعدة البيانات).

---

## ملاحظة عن رفع ملفات الـ SDS (PDF)
ملفات الـ PDF بتتخزن حاليًا كملفات على السيرفر نفسه (مجلد `uploads/`). على Render الـ Free tier، الملفات دي ممكن تتمسح لو السيرفر أعاد التشغيل، لأن الـ disk مش دائم في الخطة المجانية.
لو محتاج الملفات تفضل محفوظة دايمًا، فيه حلين:
1. تشترك في **Persistent Disk** على Render (متاحة بمصاريف بسيطة على الخطط المدفوعة).
2. أو نحوّل التخزين لخدمة زي **Cloudflare R2** أو **AWS S3** — أقدر أساعدك في ده لو حبيت الخطوة الجاية.

## تشغيل محلي للتجربة قبل النشر
لو عايز تجرب على جهازك الأول محتاج Postgres شغال محليًا أو تستخدم رابط الـ External Database من Render:
```
DATABASE_URL="postgres://..." JWT_SECRET="secret123" npm start
```
