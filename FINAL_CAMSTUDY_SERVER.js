const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const app = express();
app.disable('x-powered-by');
app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');next();});
app.use(express.json({ limit: '12mb', strict: true }));
const PORT = Number(process.env.PORT || 3000);
const TEACHER_PASSWORD = String(process.env.TEACHER_PASSWORD || 'ADMIN123');
const teacherSessions = new Map();
const loginAttempts = new Map();
const DATA_DIR = path.resolve(process.env.DATA_DIR || __dirname);
const DB_FILE = path.join(DATA_DIR, 'asts-data.json');
const ALLOWED = new Set(['ping', 'subjects', 'users', 'results', 'tasks', 'materials', 'submissions']);
let db = Object.create(null);
let writeQueue = Promise.resolve();
try {
  if (fs.existsSync(DB_FILE)) {
    const loaded = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) db = loaded;
  }
} catch (error) {
  console.error('Database file tidak bisa dibaca:', error.message);
  process.exit(1);
}
function sendError(res, status, message) { return res.status(status).json({ ok: false, error: message }); }
function auth(req, res, next) {
  const bearer = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const session = bearer && teacherSessions.get(bearer);
  if (session && session.expiresAt > Date.now()) { req.teacherSession = session; return next(); }
  const name = String((req.params && req.params.name) || '');
  const teacherOnly = req.method !== 'GET' && ['subjects','tasks','materials'].includes(name);
  const protectedEndpoint = req.path.startsWith('/api/generate-questions') || req.path.includes('/reset-');
  if ((teacherOnly || protectedEndpoint) && !session) return sendError(res, 403, 'Perlu login guru/admin.');
  // Data akun, status, nilai, dan pengumpulan boleh disinkronkan oleh siswa tanpa kunci rahasia di browser.
  if (req.method === 'PUT' && !['ping','users','results','submissions'].includes(name) && !session) return sendError(res, 403, 'Perlu login guru/admin.');
  next();
}
app.post('/api/teacher-login', (req, res) => {
  const ip=String(req.ip||req.socket.remoteAddress||'unknown');const attempts=loginAttempts.get(ip)||{count:0,until:0};if(attempts.until>Date.now())return sendError(res,429,'Terlalu banyak percobaan login. Tunggu 5 menit.');
  const username = String(req.body && req.body.username || '').trim().slice(0,80);
  const password = String(req.body && req.body.password || '');
  const p = Buffer.from(password); const q = Buffer.from(TEACHER_PASSWORD);
  const samePass = p.length === q.length && crypto.timingSafeEqual(p, q);
  if (!username || !samePass) { attempts.count++;if(attempts.count>=6){attempts.until=Date.now()+5*60*1000;attempts.count=0;}loginAttempts.set(ip,attempts);return sendError(res, 401, 'Nama pengguna atau password salah.'); }
  loginAttempts.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  teacherSessions.set(token, { username, expiresAt: Date.now() + 8 * 60 * 60 * 1000 });
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ ok: true, token, expiresIn: 28800, username });
});
app.post('/api/teacher-logout', (req, res) => { const token=String(req.get('authorization')||'').replace(/^Bearer\s+/i,''); if(token)teacherSessions.delete(token); res.json({ok:true}); });
function normalizeName(value) { return String(value || '').trim().toLocaleLowerCase('id-ID'); }
function resultKey(r) {
  if (r && r.id) return String(r.id);
  return [r && r.name, r && r.subject, r && r.date, r && r.time, r && r.score].map(v => String(v == null ? '' : v)).join('|');
}
function timeOf(item) { return Number(item && (item.updatedAt || item.timestamp || item.lastSeen) || 0); }
function mergeRecords(oldList, incomingList, keyFn) {
  const map = new Map();
  for (const item of [...(Array.isArray(oldList) ? oldList : []), ...(Array.isArray(incomingList) ? incomingList : [])]) {
    if (!item || typeof item !== 'object') continue;
    const key = keyFn(item);
    if (!key) continue;
    const previous = map.get(key);
    if (!previous || timeOf(item) >= timeOf(previous)) map.set(key, item);
  }
  return [...map.values()];
}
function mergeData(name, incoming) {
  if (name === 'subjects') return Array.isArray(incoming) ? incoming : [];
  if (name === 'users') {
    const oldUsers = Array.isArray(db.users && db.users.data) ? db.users.data : [];
    const merged = mergeRecords(oldUsers, incoming, u => normalizeName(u.name));
    // Counter pelanggaran bersifat kumulatif: sinkronisasi perangkat yang tertinggal
    // tidak boleh menghapus kenaikan yang sudah dicatat endpoint /api/student-violation.
    const maxViolations = new Map();
    for (const u of [...oldUsers, ...(Array.isArray(incoming) ? incoming : [])]) {
      const key = normalizeName(u && u.name);
      if (key) maxViolations.set(key, Math.max(maxViolations.get(key) || 0, Number(u && u.totalViolations || 0)));
    }
    return merged.map(u => ({ ...u, totalViolations: maxViolations.get(normalizeName(u.name)) || 0 }));
  }
  if (name === 'results') return mergeRecords(db.results && db.results.data, incoming, resultKey);
  return incoming;
}
function persist() {
  const snapshot = JSON.stringify(db);
  writeQueue = writeQueue.then(async () => {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
    const tmp = DB_FILE + '.tmp';
    await fs.promises.writeFile(tmp, snapshot, { encoding: 'utf8', mode: 0o600 });
    await fs.promises.rename(tmp, DB_FILE);
  });
  return writeQueue;
}
app.get('/health', (_req, res) => { res.setHeader('Cache-Control','no-store'); res.json({ status: 'ok', service: 'CAMSTUDY', time: new Date().toISOString() }); });
app.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'FINAL_CAMSTUDY_CODE_WEBSITE_FILE.html'));
});
app.post('/asts_kelas10/reset-users.json', auth, async (req, res) => {
  if (!req.body || req.body.confirm !== 'RESET_ALL_STUDENT_ACCOUNTS') {
    return sendError(res, 400, 'Konfirmasi reset akun tidak valid.');
  }
  const resetAt = Date.now();
  const previousUsers = db.users || {};
  const previousNames = Array.isArray(previousUsers.data) ? previousUsers.data.map(user => normalizeName(user && user.name)).filter(Boolean) : [];
  const resetNames = [...new Set([...(Array.isArray(previousUsers.resetNames) ? previousUsers.resetNames.map(normalizeName) : []), ...previousNames])];
  db.users = { data: [], resetAt, resetNames, updatedAt: resetAt };
  try {
    await persist();
    return res.json({ ok: true, resetAt, message: 'Semua akun siswa berhasil direset.' });
  } catch (error) {
    console.error('Gagal menyimpan reset akun:', error.message);
    return sendError(res, 500, 'Reset akun belum berhasil disimpan. Periksa persistent disk hosting.');
  }
});
app.post('/asts_kelas10/reset-results.json', auth, async (req, res) => {
  if (!req.body || req.body.confirm !== 'RESET_ALL_RESULTS') return sendError(res, 400, 'Konfirmasi reset nilai tidak valid.');
  const resetAt = Date.now();
  db.results = { data: [], resetAt, updatedAt: resetAt };
  try { await persist(); return res.json({ ok: true, resetAt, message: 'Semua rekap nilai berhasil direset.' }); }
  catch (error) { console.error('Gagal reset nilai:', error.message); return sendError(res, 500, 'Reset nilai belum tersimpan.'); }
});
app.post('/api/student-violation', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const name = String(req.body && req.body.name || '').trim().slice(0, 80);
  if (!name) return sendError(res, 400, 'Nama siswa diperlukan.');
  const users = db.users && Array.isArray(db.users.data) ? db.users.data : [];
  const normalized = normalizeName(name);
  let user = users.find(item => normalizeName(item && item.name) === normalized);
  const now = Date.now();
  // Tetap catat event jika sinkronisasi akun siswa sedang tertinggal saat siswa mulai quiz.
  if (!user) {
    user = { name, createdAt: now, completedSubjects: [], completedQuestionCount: 0, completedQuizCount: 0, totalViolations: 0 };
    users.push(user);
  }
  user.totalViolations = Number(user.totalViolations || 0) + 1;
  user.isOnline = false;
  user.readiness = 'Offline';
  user.lastSeen = now;
  user.updatedAt = now;
  db.users = { ...(db.users || {}), data: users, updatedAt: now };
  try {
    await persist();
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true, totalViolations: user.totalViolations, updatedAt: now });
  } catch (error) {
    console.error('Gagal menyimpan pelanggaran siswa:', error.message);
    return sendError(res, 500, 'Pelanggaran belum tersimpan ke server.');
  }
});

