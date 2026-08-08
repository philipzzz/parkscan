import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

DB_PATH = Path(__file__).parent / "parking.db"


def get_conn():
    # timeout: wait for a writer instead of raising "database is locked" when
    # several officers issue compounds at the same moment
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    # WAL lets readers (status checks) run while a writer commits
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=10000")
    return conn


def init_db():
    conn = get_conn()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS zones (
            id TEXT PRIMARY KEY,
            council TEXT NOT NULL,
            name TEXT NOT NULL,
            rate_per_hour REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS officers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plate TEXT NOT NULL,
            zone_id TEXT NOT NULL,
            paid_until TEXT NOT NULL,
            amount REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        CREATE TABLE IF NOT EXISTS vehicles (
            plate TEXT PRIMARY KEY,
            make_model TEXT,
            color TEXT,
            road_tax_expiry TEXT,
            insurance_expiry TEXT,
            summons_count INTEGER DEFAULT 0,
            stolen INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS compounds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plate TEXT NOT NULL,
            zone_id TEXT NOT NULL,
            officer_id TEXT NOT NULL,
            lat REAL,
            lng REAL,
            photo_path TEXT,
            ocr_confidence REAL,
            status TEXT NOT NULL DEFAULT 'issued',
            created_at TEXT NOT NULL
        );
        """
    )
    conn.commit()

    # Idempotent migrations for existing databases
    for stmt in (
        "ALTER TABLE zones ADD COLUMN lat REAL",
        "ALTER TABLE zones ADD COLUMN lng REAL",
        "ALTER TABLE payments ADD COLUMN lat REAL",
        "ALTER TABLE payments ADD COLUMN lng REAL",
        "ALTER TABLE payments ADD COLUMN photo_path TEXT",
        "ALTER TABLE payments ADD COLUMN created_at TEXT",
    ):
        try:
            conn.execute(stmt)
        except sqlite3.OperationalError:
            pass  # column already exists

    zone_coords = {
        "MBJB-A1": (1.4589, 103.7641),
        "MBJB-A2": (1.4574, 103.7629),
        "MBPP-B1": (5.4145, 100.3368),
    }
    for zone_id, (lat, lng) in zone_coords.items():
        conn.execute(
            "UPDATE zones SET lat = ?, lng = ? WHERE id = ? AND lat IS NULL",
            (lat, lng, zone_id),
        )
    conn.commit()

    # Seed only once
    if conn.execute("SELECT COUNT(*) FROM zones").fetchone()[0] == 0:
        conn.executemany(
            "INSERT INTO zones (id, council, name, rate_per_hour, lat, lng) VALUES (?,?,?,?,?,?)",
            [
                ("MBJB-A1", "MBJB Johor Bahru", "Jalan Wong Ah Fook", 0.60, 1.4589, 103.7641),
                ("MBJB-A2", "MBJB Johor Bahru", "Jalan Dhoby", 0.60, 1.4574, 103.7629),
                ("MBPP-B1", "MBPP Pulau Pinang", "Lebuh Armenian", 0.80, 5.4145, 100.3368),
            ],
        )
        conn.executemany(
            "INSERT INTO officers VALUES (?,?)",
            [("OFC-001", "Ahmad bin Ali"), ("OFC-002", "Tan Mei Ling")],
        )
        now = datetime.now()
        conn.executemany(
            "INSERT INTO payments (plate, zone_id, paid_until, amount) VALUES (?,?,?,?)",
            [
                # Green demo car: paid for another hour
                ("WVX2345", "MBJB-A1", (now + timedelta(hours=1)).isoformat(), 1.20),
                # Yellow demo car: expired 12 minutes ago
                ("JQA8123", "MBJB-A1", (now - timedelta(minutes=12)).isoformat(), 0.60),
            ],
        )
        conn.commit()

    # Mock JPJ vehicle registry (demo data for the police roadblock mode)
    if conn.execute("SELECT COUNT(*) FROM vehicles").fetchone()[0] == 0:
        now = datetime.now()
        conn.executemany(
            """INSERT INTO vehicles
               (plate, make_model, color, road_tax_expiry, insurance_expiry, summons_count, stolen)
               VALUES (?,?,?,?,?,?,?)""",
            [
                # Clean vehicle
                ("WVX2345", "Perodua Myvi 1.5 AV", "Silver",
                 (now + timedelta(days=246)).date().isoformat(),
                 (now + timedelta(days=246)).date().isoformat(), 0, 0),
                # Road tax + insurance expired, outstanding summons
                ("JQA8123", "Proton Saga 1.3 Premium", "Red",
                 (now - timedelta(days=94)).date().isoformat(),
                 (now - timedelta(days=94)).date().isoformat(), 3, 0),
                # Flagged stolen
                ("VBS7088", "Honda Civic 1.5 TC-P", "Black",
                 (now + timedelta(days=120)).date().isoformat(),
                 (now + timedelta(days=120)).date().isoformat(), 0, 1),
            ],
        )
        conn.commit()
    conn.close()
