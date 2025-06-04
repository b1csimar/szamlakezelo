const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const Database = require('better-sqlite3');
const app = express();
const port = 3000;

app.use(cors());
app.use(bodyParser.json());

// DB setup
const db = new Database('szamlak.db');

// Táblák létrehozása, ha nem léteznek
db.prepare(`
CREATE TABLE IF NOT EXISTS vevok (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nev TEXT NOT NULL,
    cim TEXT NOT NULL,
    adoszam TEXT NOT NULL
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS szamlak (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    szamla_szam TEXT NOT NULL,
    szamla_kelte TEXT NOT NULL,
    teljesites_datum TEXT NOT NULL,
    fizetesi_hatarido TEXT NOT NULL,
    vegosszeg REAL NOT NULL,
    afa_szazalek INTEGER NOT NULL,
    kiallo_id INTEGER NOT NULL,
    vevo_id INTEGER NOT NULL,
    stornozott BOOLEAN DEFAULT 0,
    UNIQUE(szamla_szam, kiallo_id),
    FOREIGN KEY(kiallo_id) REFERENCES vevok(id),
    FOREIGN KEY(vevo_id) REFERENCES vevok(id)
)
`).run();

// Példavevők létrehozása ha üres az adatbázis
const countVevok = db.prepare('SELECT COUNT(*) as c FROM vevok').get().c;
if (countVevok === 0) {
    const insertVevok = db.prepare('INSERT INTO vevok (nev, cim, adoszam) VALUES (?, ?, ?)');
    insertVevok.run('Cég Kft.', 'Budapest, Fő utca 1.', '12345678-1-12');
    insertVevok.run('Másik Kft.', 'Debrecen, Kossuth tér 2.', '23456789-2-23');
    insertVevok.run('Vevő Bt.', 'Szeged, Petőfi u. 5.', '34567890-3-34');
}

// Példaszámlák ha üres a számla tábla
const countSzamlak = db.prepare('SELECT COUNT(*) as c FROM szamlak').get().c;
if (countSzamlak === 0) {
    const insertSzamla = db.prepare(`
    INSERT INTO szamlak (szamla_szam, szamla_kelte, teljesites_datum, fizetesi_hatarido, vegosszeg, afa_szazalek, kiallo_id, vevo_id, stornozott)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    `);

    // Kiállító 1 - 3 számla vevőnként
    insertSzamla.run('001/2025', '2025-05-01', '2025-05-01', '2025-05-31', 100000, 27, 1, 1);
    insertSzamla.run('002/2025', '2025-05-05', '2025-05-05', '2025-06-04', 200000, 27, 1, 2);
    insertSzamla.run('003/2025', '2025-05-10', '2025-05-10', '2025-06-09', 150000, 27, 1, 3);

    // Kiállító 2
    insertSzamla.run('001/2025', '2025-05-02', '2025-05-02', '2025-06-01', 90000, 27, 2, 1);
    insertSzamla.run('002/2025', '2025-05-06', '2025-05-06', '2025-06-05', 110000, 27, 2, 2);
    insertSzamla.run('003/2025', '2025-05-11', '2025-05-11', '2025-06-10', 130000, 27, 2, 3);
}

// --- API végpontok ---

// Vevők lekérdezése
app.get('/api/vevok', (req, res) => {
    const vevok = db.prepare('SELECT * FROM vevok').all();
    res.json(vevok);
});