app.get('/asts_kelas10/:name.json', auth, (req, res) => {
  const name = req.params.name;
  if (!ALLOWED.has(name)) return sendError(res, 404, 'Data yang diminta tidak tersedia.');
  res.setHeader('Cache-Control', 'no-store');
  return res.json(db[name] === undefined ? null : db[name]);
});
app.put('/asts_kelas10/:name.json', auth, async (req, res) => {
  const name = req.params.name;
  if (!ALLOWED.has(name)) return sendError(res, 404, 'Data yang diminta tidak tersedia.');
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return sendError(res, 400, 'Format data tidak valid.');
  if (name === 'ping') {
    db.ping = { data: { ok: true }, updatedAt: Date.now() };
  } else {
    if (!Array.isArray(body.data)) return sendError(res, 400, 'Field data harus berupa daftar/array.');
    const previous = db[name] || {};
    let incomingData = body.data;
    if (name === 'results' && Number(previous.resetAt || 0) > 0) {
      const resetAt = Number(previous.resetAt || 0);
      incomingData = body.data.filter(item => Number(item && item.timestamp || 0) > resetAt);
    }
    if (name === 'users' && Number(previous.resetAt || 0) > 0) {
      const resetAt = Number(previous.resetAt);
      const resetNames = new Set((Array.isArray(previous.resetNames) ? previous.resetNames : []).map(normalizeName));
      // Tolak akun lama yang dikirim ulang oleh HP yang belum menerima sinyal reset.
      // Akun baru dengan nama sama diterima hanya jika createdAt lebih baru dari reset.
      incomingData = body.data.filter(user => !resetNames.has(normalizeName(user && user.name)) || Number(user && user.createdAt || 0) > resetAt);
    }
    db[name] = {
      data: mergeData(name, incomingData),
      updatedAt: Date.now(),
      ...(name === 'users' && previous.resetAt ? { resetAt: previous.resetAt, resetNames: previous.resetNames || [] } : {}),
      ...(name === 'results' && previous.resetAt ? { resetAt: previous.resetAt } : {})
    };
  }
  try {
    await persist();
    return res.json({ ok: true, name, count: name === 'ping' ? 1 : db[name].data.length, updatedAt: Date.now() });
  } catch (error) {
    console.error('Gagal menyimpan database:', error.message);
    return sendError(res, 500, 'Data belum berhasil disimpan. Periksa persistent disk hosting.');
  }
});
app.post('/api/generate-questions', auth, async (req, res) => {
  const apiKey = String(process.env.OPENAI_API_KEY || '');
  if (!apiKey) return sendError(res, 503, 'AI belum dikonfigurasi. Admin perlu mengatur OPENAI_API_KEY pada Environment hosting.');
  const material = String(req.body && req.body.material || '').trim();
  const subject = String(req.body && req.body.subject || 'Umum').trim().slice(0, 120);
  const count = Math.max(1, Math.min(50, Number(req.body && req.body.count) || 10));
  if (material.length < 80) return sendError(res, 400, 'Materi terlalu singkat. Tempel materi yang lebih lengkap.');
  if (material.length > 30000) return sendError(res, 413, 'Materi terlalu panjang. Batas materi adalah 30.000 karakter.');
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      signal: AbortSignal.timeout(45000),
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        instructions: 'Anda membantu guru SMA/SMK Indonesia membuat soal hanya dari MATERI SUMBER. KETEPATAN KUNCI ADALAH PRIORITAS UTAMA. Untuk setiap soal pilihan: (1) tentukan jawaban benar berdasarkan materi terlebih dahulu, (2) susun empat opsi dengan tepat satu jawaban benar untuk tipe choice, (3) setelah urutan opsi final ditentukan, hitung ulang answer sebagai indeks 0-based dari opsi final: 0=opsi pertama/A, 1=opsi kedua/B, 2=opsi ketiga/C, 3=opsi keempat/D, (4) cek ulang bahwa opsi pada indeks answer benar-benar menjawab pertanyaan dan cocok dengan exp. Jangan pernah menulis huruf jawaban di answer; gunakan angka indeks. Pastikan exp menerangkan mengapa jawaban itu benar dan tidak bertentangan dengan opsi lain. Hindari pertanyaan ambigu, opsi yang sama-sama benar, dan fakta yang tidak ada di materi. Jika materi tidak cukup untuk membuat soal yang valid, jangan mengarang. Variasikan tipe: choice, multiple, essay. Untuk multiple, answer berupa array indeks benar dan minimal 2; semua jawaban yang dipilih harus benar. Untuk essay, answerText berisi kunci lengkap, rubric berisi konsep wajib/sinonim, options=[] dan answer=null. Kembalikan JSON valid {"questions":[{"type":"choice|multiple|essay","q":"...","options":[],"answer":null,"answerText":"...","rubric":"...","exp":"..."}]}. Buat soal kelas 10 yang jelas, tidak duplikat, dan tidak melebihi jumlah diminta. Sebelum mengirim, audit sekali lagi semua kunci dan pembahasan. Jangan sertakan markdown.',
        input: 'Mata pelajaran: ' + subject + '\nJumlah soal: ' + count + '\n\nMATERI SUMBER:\n' + material,
        text: { format: { type: 'json_object' } },
        max_output_tokens: Math.min(8000, 700 + count * 300)
      })
    });
    const data = await response.json();
    if (!response.ok) {
      const msg = data && data.error && data.error.message ? data.error.message : 'Penyedia AI tidak dapat membuat soal.';
      console.error('OpenAI API error:', response.status, msg);
      return sendError(res, response.status === 429 ? 429 : 502, response.status === 429 ? 'Batas penggunaan AI tercapai. Coba lagi nanti.' : 'Layanan AI gagal memproses materi. Periksa konfigurasi API key/model.');
    }
    const output = (data.output || []).flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('\n');
    let parsed;
    try { parsed = JSON.parse(output); } catch (_) { return sendError(res, 502, 'Jawaban AI tidak terbaca sebagai JSON. Silakan coba lagi.'); }
    if (!parsed || !Array.isArray(parsed.questions)) return sendError(res, 502, 'AI tidak mengembalikan daftar soal.');
    const questions = parsed.questions.slice(0, count).map(q => {
      const type = ['choice','multiple','essay'].includes(q.type) ? q.type : 'choice';
      const options = Array.isArray(q.options) ? q.options.slice(0, 4).map(v => String(v || '').trim().slice(0, 500)) : [];
      const answer = type === 'multiple' ? (Array.isArray(q.answer) ? q.answer.map(Number).filter(n=>Number.isInteger(n)&&n>=0&&n<=3) : []) : Number(q.answer);
      return { type, q: String(q.q || '').trim().slice(0,1200), options, answer: type==='essay' ? null : answer,
        answerText: String(q.answerText || (type==='essay' ? q.answer || '' : '')).trim().slice(0,2500),
        rubric: String(q.rubric || '').trim().slice(0,2500), exp: String(q.exp || '').trim().slice(0,1500) };
    }).filter(q => q.q && (q.type==='essay' ? q.answerText.length>0 : q.options.length===4 && q.options.every(Boolean) && (q.type==='multiple' ? q.answer.length>=2 : Number.isInteger(q.answer)&&q.answer>=0&&q.answer<=3)));
    if (!questions.length) return sendError(res, 502, 'AI tidak menghasilkan soal valid. Coba materi yang lebih lengkap.');
    return res.json({ ok: true, questions });
  } catch (error) {
    console.error('Gagal menghubungi layanan AI:', error.message);
    return sendError(res, 502, 'Tidak dapat menghubungi layanan AI. Periksa koneksi server.');
  }
});
app.use((error, _req, res, _next) => {
  if (error && error.type === 'entity.too.large') return sendError(res, 413, 'Data terlalu besar untuk dikirim.');
  if (error instanceof SyntaxError) return sendError(res, 400, 'JSON tidak valid.');
  console.error(error);
  return sendError(res, 500, 'Terjadi kesalahan pada server.');
});
app.listen(PORT, '0.0.0.0', () => {
  console.log(`PORTAL BELAJAR KELAS 10 berjalan pada port ${PORT}; data disimpan di ${DB_FILE}`);
  console.log('Login guru/admin aktif: nama bebas; password berasal dari TEACHER_PASSWORD environment variable atau default lama.');
});
