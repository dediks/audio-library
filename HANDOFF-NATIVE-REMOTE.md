# Handoff — fondasi Native Remote desktop v1

## Yang diserahkan

Perubahan source desktop pada branch `feature/secure-native-remote-v1`, dari baseline `20702751ff2fdea5ace7d131dbaed7c0727d3c6c`. Tidak ada push, deployment, installer Windows baru, atau perubahan Android/laptop aktif.

- Listener HTTPS opsional/default OFF dan pairing sekali-pakai + persetujuan operator.
- Perangkat control/view-only, expiry/revoke, kontrol Play/Pause/Stop.
- Status player dengan judul tampilan terbatas tanpa path, serta status perintah accepted/applied/rejected/expired/unknown.
- Perlindungan perintah Play yang tertahan pada persiapan audio agar tidak menyala setelah kedaluwarsa atau menimpa Stop/transport baru.
- Engine ingest/audio/organizer/queue utama dipertahankan.

**Kompatibilitas:** akses remote browser/PIN lewat HTTP LAN lama sengaja ditutup. UI/player desktop lokal tetap dipakai. Client Android untuk protokol baru BELUM dikerjakan; pairing string/QR ini bukan tautan browser HP yang langsung memutar atau mengendalikan desktop. Ini fondasi desktop, bukan fitur Android–PC yang sudah selesai.

## Memasukkan patch ke repo milikmu

Gunakan checkout Git yang bersih dan sesuai baseline; simpan/commit pekerjaan pribadimu terlebih dahulu. Jangan menimpa folder koleksi dengan source ZIP.

1. Periksa `git status --short` dan `git log -1 --oneline`.
2. Buat branch terpisah, misalnya `git switch -c feature/secure-native-remote-v1` jika nama itu belum ada.
3. Jalankan `git am "PATH/swararia-desktop-native-remote-v1.patch"`.
4. Jika konflik, jangan pakai reset/force. Tinjau dahulu; `git am --abort` membatalkan proses penerapan patch yang belum selesai, bukan menghapus koleksi.
5. Review diff dan uji di lingkunganmu. **Push dilakukan sendiri olehmu**; paket ini tidak menjalankan push atau membuat release otomatis.

ZIP source adalah alternatif untuk membaca/source checkout, bukan installer .exe dan bukan salinan data Library.

## Menjalankan/membangun di Windows

Gunakan lingkungan uji terpisah sebelum mengganti aplikasi acara. Remote TLS Windows memerlukan **Python3.12.4 atau lebih baru**; source menolak runtime lama untuk keamanan file kunci sementara. Manifest menambah `cryptography==50.0.2`; dependency pendukung harus dipasang dari requirements dalam environment proyek, bukan ke Hermes/global Python. Untuk tes Python source, dependency yt-dlp dari manifest juga diperlukan; arsip Android cached hanya dipakai di VPS saat verifikasi, bukan prasyarat aplikasi.

Belum ada toolchain/CI Windows yang disiapkan. Python/PyInstaller/Inno Setup yang mungkin diperlukan untuk membangun installer belum dipasang oleh pekerjaan ini. Jangan menganggap perubahan `.spec` adalah bukti build installer berhasil. Audit runtime/packager dan persetujuan instalasinya tetap diperlukan sebelum menjalankan opsi auto-install build script.

Sesudah source dijalankan: buka Player → HP Remote, pilih IPv4 LAN milik PC, aktifkan HTTPS manual, lalu lakukan pairing melalui client native yang memverifikasi fingerprint sebelum mengirim secret. Jangan mematikan firewall atau mem-forward port; aturan private/LAN Windows bila diperlukan harus disetujui dan diuji tersendiri.

## Bukti dan batas

Lihat `verification/native-remote-parent.json` untuk hasil final yang diulang parent, fingerprint source dan review; laporan implementer sebelumnya dipertahankan sebagai bukti historis, bukan hasil final setelah perbaikan. `SECURE_REMOTE.md` menjelaskan API dan batas protokol. Windows runtime/ACL/installer, output audio fisik dan HP–PC nyata belum diverifikasi.

Penyimpangan uji dicatat: satu tes RED awal sempat memakai default listener wildcard kode lama, lalu ditutup. Tes diperbaiki agar memeriksa default sebelum konstruksi socket; semua pengujian berikutnya memakai loopback. Tidak ada perubahan firewall/bridge. Backup bundle source dipulihkan pada scratch clone dan commit baseline diperiksa; ini bukan uji pemulihan data laptop.

## Rollback

Matikan Native Remote/cabut sesi tanpa mengirim Stop otomatis ke musik acara. Untuk source yang sudah di-commit, gunakan revert terarah setelah menyimpan perubahan lebih baru; jangan reset seluruh repo atau menghapus Library. Installer lama tetap dipertahankan di laptop; pekerjaan ini tidak memasang penggantinya. Revert source mengembalikan keamanan remote lama, jadi jangan mengaktifkannya untuk akses LAN/internet tanpa peninjauan.
