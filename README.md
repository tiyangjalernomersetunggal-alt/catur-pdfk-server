# Papan Kantor — Catur Internal Karyawan

Website catur multiplayer real-time untuk internal kantor. Backend Node.js
(Express + Socket.io + SQLite) jadi datanya sungguhan tersimpan di server,
bukan cuma di browser — bisa diakses banyak orang sekaligus dari PC atau HP.

## Alur pemakaian

1. Karyawan buka situs → tab **Daftar** → isi nama & nomor WhatsApp.
2. Sistem membuat token login, tapi **tidak** mengirim WhatsApp otomatis.
   Admin buka halaman `/admin`, lihat token yang baru, **kirim manual**
   lewat WhatsApp ke nomor yang bersangkutan, lalu tandai "Sudah Dikirim".
3. Karyawan masuk pakai token itu (berlaku permanen, seperti password).
4. Dashboard menampilkan siapa yang online, papan peringkat, dan menu
   Main / Pengaturan / Keluar — sesuai spesifikasi awal.
5. Saat main: pilih waktu, pilih lawan manual (kirim tantangan, otomatis
   dialihkan ke lawan acak kalau ditolak/tidak direspon 25 detik) atau acak
   langsung. Ada jam catur, papan klik-jalan, dan obrolan khusus dua pemain
   yang sedang bertanding.

## Menjalankan di komputer sendiri (opsional, buat coba-coba dulu)

Butuh [Node.js](https://nodejs.org) versi 18 ke atas sudah terpasang.

```bash
cd papan-kantor-server
npm install
cp .env.example .env
# buka .env, ganti ADMIN_PASSWORD dan SESSION_SECRET
npm start
```

Buka `http://localhost:3000` di browser (dan `http://localhost:3000/admin`
buat panel admin). Untuk tes multiplayer, buka di dua tab/browser berbeda,
atau dari HP lain yang satu WiFi (pakai alamat IP komputer, misalnya
`http://192.168.1.10:3000`).

## Deploy ke Render.com (rekomendasi buat pemula)

Render bisa jalanin server Node.js terus-menerus dan mendukung WebSocket
(dipakai buat fitur real-time-nya), dan ada paket gratis buat mulai.

**Langkah-langkah:**

1. **Buat akun GitHub** (kalau belum punya) di github.com, buat repository
   baru (boleh private), lalu upload semua isi folder `papan-kantor-server`
   ke repo itu (lewat GitHub Desktop atau `git push` biasa).
   *(File `.env` dan `data.sqlite` sudah otomatis diabaikan lewat `.gitignore`
   — jangan pernah upload `.env` ke GitHub karena isinya password.)*

2. **Buat akun Render** di render.com (bisa daftar pakai akun GitHub).

3. Di dashboard Render, klik **New +** → **Web Service** → pilih repo
   GitHub yang barusan dibuat.

4. Isi pengaturan:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free untuk coba-coba, atau Starter (~$7/bulan) kalau
     mau server tidak "tidur" saat tidak dipakai beberapa menit.

5. Di tab **Environment**, tambahkan variabel:
   - `ADMIN_PASSWORD` → password admin pilihan Bro (jangan dibiarkan default)
   - `SESSION_SECRET` → string acak panjang, bebas

6. Klik **Create Web Service**. Render otomatis build dan jalankan server.
   Setelah selesai, situsnya bisa diakses lewat alamat yang Render kasih
   (mis. `https://papan-kantor.onrender.com`) — dari PC maupun HP.

7. **Penting soal data**: paket Free Render disk-nya bisa ke-reset saat
   redeploy, jadi data pendaftar/skor bisa hilang. Kalau mau data tersimpan
   permanen, tambahkan **Render Disk** (menu "Disks" di service, murah,
   mulai dari $0.25/GB/bulan) dan arahkan path-nya ke folder project ini
   supaya file `data.sqlite` ikut tersimpan di disk permanen tersebut.

## Batasan yang perlu diketahui

- **Token dikirim manual oleh admin** lewat WhatsApp (sesuai pilihan Bro),
  bukan otomatis. Kalau nanti mau otomatis, itu perlu integrasi WhatsApp
  Business API (mis. Fonnte/Wablas/Meta Cloud API) — bisa ditambahkan
  belakangan sebagai langkah terpisah.
- Permainan yang sedang berlangsung disimpan di memori server (bukan
  database) — kalau server di-restart di tengah permainan, game itu hilang
  (skor yang sudah final tersimpan aman di database).
- Promosi pion otomatis jadi Menteri (belum ada pilihan promosi manual).
- Jam catur per pemain: masing-masing dapat jatah menit sendiri, habis waktu
  = kalah. Kalau ternyata maksudnya beda (misal satu timer bersama untuk
  seluruh partai), kasih tahu supaya bisa disesuaikan.
