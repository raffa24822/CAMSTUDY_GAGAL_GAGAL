CAMSTUDY — Paket FINAL PROJECT A+ (perbaikan dan audit lokal)

ISI PAKET
- FINAL_CAMSTUDY_CODE_WEBSITE_FILE.html : halaman website
- FINAL_CAMSTUDY_SERVER.js : server API, login guru, sinkronisasi, dan AI
- package.json : dependensi dan perintah start

DEPLOY KE RENDER
1. Unggah/commit SEMUA file dalam ZIP ini ke repository yang dipakai Render.
2. Build Command: npm install
3. Start Command: npm start
4. Tambahkan Environment Variables di Render:
   - OPENAI_API_KEY = API key milik akun OpenAI Anda (jangan pernah dimasukkan ke HTML atau dibagikan ke orang lain)
   - TEACHER_PASSWORD = kata sandi admin/guru yang kuat
   - OPENAI_MODEL = gpt-4.1-mini (opsional; hanya jika model tersedia di akun API)
5. Setelah deploy, buka https://ALAMAT-RENDER/health. Hasil yang diharapkan: JSON dengan status "ok" dan service "CAMSTUDY".
6. Buka alamat utama Render. Halaman HTML sekarang disajikan oleh server dari nama file yang ada di paket.
7. Login sebagai guru dan tes AI dengan materi minimal 80 karakter. Server memberi batas waktu 45 detik untuk panggilan AI agar permintaan tidak menggantung tanpa batas.

PENGURUTAN DAN TAMPILAN
- Daftar mata pelajaran, siswa, materi/tugas, dan rekap nilai yang diaudit diurutkan A–Z berdasarkan nama/judul.
- Logo rekap nilai mempertahankan latar dan ornamen kotak bertingkat.
- Nama/identitas web tetap CAMSTUDY.

PENTING
- Jangan bagikan OPENAI_API_KEY. Pemakaian API dapat memerlukan billing/kuota aktif.
- Jika website saat ini di-host terpisah dari server Render, URL server pada pengaturan sinkronisasi harus menunjuk ke layanan Render yang menjalankan file server ini.
- Untuk menyimpan data antardeploy, atur persistent disk Render dan DATA_DIR ke mount path disk tersebut. Tanpa persistent disk, data lokal dapat hilang saat instance diganti.
- Perbaikan ini membetulkan rute halaman utama agar cocok dengan nama HTML dalam paket, menambahkan timeout pada permintaan AI, dan merapikan pengurutan daftar yang diaudit. Pemeriksaan lokal tidak dapat menjamin bebas bug 100% pada Render; uji langsung di akun Render tetap diperlukan.


CATATAN PRIVASI LOGIN SISWA
Siswa diminta memasukkan username, bukan nama lengkap. Disarankan memakai nama panggilan atau samaran dan tidak memasukkan informasi pribadi. Catatan ini tidak menggantikan pengamanan akses data pada server.

FITUR REVISI MEDALI: Setelah siswa menyelesaikan setiap quiz, popup hadiah medali animasi akan tampil di atas halaman hasil, dengan efek medali berputar/muncul dan confetti. Tampilan ini menunjukkan tingkatan/medali berdasarkan jumlah soal yang telah diselesaikan.

REVISI TERGABUNG:
- Tutorial siswa menggunakan username/nama panggilan atau samaran dan memperingatkan agar tidak memasukkan nama lengkap.
- Popup hadiah medali animasi dan confetti setelah quiz selesai.
- Latar kotak berlapis yang lebih jelas di belakang logo pada gambar ekspor Rekap Nilai Siswa.
Catatan: pemeriksaan file/ZIP tidak menggantikan uji langsung di browser dan server hosting.
