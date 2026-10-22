// =====================================================================
//  server.js — Express + MySQL
//  BABAK FINAL LOMBA CERDAS CERMAT ROHANI 2026
//  Paroki Santa Odilia Cicadas Bandung
// =====================================================================

const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'lcc_rohani_2026',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4_unicode_ci',
  multipleStatements: true,
  decimalNumbers: true, // SUM()/agregat MySQL pulang sebagai DECIMAL (teks) bila ini tidak diaktifkan — itu penyebab skor menyambung ("01010-2030") alih-alih menjumlah
});

const LETTERS = ['A', 'B', 'C', 'D'];
const R1_COUNT = 10;
const R2_COUNT = 16;

// ---------------------------------------------------------------------
// Inisialisasi: jalankan schema.sql bila tabel belum ada
// ---------------------------------------------------------------------
async function init() {
  const [tables] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'sessions'`
  );
  if (!tables[0].n) {
    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')
      .replace(/^CREATE DATABASE[\s\S]*?;\s*USE[^;]*;/m, '');
    await pool.query(sql);
    console.log('✓ Skema dibuat');
  }
  // Pastikan ada event dan satu sesi aktif
  const [ev] = await pool.query('SELECT id FROM events ORDER BY id LIMIT 1');
  let eventId = ev.length ? ev[0].id : null;
  if (!eventId) {
    const [r] = await pool.query(
      'INSERT INTO events (nama, penyelenggara, tahun) VALUES (?,?,?)',
      ['BABAK FINAL LOMBA CERDAS CERMAT ROHANI 2026', 'Paroki Santa Odilia Cicadas Bandung', 2026]
    );
    eventId = r.insertId;
  }
  const [ses] = await pool.query(
    `SELECT id FROM sessions WHERE status <> 'selesai' ORDER BY id DESC LIMIT 1`
  );
  if (!ses.length) await createSession(eventId);
  console.log('✓ Database siap');
}

async function createSession(eventId, nama) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query(
      'INSERT INTO sessions (event_id, nama, status, mulai_at) VALUES (?,?,?,NOW())',
      [eventId, nama || 'Sesi ' + new Date().toLocaleString('id-ID'), 'persiapan']
    );
    const sid = r.insertId;
    const warna = ['#e0384f', '#2e8bf0', '#2fbf6e'];
    for (let i = 0; i < 3; i++) {
      await conn.query('INSERT INTO teams (session_id, slot, nama, warna) VALUES (?,?,?,?)',
        [sid, i, 'Kelompok ' + (i + 1), warna[i]]);
    }
    await conn.query(
      `INSERT INTO rounds (session_id, nomor, judul, poin_default, jumlah_soal)
       VALUES (?,1,'Taruhan Bobot',0,?), (?,2,'Rebut Kotak',10,?)`,
      [sid, R1_COUNT, sid, R2_COUNT]
    );
    const bobot = [10, 10, 20, 20, 30, 30, 40, 40, 50, 50];
    for (let i = 0; i < R1_COUNT; i++) {
      const [q] = await conn.query(
        'INSERT INTO r1_questions (session_id, nomor, tema, bobot, pertanyaan) VALUES (?,?,?,?,?)',
        [sid, i + 1, '', bobot[i], '']
      );
      for (const L of LETTERS) {
        await conn.query('INSERT INTO r1_options (question_id, huruf, teks, is_kunci) VALUES (?,?,?,?)',
          [q.insertId, L, '', L === 'A']);
      }
    }
    for (let i = 0; i < R2_COUNT; i++) {
      const [q] = await conn.query(
        'INSERT INTO r2_questions (session_id, nomor, pertanyaan, kunci, poin) VALUES (?,?,?,?,?)',
        [sid, i + 1, '', '', 10]
      );
      await conn.query('INSERT INTO r2_cards (session_id, question_id, status) VALUES (?,?,?)',
        [sid, q.insertId, 'tertutup']);
    }
    await conn.query('INSERT INTO ui_state (session_id, rev) VALUES (?,0)', [sid]);
    await conn.commit();
    return sid;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function activeSessionId() {
  const [rows] = await pool.query(
    `SELECT id FROM sessions WHERE status <> 'selesai' ORDER BY id DESC LIMIT 1`
  );
  return rows.length ? rows[0].id : null;
}

// ---------------------------------------------------------------------
// Merakit state dari tabel-tabel
// ---------------------------------------------------------------------
async function loadState(sid) {
  const [teams] = await pool.query(
    'SELECT id, slot, nama, warna FROM teams WHERE session_id=? ORDER BY slot', [sid]);
  const [scores] = await pool.query(
    'SELECT team_id, total FROM v_team_scores WHERE session_id=?', [sid]);
  // SUM() di MySQL dikembalikan sebagai string oleh driver — selalu paksa jadi Number di sini,
  // supaya penjumlahan skor berikutnya di klien tidak berubah jadi penyambungan teks.
  const scoreOf = id => Number((scores.find(s => s.team_id === id) || {}).total || 0) || 0;

  const [rounds] = await pool.query('SELECT nomor, poin_default FROM rounds WHERE session_id=?', [sid]);
  const r2cfg = rounds.find(r => r.nomor === 2) || { poin_default: 10 };

  const [r1q] = await pool.query(
    'SELECT id, nomor, tema, bobot, pertanyaan FROM r1_questions WHERE session_id=? ORDER BY nomor', [sid]);
  const [r1o] = await pool.query(
    `SELECT o.question_id, o.huruf, o.teks, o.is_kunci FROM r1_options o
     JOIN r1_questions q ON q.id=o.question_id WHERE q.session_id=? ORDER BY o.huruf`, [sid]);
  const [r1a] = await pool.query(
    'SELECT question_id, team_id, keputusan, jawaban, benar, poin FROM r1_attempts WHERE session_id=?', [sid]);

  const [r2q] = await pool.query(
    'SELECT id, nomor, pertanyaan, kunci FROM r2_questions WHERE session_id=? ORDER BY nomor', [sid]);
  const [r2c] = await pool.query(
    'SELECT question_id, status, dijawab_oleh FROM r2_cards WHERE session_id=?', [sid]);
  const [r2a] = await pool.query(
    'SELECT question_id, team_id, urutan, benar FROM r2_attempts WHERE session_id=? ORDER BY urutan', [sid]);

  const [ui] = await pool.query('SELECT * FROM ui_state WHERE session_id=?', [sid]);
  const u = ui[0] || {};
  const slotOf = id => (teams.find(t => t.id === id) || {}).slot;

  return {
    sessionId: sid,
    rev: u.rev || 0,
    screen: u.layar || 'home',
    teams: teams.map(t => ({ id: t.id, name: t.nama, score: scoreOf(t.id) })),
    r2Points: r2cfg.poin_default,
    r1: r1q.map(q => {
      const opts = r1o.filter(o => o.question_id === q.id);
      return {
        id: q.id, tema: q.tema || '', bobot: q.bobot, soal: q.pertanyaan || '',
        opsi: LETTERS.map(L => (opts.find(o => o.huruf === L) || {}).teks || ''),
        kunci: Math.max(0, LETTERS.indexOf(((opts.find(o => o.is_kunci) || {}).huruf) || 'A')),
      };
    }),
    r2: r2q.map(q => ({ id: q.id, soal: q.pertanyaan || '', kunci: q.kunci || '' })),
    play: {
      r1Index: u.r1_index || 0,
      r1Phase: u.r1_fase || 'tema',
      r1Rec: r1q.map(q => {
        const rec = { decisions: [null, null, null], picks: [null, null, null], scored: false };
        r1a.filter(a => a.question_id === q.id).forEach(a => {
          const s = slotOf(a.team_id);
          if (s == null) return;
          rec.decisions[s] = a.keputusan;
          rec.picks[s] = a.jawaban ? LETTERS.indexOf(a.jawaban) : null;
          rec.scored = true;
        });
        return rec;
      }),
      r2Cards: r2q.map(q => {
        const c = r2c.find(x => x.question_id === q.id) || {};
        const att = r2a.filter(a => a.question_id === q.id);
        const map = { tertutup: 'closed', terbuka: 'open', terjawab: 'solved', hangus: 'hangus' };
        return {
          status: map[c.status] || 'closed',
          solvedBy: c.dijawab_oleh != null ? slotOf(c.dijawab_oleh) : null,
          wrong: att.filter(a => !a.benar).map(a => slotOf(a.team_id)).filter(x => x != null),
        };
      }),
      openCard: u.kotak_aktif != null ? u.kotak_aktif : null,
      keyVisible: {},
    },
  };
}

// ---------------------------------------------------------------------
// Memecah state ke tabel-tabel
// ---------------------------------------------------------------------
async function saveState(sid, S) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [teams] = await conn.query('SELECT id, slot FROM teams WHERE session_id=? ORDER BY slot', [sid]);
    const teamId = slot => (teams.find(t => t.slot === slot) || {}).id;

    // teams
    for (let i = 0; i < (S.teams || []).length; i++) {
      if (teamId(i)) await conn.query('UPDATE teams SET nama=? WHERE id=?', [S.teams[i].name, teamId(i)]);
    }

    // rounds
    await conn.query('UPDATE rounds SET poin_default=? WHERE session_id=? AND nomor=2',
      [S.r2Points || 10, sid]);

    // ronde 1: soal + opsi
    const [r1q] = await conn.query('SELECT id, nomor FROM r1_questions WHERE session_id=? ORDER BY nomor', [sid]);
    for (let i = 0; i < r1q.length && i < S.r1.length; i++) {
      const q = S.r1[i], qid = r1q[i].id;
      await conn.query('UPDATE r1_questions SET tema=?, bobot=?, pertanyaan=? WHERE id=?',
        [q.tema || '', q.bobot || 0, q.soal || '', qid]);
      for (let oi = 0; oi < 4; oi++) {
        await conn.query(
          `INSERT INTO r1_options (question_id, huruf, teks, is_kunci) VALUES (?,?,?,?)
           ON DUPLICATE KEY UPDATE teks=VALUES(teks), is_kunci=VALUES(is_kunci)`,
          [qid, LETTERS[oi], q.opsi[oi] || '', q.kunci === oi]);
      }
      // percobaan ronde 1
      const rec = (S.play.r1Rec || [])[i];
      await conn.query('DELETE FROM r1_attempts WHERE question_id=?', [qid]);
      if (rec && rec.scored) {
        for (let ti = 0; ti < 3; ti++) {
          const d = rec.decisions[ti];
          if (!d || !teamId(ti)) continue;
          const jawab = d === 'jawab';
          const benar = jawab ? rec.picks[ti] === q.kunci : null;
          const poin = jawab ? (benar ? q.bobot : -q.bobot) : 0;
          await conn.query(
            `INSERT INTO r1_attempts (session_id, question_id, team_id, keputusan, jawaban, benar, poin)
             VALUES (?,?,?,?,?,?,?)`,
            [sid, qid, teamId(ti), d, jawab && rec.picks[ti] != null ? LETTERS[rec.picks[ti]] : null, benar, poin]);
        }
      }
    }

    // ronde 2: soal + kartu + percobaan
    const [r2q] = await conn.query('SELECT id, nomor FROM r2_questions WHERE session_id=? ORDER BY nomor', [sid]);
    const statusMap = { closed: 'tertutup', open: 'terbuka', solved: 'terjawab', hangus: 'hangus' };
    for (let i = 0; i < r2q.length && i < S.r2.length; i++) {
      const q = S.r2[i], qid = r2q[i].id, card = (S.play.r2Cards || [])[i] || {};
      await conn.query('UPDATE r2_questions SET pertanyaan=?, kunci=?, poin=? WHERE id=?',
        [q.soal || '', q.kunci || '', S.r2Points || 10, qid]);
      await conn.query(
        `UPDATE r2_cards SET status=?, dijawab_oleh=?, poin_diberikan=? WHERE question_id=?`,
        [statusMap[card.status] || 'tertutup',
         card.solvedBy != null ? teamId(card.solvedBy) : null,
         card.status === 'solved' ? (S.r2Points || 10) : 0,
         qid]);

      await conn.query('DELETE FROM r2_attempts WHERE question_id=?', [qid]);
      let urut = 0;
      for (const slot of (card.wrong || [])) {
        if (teamId(slot) == null) continue;
        urut++;
        await conn.query(
          'INSERT INTO r2_attempts (session_id, question_id, team_id, urutan, benar, poin) VALUES (?,?,?,?,?,?)',
          [sid, qid, teamId(slot), urut, false, 0]);
      }
      if (card.status === 'solved' && card.solvedBy != null && teamId(card.solvedBy) != null) {
        urut++;
        await conn.query(
          'INSERT INTO r2_attempts (session_id, question_id, team_id, urutan, benar, poin) VALUES (?,?,?,?,?,?)',
          [sid, qid, teamId(card.solvedBy), urut, true, S.r2Points || 10]);
      }
    }

    // koreksi nilai manual dari layar leaderboard
    for (const adj of (S.pendingAdjustments || [])) {
      if (teamId(adj.slot) == null || !adj.delta) continue;
      await conn.query(
        'INSERT INTO score_adjustments (session_id, team_id, selisih, alasan, oleh) VALUES (?,?,?,?,?)',
        [sid, teamId(adj.slot), adj.delta, adj.reason || 'Koreksi juri', adj.by || 'Operator']);
    }

    // status sesi + posisi tampilan
    const statusSesi = { home: 'persiapan', r1: 'ronde1', r1recap: 'ronde1', lb: 'klasemen', r2: 'ronde2', final: 'selesai' };
    await conn.query('UPDATE sessions SET status=? WHERE id=?',
      [statusSesi[S.screen] || 'persiapan', sid]);
    await conn.query(
      `INSERT INTO ui_state (session_id, rev, layar, r1_index, r1_fase, kotak_aktif, data)
       VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE rev=VALUES(rev), layar=VALUES(layar), r1_index=VALUES(r1_index),
         r1_fase=VALUES(r1_fase), kotak_aktif=VALUES(kotak_aktif), data=VALUES(data)`,
      [sid, S.rev || 0, S.screen || 'home', S.play.r1Index || 0, S.play.r1Phase || 'tema',
       S.play.openCard, JSON.stringify(S)]);

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------
// API
// ---------------------------------------------------------------------
app.get('/api/health', async (req, res) => {
  try {
    const [v] = await pool.query('SELECT VERSION() AS v');
    const [t] = await pool.query(
      `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE()`);
    res.json({ ok: true, db: v[0].v, tabel: t[0].n, session: await activeSessionId() });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/state', async (req, res) => {
  try {
    const sid = Number(req.query.session) || await activeSessionId();
    if (!sid) return res.json({ state: null });
    res.json({ state: await loadState(sid) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/state', async (req, res) => {
  try {
    const S = req.body;
    if (!S || !S.teams) return res.status(400).json({ error: 'state tidak valid' });
    const sid = Number(S.sessionId) || await activeSessionId();
    if (!sid) return res.status(404).json({ error: 'sesi tidak ditemukan' });
    await saveState(sid, S);
    res.json({ ok: true, sessionId: sid, rev: S.rev });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/leaderboard', async (req, res) => {
  try {
    const sid = Number(req.query.session) || await activeSessionId();
    const [rows] = await pool.query(
      `SELECT kelompok, poin_ronde1, poin_ronde2, poin_koreksi, total, peringkat
       FROM v_leaderboard WHERE session_id=? ORDER BY peringkat`, [sid]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/adjustments', async (req, res) => {
  try {
    const { slot, delta, reason, by } = req.body || {};
    const sid = Number(req.body.sessionId) || await activeSessionId();
    const [t] = await pool.query('SELECT id FROM teams WHERE session_id=? AND slot=?', [sid, slot]);
    if (!t.length) return res.status(404).json({ error: 'kelompok tidak ditemukan' });
    await pool.query(
      'INSERT INTO score_adjustments (session_id, team_id, selisih, alasan, oleh) VALUES (?,?,?,?,?)',
      [sid, t[0].id, delta, reason || 'Koreksi juri', by || 'Operator']);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/history', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.id, s.nama, UNIX_TIMESTAMP(COALESCE(s.selesai_at, s.updated_at))*1000 AS at,
              v.nama AS kelompok, v.total
       FROM sessions s JOIN v_team_scores v ON v.session_id = s.id
       WHERE s.status = 'selesai' ORDER BY s.id DESC, v.total DESC LIMIT 300`);
    const map = new Map();
    rows.forEach(r => {
      if (!map.has(r.id)) map.set(r.id, { id: r.id, nama: r.nama, at: Number(r.at), teams: [] });
      map.get(r.id).teams.push({ name: r.kelompok, score: r.total });
    });
    res.json([...map.values()]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Tutup sesi berjalan dan buka sesi baru yang bersih
app.post('/api/sessions/finish', async (req, res) => {
  try {
    const sid = await activeSessionId();
    if (sid) await pool.query(`UPDATE sessions SET status='selesai', selesai_at=NOW() WHERE id=?`, [sid]);
    const [ev] = await pool.query('SELECT id FROM events ORDER BY id LIMIT 1');
    const baru = await createSession(ev[0].id, req.body && req.body.nama);
    res.json({ ok: true, ditutup: sid, sesiBaru: baru });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Ekspor CSV langsung dari database
const cell = v => {
  const s = String(v == null ? '' : v);
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const sendCsv = (res, name, rows) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send('\ufeff' + rows.map(r => r.map(cell).join(';')).join('\r\n'));
};

app.get('/api/export/leaderboard.csv', async (req, res) => {
  try {
    const sid = Number(req.query.session) || await activeSessionId();
    const [rows] = await pool.query(
      `SELECT peringkat, kelompok, poin_ronde1, poin_ronde2, poin_koreksi, total
       FROM v_leaderboard WHERE session_id=? ORDER BY peringkat`, [sid]);
    sendCsv(res, 'klasemen.csv',
      [['peringkat', 'kelompok', 'poin_ronde_1', 'poin_ronde_2', 'koreksi', 'total'],
       ...rows.map(r => [r.peringkat, r.kelompok, r.poin_ronde1, r.poin_ronde2, r.poin_koreksi, r.total])]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/export/detail.csv', async (req, res) => {
  try {
    const sid = Number(req.query.session) || await activeSessionId();
    const [r1] = await pool.query(
      `SELECT q.nomor, q.tema, q.bobot, t.nama AS kelompok, a.keputusan, a.jawaban, a.benar, a.poin
       FROM r1_attempts a JOIN r1_questions q ON q.id=a.question_id JOIN teams t ON t.id=a.team_id
       WHERE a.session_id=? ORDER BY q.nomor, t.slot`, [sid]);
    const [r2] = await pool.query(
      `SELECT q.nomor, t.nama AS kelompok, a.urutan, a.benar, a.poin, c.status
       FROM r2_attempts a JOIN r2_questions q ON q.id=a.question_id JOIN teams t ON t.id=a.team_id
       JOIN r2_cards c ON c.question_id=q.id
       WHERE a.session_id=? ORDER BY q.nomor, a.urutan`, [sid]);
    const rows = [['RONDE 1'], ['nomor', 'tema', 'bobot', 'kelompok', 'keputusan', 'jawaban', 'benar', 'poin']];
    r1.forEach(r => rows.push([r.nomor, r.tema, r.bobot, r.kelompok, r.keputusan, r.jawaban || '',
      r.benar == null ? '' : (r.benar ? 'ya' : 'tidak'), r.poin]));
    rows.push([], ['RONDE 2'], ['kotak', 'kelompok', 'urutan_rebutan', 'benar', 'poin', 'status_kotak']);
    r2.forEach(r => rows.push([r.nomor, r.kelompok, r.urutan, r.benar ? 'ya' : 'tidak', r.poin, r.status]));
    sendCsv(res, 'detail-permainan.csv', rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

init()
  .then(() => app.listen(PORT, () => {
    console.log(`\n  LCC Rohani 2026 berjalan di http://localhost:${PORT}\n`);
  }))
  .catch(err => {
    console.error('Gagal terhubung ke MySQL:', err.message);
    console.error('Periksa berkas .env — host, user, password, dan nama database.');
    process.exit(1);
  });