// Új vevő hozzáadása
app.post('/api/vevok', (req, res) => {
    const { nev, cim, adoszam } = req.body;
    if (!nev || !cim || !adoszam) return res.status(400).json({ error: 'Minden vevő adat megadása kötelező!' });

    const stmt = db.prepare('INSERT INTO vevok (nev, cim, adoszam) VALUES (?, ?, ?)');
    try {
        const info = stmt.run(nev, cim, adoszam);
        res.json({ id: info.lastInsertRowid, nev, cim, adoszam });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Vevő módosítása
app.put('/api/vevok/:id', (req, res) => {
    const id = Number(req.params.id);
    const { nev, cim, adoszam } = req.body;
    if (!nev || !cim || !adoszam) return res.status(400).json({ error: 'Minden vevő adat megadása kötelező!' });

    const stmt = db.prepare('UPDATE vevok SET nev = ?, cim = ?, adoszam = ? WHERE id = ?');
    try {
        const info = stmt.run(nev, cim, adoszam, id);
        if (info.changes === 0) return res.status(404).json({ error: 'Vevő nem található' });
        res.json({ id, nev, cim, adoszam });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Számlák lekérdezése
app.get('/api/szamlak', (req, res) => {
    // csatlakoztatjuk a vevő és kiállító nevét is
    const szamlak = db.prepare(`
    SELECT s.*, 
        k.nev as kiallo_nev, k.cim as kiallo_cim, k.adoszam as kiallo_adoszam,
        v.nev as vevo_nev, v.cim as vevo_cim, v.adoszam as vevo_adoszam
    FROM szamlak s
    JOIN vevok k ON s.kiallo_id = k.id
    JOIN vevok v ON s.vevo_id = v.id
    ORDER BY s.id DESC
    `).all();

    res.json(szamlak);
});

// Új számla hozzáadása
app.post('/api/szamlak', (req, res) => {
    const { szamla_szam, szamla_kelte, teljesites_datum, fizetesi_hatarido, vegosszeg, afa_szazalek, kiallo_id, vevo_id } = req.body;

    // kötelező mezők ellenőrzése
    if (!szamla_szam || !szamla_kelte || !teljesites_datum || !fizetesi_hatarido || vegosszeg == null || afa_szazalek == null || !kiallo_id || !vevo_id) {
        return res.status(400).json({ error: 'Minden mezőt kötelező kitölteni!' });
    }

    // Jogszabályi ellenőrzés: fizetési határidő max szamla_kelte + 30 nap
    const szamlaDate = new Date(szamla_kelte);
    const fizHatDate = new Date(fizetesi_hatarido);
    const maxFizHatDate = new Date(szamlaDate);
    maxFizHatDate.setDate(maxFizHatDate.getDate() + 30);

    if (fizHatDate > maxFizHatDate) {
        return res.status(400).json({ error: 'A fizetési határidő nem lehet több, mint a számla kelte + 30 nap!' });
    }

    // Duplikáció ellenőrzése (azonos számlaszám ugyanazon kiállítónál)
    const exists = db.prepare('SELECT COUNT(*) as c FROM szamlak WHERE szamla_szam = ? AND kiallo_id = ?').get(szamla_szam, kiallo_id).c;
    if (exists > 0) {
        return res.status(400).json({ error: 'Ez a számla már létezik ugyanazzal a kiállítóval és számlaszámmal.' });
    }

    const stmt = db.prepare(`
        INSERT INTO szamlak (szamla_szam, szamla_kelte, teljesites_datum, fizetesi_hatarido, vegosszeg, afa_szazalek, kiallo_id, vevo_id, stornozott)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    `);

    try {
        const info = stmt.run(szamla_szam, szamla_kelte, teljesites_datum, fizetesi_hatarido, vegosszeg, afa_szazalek, kiallo_id, vevo_id);
        res.json({ id: info.lastInsertRowid, szamla_szam, szamla_kelte, teljesites_datum, fizetesi_hatarido, vegosszeg, afa_szazalek, kiallo_id, vevo_id, stornozott: 0 });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Számla stornózása (id alapján)
app.post('/api/szamlak/:id/storno', (req, res) => {
    const id = Number(req.params.id);

    // Először meg kell nézni, hogy létezik-e a számla, és még nincs-e stornózva
    const szamla = db.prepare('SELECT * FROM szamlak WHERE id = ?').get(id);
    if (!szamla) return res.status(404).json({ error: 'Számla nem található' });
    if (szamla.stornozott) return res.status(400).json({ error: 'Ez a számla már stornózva van' });

    // Frissítés: stornózás jelzése
    db.prepare('UPDATE szamlak SET stornozott = 1 WHERE id = ?').run(id);

    res.json({ message: 'Számla stornózva lett' });
});

app.listen(port, () => {
    console.log(`Számla API fut: http://localhost:${port}`);
});
