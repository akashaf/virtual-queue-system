import type { Dictionary } from "./en";

export const ms: Dictionary = {
  langToggleLabel: "Bahasa",
  shopUnavailable: "Kedai ini tidak menerima pelanggan buat masa ini",

  // Borang menyertai
  waitingNow: "{count} sedang menunggu",
  waitingNowOne: "1 orang sedang menunggu",
  waitingNowNone: "Tiada sesiapa menunggu",
  nameLabel: "Nama anda",
  namePlaceholder: "cth. Ali",
  nameRequired: "Sila masukkan nama anda",
  nameTooLong: "Sila gunakan 30 aksara atau kurang",
  privacyNotice:
    "Hanya kedai melihat nama anda, dan kami memadamnya 30 hari selepas kunjungan anda.",
  joinButton: "Sertai giliran",

  // Pasang di iPhone
  installTitle: "Tambah halaman ini ke Skrin Utama untuk menyertai",
  installWhy:
    "Di iPhone, makluman giliran hanya sampai ke telefon yang dikunci jika anda menyertai dari Skrin Utama.",
  openInSafariTitle: "Buka halaman ini dalam Safari dahulu",
  openInSafariHelp:
    "Pelayar ini tidak boleh menambah halaman ke Skrin Utama. Buka menu dan pilih Buka dalam Safari, atau salin pautan ke Safari. Kemudian:",
  installStepShare: "Ketik butang Kongsi",
  installStepAdd: "Pilih Tambah ke Skrin Utama",
  installStepOpen: "Bukanya dari Skrin Utama dan sertai di sana",

  // Sedang menyertai
  checkingLocation: "Memastikan anda berada di kedai…",
  joining: "Menyertai giliran…",
  leaving: "Keluar dari giliran…",
  tryAgain: "Cuba lagi",

  // Sebab menyertai tidak berjaya
  locationDeniedTitle: "Kami perlukan lokasi anda untuk menyertai giliran",
  locationDeniedHelp:
    "Benarkan lokasi untuk laman ini dalam tetapan pelayar anda, kemudian cuba lagi.",
  locationUnavailableTitle: "Kami tidak dapat mencari lokasi anda",
  locationUnavailableHelp:
    "Bergerak ke tempat dengan isyarat lebih baik, kemudian cuba lagi.",
  tooFar: "Anda perlu berada di kedai untuk menyertai giliran",
  queueFull: "Giliran penuh, sila semak semula sebentar lagi",
  lastCallClosed: "Kedai akan tutup sebentar lagi, tidak menerima pelanggan baharu",
  alreadyInQueue: "Anda sudah berada dalam giliran ini pada telefon ini",
  joinFailed: "Ada masalah. Sila cuba lagi.",

  // Menunggu
  yourNumber: "Nombor anda",
  youAreNext: "Anda seterusnya",
  aheadOfYouOne: "1 orang di hadapan anda",
  aheadOfYou: "{count} orang di hadapan anda",
  estimatedWait: "Anggaran menunggu: {min}–{max} minit",
  estimatedWaitAbout: "Anggaran menunggu: kira-kira {minutes} minit",
  inPersonNote: "Pelanggan yang menunggu di kedai mungkin dilayan di antaranya",
  headBackNow: "Kembali ke kedai sekarang",
  headsUpTitle: "⏰ Hampir giliran anda",

  // Dipanggil, dan selesai
  yourTurn: "Giliran anda",
  goToCounter: "Sila ke kaunter",
  imComing: "Saya datang",
  calledTitle: "🔔 Giliran anda!",
  servedThanks: "Terima kasih! Jumpa lagi",

  // Keluar
  leaveQueue: "Keluar giliran",
  leaveConfirmTitle: "Keluar dari giliran?",
  leaveConfirmBody:
    "Anda akan kehilangan tempat anda. Untuk menyertai semula, anda perlu mengimbas kod QR di kedai.",
  leaveConfirmStay: "Kekal dalam giliran",
  leaveConfirmLeave: "Keluar",

  // Makluman tolak
  inAppBrowserWarning: "Buka dalam Chrome/Safari untuk menerima makluman",
  pushExplainTitle: "Terima makluman apabila tiba giliran anda",
  pushExplainBody:
    "Benarkan notifikasi dan kami akan maklumkan anda apabila giliran anda hampir tiba — walaupun skrin dikunci atau halaman ini ditutup.",
  pushExplainAllow: "Hidupkan makluman",
  pushExplainNotNow: "Bukan sekarang",
  pushOn: "Makluman dihidupkan — kami akan maklumkan anda",
  keepPageOpen: "Biarkan halaman ini terbuka, kami akan maklumkan anda dengan bunyi",
  mediaVolumeHint:
    "Bunyi dimainkan pada kelantangan media, bukan nada dering, jadi kuatkan kelantangan.",

  // Notifikasi tolak: nama kedai ialah tajuk, ini teksnya
  pushHeadsUp: "Hampir giliran anda ({number}).",
  pushCalled: "Giliran anda: {number}",
  pushLastCall: "Akan tutup sebentar lagi. Pilih untuk kekal atau pindah ke hari esok.",
  pushShopClosed: "Kedai telah tutup.",

  // Panggilan terakhir dan kedai tutup
  lastCallChoiceTitle: "Kedai akan tutup sebentar lagi",
  lastCallChoiceBody:
    "Pindah ke giliran hari esok, atau kekal hari ini? Jika anda kekal, anda mungkin tidak sempat dilayan.",
  choiceCarry: "Pindah ke hari esok",
  choiceStay: "Kekal hari ini",
  choiceChangeNote: "Anda boleh mengubahnya sehingga kedai tutup.",
  savingChoice: "Menyimpan pilihan anda…",
  choiceUnavailable: "Pilihan itu tidak lagi tersedia",
  carriedOverBadge: "Dipindah dari hari sebelumnya",
  shopClosedTitle: "Kedai telah tutup, maaf, sila datang semula esok",

  // Cara lain giliran boleh berakhir
  noShowTitle: "Anda terlepas giliran anda",
  joinAgain: "Sertai semula",
  scanToJoinAgain: "Imbas kod QR di kedai untuk menyertai semula",
  cannotRejoin:
    "Anda tidak boleh menyertai semula dengan tiket ini. Imbas kod QR di kedai.",
  leftTitle: "Anda telah keluar dari giliran",
  removedTitle: "Tiket anda telah dibuang",
  ticketGone: "Tiket itu telah pun berakhir",

  // A Customer who edited the URL and landed on the Owner's sign-in page
  scanAtShop: "Menunggu giliran untuk gunting rambut? Imbas kod QR di kedai.",
};
