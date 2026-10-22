-- =====================================================================
--  BABAK FINAL LOMBA CERDAS CERMAT ROHANI 2026
--  Paroki Santa Odilia Cicadas Bandung
--  Skema database MySQL 8+
-- =====================================================================

CREATE DATABASE IF NOT EXISTS lcc_rohani_2026
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE lcc_rohani_2026;

-- ---------------------------------------------------------------------
-- 1. events — identitas acara
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  nama         VARCHAR(200) NOT NULL,
  penyelenggara VARCHAR(200) NULL,
  tahun        SMALLINT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 2. sessions — satu kali permainan dari awal sampai selesai
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  event_id    INT NOT NULL,
  nama        VARCHAR(200) NOT NULL DEFAULT 'Sesi',
  status      ENUM('persiapan','ronde1','klasemen','ronde2','selesai')
                NOT NULL DEFAULT 'persiapan',
  mulai_at    DATETIME NULL,
  selesai_at  DATETIME NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_sessions_event FOREIGN KEY (event_id)
    REFERENCES events(id) ON DELETE CASCADE,
  INDEX idx_sessions_status (status)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 3. teams — kelompok peserta pada satu sesi
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teams (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  session_id  INT NOT NULL,
  slot        TINYINT NOT NULL,              -- 0,1,2 — urutan tampil di papan
  nama        VARCHAR(120) NOT NULL,
  warna       CHAR(7) NULL,                  -- hex, contoh #e0384f
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_teams_session FOREIGN KEY (session_id)
    REFERENCES sessions(id) ON DELETE CASCADE,
  UNIQUE KEY uq_team_slot (session_id, slot)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 4. rounds — konfigurasi tiap ronde
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rounds (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  session_id    INT NOT NULL,
  nomor         TINYINT NOT NULL,            -- 1 atau 2
  judul         VARCHAR(120) NOT NULL,
  poin_default  INT NOT NULL DEFAULT 0,      -- ronde 2: poin per kotak
  jumlah_soal   SMALLINT NOT NULL,
  CONSTRAINT fk_rounds_session FOREIGN KEY (session_id)
    REFERENCES sessions(id) ON DELETE CASCADE,
  UNIQUE KEY uq_round_nomor (session_id, nomor)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 5. r1_questions — soal Ronde 1 (taruhan bobot)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS r1_questions (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  session_id  INT NOT NULL,
  nomor       SMALLINT NOT NULL,             -- 1..10
  tema        VARCHAR(200) NULL,
  bobot       INT NOT NULL DEFAULT 0,
  pertanyaan  TEXT NULL,
  CONSTRAINT fk_r1q_session FOREIGN KEY (session_id)
    REFERENCES sessions(id) ON DELETE CASCADE,
  UNIQUE KEY uq_r1q_nomor (session_id, nomor)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 6. r1_options — pilihan A/B/C/D untuk tiap soal Ronde 1
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS r1_options (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  question_id  INT NOT NULL,
  huruf        ENUM('A','B','C','D') NOT NULL,
  teks         TEXT NULL,
  is_kunci     BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT fk_r1o_question FOREIGN KEY (question_id)
    REFERENCES r1_questions(id) ON DELETE CASCADE,
  UNIQUE KEY uq_r1o_huruf (question_id, huruf),
  INDEX idx_r1o_kunci (question_id, is_kunci)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 7. r1_attempts — keputusan & jawaban tiap kelompok di Ronde 1
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS r1_attempts (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  session_id   INT NOT NULL,
  question_id  INT NOT NULL,
  team_id      INT NOT NULL,
  keputusan    ENUM('jawab','lewat') NOT NULL,
  jawaban      ENUM('A','B','C','D') NULL,   -- NULL bila lewat
  benar        BOOLEAN NULL,                 -- NULL bila lewat
  poin         INT NOT NULL DEFAULT 0,       -- +bobot / -bobot / 0
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_r1a_session  FOREIGN KEY (session_id)  REFERENCES sessions(id)     ON DELETE CASCADE,
  CONSTRAINT fk_r1a_question FOREIGN KEY (question_id) REFERENCES r1_questions(id) ON DELETE CASCADE,
  CONSTRAINT fk_r1a_team     FOREIGN KEY (team_id)     REFERENCES teams(id)        ON DELETE CASCADE,
  UNIQUE KEY uq_r1a (question_id, team_id),
  INDEX idx_r1a_session (session_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 8. r2_questions — soal Ronde 2 (rebut kotak)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS r2_questions (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  session_id   INT NOT NULL,
  nomor        SMALLINT NOT NULL,            -- 1..16
  pertanyaan   TEXT NULL,
  kunci        TEXT NULL,                    -- jawaban uraian
  poin         INT NOT NULL DEFAULT 10,
  CONSTRAINT fk_r2q_session FOREIGN KEY (session_id)
    REFERENCES sessions(id) ON DELETE CASCADE,
  UNIQUE KEY uq_r2q_nomor (session_id, nomor)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 9. r2_cards — status tiap kotak di papan
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS r2_cards (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  session_id    INT NOT NULL,
  question_id   INT NOT NULL,
  status        ENUM('tertutup','terbuka','terjawab','hangus')
                  NOT NULL DEFAULT 'tertutup',
  dijawab_oleh  INT NULL,                    -- team_id pemenang kotak
  poin_diberikan INT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_r2c_session  FOREIGN KEY (session_id)   REFERENCES sessions(id)     ON DELETE CASCADE,
  CONSTRAINT fk_r2c_question FOREIGN KEY (question_id)  REFERENCES r2_questions(id) ON DELETE CASCADE,
  CONSTRAINT fk_r2c_team     FOREIGN KEY (dijawab_oleh) REFERENCES teams(id)        ON DELETE SET NULL,
  UNIQUE KEY uq_r2c_question (question_id),
  INDEX idx_r2c_status (session_id, status)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 10. r2_attempts — percobaan jawab termasuk urutan rebutan
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS r2_attempts (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  session_id   INT NOT NULL,
  question_id  INT NOT NULL,
  team_id      INT NOT NULL,
  urutan       TINYINT NOT NULL,             -- 1 = penantang pertama, 2 & 3 = rebutan
  benar        BOOLEAN NOT NULL,
  poin         INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_r2a_session  FOREIGN KEY (session_id)  REFERENCES sessions(id)     ON DELETE CASCADE,
  CONSTRAINT fk_r2a_question FOREIGN KEY (question_id) REFERENCES r2_questions(id) ON DELETE CASCADE,
  CONSTRAINT fk_r2a_team     FOREIGN KEY (team_id)     REFERENCES teams(id)        ON DELETE CASCADE,
  UNIQUE KEY uq_r2a (question_id, team_id),
  INDEX idx_r2a_session (session_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 11. score_adjustments — koreksi nilai manual dari juri
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS score_adjustments (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  session_id  INT NOT NULL,
  team_id     INT NOT NULL,
  selisih     INT NOT NULL,                  -- boleh negatif
  alasan      VARCHAR(255) NULL,
  oleh        VARCHAR(120) NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_adj_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_adj_team    FOREIGN KEY (team_id)    REFERENCES teams(id)    ON DELETE CASCADE,
  INDEX idx_adj_session (session_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 12. ui_state — posisi tampilan operator (layar aktif, soal ke berapa)
--     Hanya untuk menyambung ulang tampilan, bukan sumber nilai.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ui_state (
  session_id  INT PRIMARY KEY,
  rev         INT NOT NULL DEFAULT 0,
  layar       VARCHAR(30) NOT NULL DEFAULT 'home',
  r1_index    SMALLINT NOT NULL DEFAULT 0,
  r1_fase     VARCHAR(20) NOT NULL DEFAULT 'tema',
  kotak_aktif SMALLINT NULL,
  data        JSON NULL,                     -- cadangan penuh untuk pulih cepat
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ui_session FOREIGN KEY (session_id)
    REFERENCES sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- =====================================================================
--  VIEW — nilai dihitung dari percobaan + koreksi, bukan disimpan ganda
-- =====================================================================

CREATE OR REPLACE VIEW v_team_scores AS
SELECT
  t.id                AS team_id,
  t.session_id,
  t.slot,
  t.nama,
  COALESCE(r1.poin, 0) AS poin_ronde1,
  COALESCE(r2.poin, 0) AS poin_ronde2,
  COALESCE(ad.poin, 0) AS poin_koreksi,
  COALESCE(r1.poin, 0) + COALESCE(r2.poin, 0) + COALESCE(ad.poin, 0) AS total
FROM teams t
LEFT JOIN (SELECT team_id, SUM(poin)    AS poin FROM r1_attempts       GROUP BY team_id) r1 ON r1.team_id = t.id
LEFT JOIN (SELECT team_id, SUM(poin)    AS poin FROM r2_attempts       GROUP BY team_id) r2 ON r2.team_id = t.id
LEFT JOIN (SELECT team_id, SUM(selisih) AS poin FROM score_adjustments GROUP BY team_id) ad ON ad.team_id = t.id;

CREATE OR REPLACE VIEW v_leaderboard AS
SELECT
  s.id            AS session_id,
  s.nama          AS sesi,
  s.status,
  v.team_id,
  v.nama          AS kelompok,
  v.poin_ronde1,
  v.poin_ronde2,
  v.poin_koreksi,
  v.total,
  RANK() OVER (PARTITION BY s.id ORDER BY v.total DESC) AS peringkat
FROM sessions s
JOIN v_team_scores v ON v.session_id = s.id;

-- =====================================================================
--  Data awal
-- =====================================================================
INSERT INTO events (nama, penyelenggara, tahun)
SELECT 'BABAK FINAL LOMBA CERDAS CERMAT ROHANI 2026',
       'Paroki Santa Odilia Cicadas Bandung', 2026
WHERE NOT EXISTS (SELECT 1 FROM events);
