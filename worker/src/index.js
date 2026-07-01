// Barney Tracker — Cloudflare Worker API
// Handles all reads/writes to D1

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function err(msg, status = 400) {
  return json({ error: msg }, status);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "");
    const method = request.method;
    const db = env.DB;

    try {
      // ── FEEDING ──────────────────────────────────────────────
      if (path === "/api/feeding" && method === "GET") {
        const { results } = await db.prepare(
          "SELECT * FROM feeding ORDER BY created_at DESC LIMIT 100"
        ).all();
        return json(results);
      }
      if (path === "/api/feeding" && method === "POST") {
        const { logged_by, amount, note } = await request.json();
        await db.prepare(
          "INSERT INTO feeding (created_at, logged_by, amount, note) VALUES (?, ?, ?, ?)"
        ).bind(new Date().toISOString(), logged_by, amount, note || null).run();
        return json({ ok: true });
      }

      // ── TOILET ───────────────────────────────────────────────
      if (path === "/api/toilet" && method === "GET") {
        const { results } = await db.prepare(
          "SELECT * FROM toilet ORDER BY created_at DESC LIMIT 200"
        ).all();
        return json(results);
      }
      if (path === "/api/toilet" && method === "POST") {
        const { logged_by, type } = await request.json();
        await db.prepare(
          "INSERT INTO toilet (created_at, logged_by, type) VALUES (?, ?, ?)"
        ).bind(new Date().toISOString(), logged_by, type).run();
        return json({ ok: true });
      }

      // ── FOOD STOCK ───────────────────────────────────────────
      if (path === "/api/food" && method === "GET") {
        const row = await db.prepare("SELECT * FROM food_stock WHERE id = 1").first();
        return json(row);
      }
      if (path === "/api/food" && method === "PUT") {
        const { pouches, alert_at, updated_by } = await request.json();
        await db.prepare(
          "UPDATE food_stock SET pouches = ?, alert_at = ?, updated_at = ?, updated_by = ? WHERE id = 1"
        ).bind(pouches, alert_at, new Date().toISOString(), updated_by).run();
        return json({ ok: true });
      }

      // ── TREATMENTS ───────────────────────────────────────────
      if (path === "/api/treatments" && method === "GET") {
        // Return latest of each type
        const flea = await db.prepare(
          "SELECT * FROM treatments WHERE type = 'flea' ORDER BY treated_at DESC LIMIT 1"
        ).first();
        const worm = await db.prepare(
          "SELECT * FROM treatments WHERE type = 'worm' ORDER BY treated_at DESC LIMIT 1"
        ).first();
        return json({ flea, worm });
      }
      if (path === "/api/treatments" && method === "POST") {
        const { type, logged_by } = await request.json();
        await db.prepare(
          "INSERT INTO treatments (type, treated_at, logged_by) VALUES (?, ?, ?)"
        ).bind(type, new Date().toISOString(), logged_by).run();
        return json({ ok: true });
      }

      // ── CALENDAR ─────────────────────────────────────────────
      if (path === "/api/calendar" && method === "GET") {
        const from = url.searchParams.get("from") || "";
        const to = url.searchParams.get("to") || "9999-12-31";
        const { results } = await db.prepare(
          "SELECT * FROM calendar_events WHERE event_date >= ? AND event_date <= ? ORDER BY event_date, start_time"
        ).bind(from, to).all();
        return json(results);
      }
      if (path === "/api/calendar" && method === "POST") {
        const { id, event_date, location_id, start_time, end_time, all_day, note, added_by } = await request.json();
        await db.prepare(
          "INSERT INTO calendar_events (id, event_date, location_id, start_time, end_time, all_day, note, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(id, event_date, location_id, start_time || null, end_time || null, all_day ? 1 : 0, note || null, added_by, new Date().toISOString()).run();
        return json({ ok: true });
      }
      if (path.startsWith("/api/calendar/") && method === "DELETE") {
        const id = path.split("/").pop();
        await db.prepare("DELETE FROM calendar_events WHERE id = ?").bind(id).run();
        return json({ ok: true });
      }

      // ── WEIGHT ───────────────────────────────────────────────
      if (path === "/api/weight" && method === "GET") {
        const { results } = await db.prepare(
          "SELECT * FROM weight ORDER BY logged_date ASC LIMIT 50"
        ).all();
        return json(results);
      }
      if (path === "/api/weight" && method === "POST") {
        const { weight_kg, logged_by } = await request.json();
        await db.prepare(
          "INSERT INTO weight (logged_date, weight_kg, logged_by) VALUES (?, ?, ?)"
        ).bind(new Date().toISOString().slice(0, 10), weight_kg, logged_by).run();
        return json({ ok: true });
      }

      // ── WALKS ────────────────────────────────────────────────
      if (path === "/api/walks" && method === "GET") {
        const { results } = await db.prepare(
          "SELECT * FROM walks ORDER BY created_at DESC LIMIT 100"
        ).all();
        return json(results);
      }
      if (path === "/api/walks" && method === "POST") {
        const { logged_by, duration_mins, distance, note } = await request.json();
        await db.prepare(
          "INSERT INTO walks (created_at, logged_by, duration_mins, distance, note) VALUES (?, ?, ?, ?, ?)"
        ).bind(new Date().toISOString(), logged_by, duration_mins, distance || null, note || null).run();
        return json({ ok: true });
      }

      // ── MEDICATIONS ──────────────────────────────────────────
      if (path === "/api/medications" && method === "GET") {
        const { results } = await db.prepare(
          "SELECT * FROM medications ORDER BY created_at DESC LIMIT 100"
        ).all();
        return json(results);
      }
      if (path === "/api/medications" && method === "POST") {
        const { logged_by, name, dose, note } = await request.json();
        await db.prepare(
          "INSERT INTO medications (created_at, logged_by, name, dose, note) VALUES (?, ?, ?, ?, ?)"
        ).bind(new Date().toISOString(), logged_by, name, dose || null, note || null).run();
        return json({ ok: true });
      }

      // ── BEHAVIOUR ────────────────────────────────────────────
      if (path === "/api/behaviour" && method === "GET") {
        const { results } = await db.prepare(
          "SELECT * FROM behaviour ORDER BY created_at DESC LIMIT 100"
        ).all();
        return json(results);
      }
      if (path === "/api/behaviour" && method === "POST") {
        const { logged_by, type, note } = await request.json();
        await db.prepare(
          "INSERT INTO behaviour (created_at, logged_by, type, note) VALUES (?, ?, ?, ?)"
        ).bind(new Date().toISOString(), logged_by, type, note || null).run();
        return json({ ok: true });
      }

      // ── VET APPOINTMENTS ─────────────────────────────────────
      if (path === "/api/vet" && method === "GET") {
        const { results } = await db.prepare(
          "SELECT * FROM vet_appointments ORDER BY appt_date DESC"
        ).all();
        return json(results);
      }
      if (path === "/api/vet" && method === "POST") {
        const { id, appt_date, reason, notes, upcoming, added_by } = await request.json();
        await db.prepare(
          "INSERT INTO vet_appointments (id, appt_date, reason, notes, upcoming, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(id, appt_date, reason, notes || null, upcoming ? 1 : 0, added_by, new Date().toISOString()).run();
        return json({ ok: true });
      }
      if (path.startsWith("/api/vet/") && method === "DELETE") {
        const id = path.split("/").pop();
        await db.prepare("DELETE FROM vet_appointments WHERE id = ?").bind(id).run();
        return json({ ok: true });
      }

      // ── INFO CARD ────────────────────────────────────────────
      if (path === "/api/info" && method === "GET") {
        const row = await db.prepare("SELECT * FROM info_card WHERE id = 1").first();
        return json(row || {});
      }
      if (path === "/api/info" && method === "PUT") {
        const { microchip, vet, vet_phone, insurance, emergency_name, emergency_phone, notes } = await request.json();
        await db.prepare(
          "UPDATE info_card SET microchip=?, vet=?, vet_phone=?, insurance=?, emergency_name=?, emergency_phone=?, notes=?, updated_at=? WHERE id=1"
        ).bind(microchip, vet, vet_phone, insurance, emergency_name, emergency_phone, notes, new Date().toISOString()).run();
        return json({ ok: true });
      }

      // ── PHOTOS ───────────────────────────────────────────────
      if (path === "/api/photos" && method === "GET") {
        const { results } = await db.prepare(
          "SELECT id, photo_date, caption, added_by, created_at FROM photos ORDER BY created_at DESC LIMIT 30"
        ).all();
        return json(results);
      }
      if (path.startsWith("/api/photos/") && method === "GET") {
        const id = path.split("/").pop();
        const row = await db.prepare("SELECT * FROM photos WHERE id = ?").bind(id).first();
        return json(row || {});
      }
      if (path === "/api/photos" && method === "POST") {
        const { id, photo_date, caption, data, added_by } = await request.json();
        await db.prepare(
          "INSERT INTO photos (id, photo_date, caption, data, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(id, photo_date, caption || null, data, added_by, new Date().toISOString()).run();
        return json({ ok: true });
      }
      if (path.startsWith("/api/photos/") && method === "DELETE") {
        const id = path.split("/").pop();
        await db.prepare("DELETE FROM photos WHERE id = ?").bind(id).run();
        return json({ ok: true });
      }

      // ── GROOMING ─────────────────────────────────────────────
      if (path === "/api/grooming" && method === "GET") {
        const { results } = await db.prepare(
          "SELECT * FROM grooming ORDER BY created_at DESC LIMIT 50"
        ).all();
        return json(results);
      }
      if (path === "/api/grooming" && method === "POST") {
        const { logged_by, type, note } = await request.json();
        await db.prepare(
          "INSERT INTO grooming (created_at, logged_by, type, note) VALUES (?, ?, ?, ?)"
        ).bind(new Date().toISOString(), logged_by, type, note || null).run();
        return json({ ok: true });
      }

      // ── TRAINING ─────────────────────────────────────────────
      if (path === "/api/training" && method === "GET") {
        const { results } = await db.prepare(
          "SELECT * FROM training ORDER BY created_at DESC LIMIT 50"
        ).all();
        return json(results);
      }
      if (path === "/api/training" && method === "POST") {
        const { logged_by, commands, rating, note } = await request.json();
        await db.prepare(
          "INSERT INTO training (created_at, logged_by, commands, rating, note) VALUES (?, ?, ?, ?, ?)"
        ).bind(new Date().toISOString(), logged_by, commands, rating, note || null).run();
        return json({ ok: true });
      }

      // ── MILESTONES ───────────────────────────────────────────
      if (path === "/api/milestones" && method === "GET") {
        const { results } = await db.prepare(
          "SELECT * FROM milestones ORDER BY milestone_date DESC"
        ).all();
        return json(results);
      }
      if (path === "/api/milestones" && method === "POST") {
        const { id, milestone_date, title, note, added_by } = await request.json();
        await db.prepare(
          "INSERT INTO milestones (id, milestone_date, title, note, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(id, milestone_date, title, note || null, added_by, new Date().toISOString()).run();
        return json({ ok: true });
      }
      if (path.startsWith("/api/milestones/") && method === "DELETE") {
        const id = path.split("/").pop();
        await db.prepare("DELETE FROM milestones WHERE id = ?").bind(id).run();
        return json({ ok: true });
      }

      // ── EXPENSES ─────────────────────────────────────────────
      if (path === "/api/expenses" && method === "GET") {
        const { results } = await db.prepare(
          "SELECT * FROM expenses ORDER BY expense_date DESC LIMIT 200"
        ).all();
        return json(results);
      }
      if (path === "/api/expenses" && method === "POST") {
        const { id, expense_date, category, amount, description, added_by } = await request.json();
        await db.prepare(
          "INSERT INTO expenses (id, expense_date, category, amount, description, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(id, expense_date, category, amount, description || null, added_by, new Date().toISOString()).run();
        return json({ ok: true });
      }
      if (path.startsWith("/api/expenses/") && method === "DELETE") {
        const id = path.split("/").pop();
        await db.prepare("DELETE FROM expenses WHERE id = ?").bind(id).run();
        return json({ ok: true });
      }

      // ── MOOD ─────────────────────────────────────────────────
      if (path === "/api/mood" && method === "GET") {
        const { results } = await db.prepare(
          "SELECT * FROM mood ORDER BY logged_date DESC LIMIT 50"
        ).all();
        return json(results);
      }
      if (path === "/api/mood" && method === "POST") {
        const { mood, logged_by, note } = await request.json();
        await db.prepare(
          "INSERT INTO mood (logged_date, mood, logged_by, note) VALUES (?, ?, ?, ?)"
        ).bind(new Date().toISOString().slice(0, 10), mood, logged_by, note || null).run();
        return json({ ok: true });
      }

      // ── ALEXA SUMMARY ENDPOINT ───────────────────────────────
      if (path === "/api/alexa/summary" && method === "GET") {
        const today = new Date().toISOString().slice(0, 10);
        const lastFeed = await db.prepare("SELECT * FROM feeding ORDER BY created_at DESC LIMIT 1").first();
        const lastWee = await db.prepare("SELECT * FROM toilet WHERE type='wee' ORDER BY created_at DESC LIMIT 1").first();
        const lastPoo = await db.prepare("SELECT * FROM toilet WHERE type='poo' ORDER BY created_at DESC LIMIT 1").first();
        const food = await db.prepare("SELECT * FROM food_stock WHERE id=1").first();
        const todayWalks = await db.prepare("SELECT SUM(duration_mins) as total FROM walks WHERE created_at LIKE ?").bind(`${today}%`).first();
        const nextVet = await db.prepare("SELECT * FROM vet_appointments WHERE upcoming=1 AND appt_date >= ? ORDER BY appt_date ASC LIMIT 1").bind(today).first();
        const flea = await db.prepare("SELECT * FROM treatments WHERE type='flea' ORDER BY treated_at DESC LIMIT 1").first();
        const worm = await db.prepare("SELECT * FROM treatments WHERE type='worm' ORDER BY treated_at DESC LIMIT 1").first();
        return json({ lastFeed, lastWee, lastPoo, food, todayWalkMins: todayWalks?.total || 0, nextVet, flea, worm });
      }

      return err("Not found", 404);
    } catch (e) {
      console.error(e);
      return err("Server error: " + e.message, 500);
    }
  }
};
