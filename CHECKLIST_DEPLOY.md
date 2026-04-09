# 🚀 Checklist Deploy Warung Kopi POS SaaS

## Langkah 1: Setup Firebase Project
- [ ] Buka https://console.firebase.google.com
- [ ] Klik "Add project" / "Create a project"
- [ ] Nama project: `warung-kopi-pos`
- [ ] Nonaktifkan Google Analytics (opsional)
- [ ] Klik "Create project"

## Langkah 2: Aktifkan Authentication
- [ ] Di sidebar kiri, klik "Authentication"
- [ ] Klik "Get started"
- [ ] Tab "Sign-in method" → pilih "Email/Password"
- [ ] Klik "Enable" → "Save"
- [ ] Di tab "Users", klik "Add user" untuk membuat akun admin pertama
  - Email: admin@warungkopi.com (ganti sesuai keinginan)
  - Password: (buat password kuat, min 8 karakter)
  - **CATATAN**: Salin UID user ini, dibutuhkan di Langkah 5

## Langkah 3: Aktifkan Cloud Firestore
- [ ] Di sidebar kiri, klik "Firestore Database"
- [ ] Klik "Create database"
- [ ] Pilih region terdekat (asia-southeast2 / Singapore)
- [ ] Pilih "Start in test mode"
- [ ] Klik "Create"
- [ ] **PENTING**: Setelah deploy, ganti rules ke production (Langkah 8)

## Langkah 4: Aktifkan Firebase Hosting
- [ ] Di sidebar kiri, klik "Hosting"
- [ ] Klik "Get started"
- [ ] (Skip CLI setup dulu, kita setup manual)

## Langkah 5: Salin Firebase Config
- [ ] Klik icon ⚙️ (Project Settings) di pojok kiri atas
- [ ] Scroll ke bawah, bagian "Your apps"
- [ ] Klik icon Web (`</>`) untuk menambahkan app
- [ ] App nickname: `warung-kopi-pos-web`
- [ ] Klik "Register app"
- [ ] **SALIN** firebaseConfig yang muncul:
```
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "warung-kopi-pos.firebaseapp.com",
  projectId: "warung-kopi-pos",
  storageBucket: "warung-kopi-pos.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```
- [ ] Ganti config ini di **index.html** (baris sekitar 660-670)
- [ ] Ganti config ini di **admin.html** (baris sekitar awal script)

## Langkah 6: Buat Akun Admin di Firestore
- [ ] Buka Firebase Console → Firestore Database
- [ ] Klik "Start collection"
- [ ] Collection ID: `admins`
- [ ] Document ID: **paste UID dari Langkah 2**
- [ ] Fields:
  - `name` (string): `Admin`
  - `email` (string): `admin@warungkopi.com` (sesuai Langkah 2)
  - `role` (string): `admin`
  - `createdAt` (timestamp): klik tanda panah → pilih timestamp → pilih waktu sekarang
- [ ] Klik "Save"

## Langkah 7: Deploy ke Firebase Hosting
- [ ] Install Firebase CLI (sekali saja):
```bash
npm install -g firebase-tools
```
- [ ] Login ke Firebase:
```bash
firebase login
```
- [ ] Buat folder project di komputer:
```bash
mkdir warung-kopi-pos
cd warung-kopi-pos
```
- [ ] Copy file-file berikut ke folder ini:
  - `index.html`
  - `admin.html`
  - `firestore.rules` (rename jadi `firestore.rules`)
- [ ] Inisialisasi Firebase:
```bash
firebase init
```
  - Pilih: Hosting
  - Pilih project: warung-kopi-pos
  - Public directory: `.` (ketik titik, lalu Enter)
  - Single-page app: Yes
  - Overwrite index.html: No
- [ ] Deploy:
```bash
firebase deploy
```
- [ ] Deploy Firestore Rules:
```bash
firebase deploy --only firestore:rules
```
- [ ] **URL aplikasi POS**: `https://warung-kopi-pos.web.app`
- [ ] **URL admin panel**: `https://warung-kopi-pos.web.app/admin.html`

## Langkah 8: Upload ke GitHub
- [ ] Buat repository baru di https://github.com/new
  - Repository name: `warung-kopi-pos`
  - Public atau Private (sesuai kebutuhan)
  - **JANGAN** centang "Add a README"
- [ ] Di folder project, jalankan:
```bash
cd warung-kopi-pos
git init
git add .
git commit -m "Initial commit - Warung Kopi POS SaaS"
git remote add origin https://github.com/USERNAME/warung-kopi-pos.git
git branch -M main
git push -u origin main
```
- [ ] Ganti `USERNAME` dengan username GitHub Anda

## Langkah 9: Testing
- [ ] Buka `https://warung-kopi-pos.web.app` → Harus tampil halaman Login
- [ ] Coba Daftar dengan akun kedai kopi baru
- [ ] Login admin: `https://warung-kopi-pos.web.app/admin.html`
- [ ] Di admin, setujui pendaftaran kedai kopi
- [ ] Login ulang dengan akun kedai kopi → POS aktif
- [ ] Coba buat transaksi

## Langkah 10: Update Kedepannya
Setiap kali ada perubahan kode:
```bash
cd warung-kopi-pos
git add .
git commit -m "Deskripsi perubahan"
git push
firebase deploy
```

---

## ⚠️ Catatan Penting

1. **Ganti firebaseConfig** di kedua HTML sebelum deploy
2. **firestore.rules** wajib di-deploy agar data aman
3. **Jangan** expose API key di public repo jika menggunakan paid services
4. **Backup** data Firestore secara berkala
5. **URL admin.html** sebaiknya hanya diketahui admin (tidak ada link dari index.html)
