const express = require("express");
const path = require("path");

const Redis = require("ioredis");
const cron = require("node-cron");

const indexRouter = require("./routes/index");

const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use(express.static(path.join(__dirname, "public")));

app.use("/", indexRouter);

const redis = new Redis(process.env.REDIS_URL);

const THIRTY_MIN = 60 * 1000;

/*
|--------------------------------------------------------------------------
| REGISTRAR ACTIVIDAD
|--------------------------------------------------------------------------
*/

app.post("/followup/activity", async (req, res) => {

  try {

    const {
      entity_id,
      contact_id,
      property_id,
      last_role,
      last_message_at,
      followup_enabled,
      followup_reason,
      followup_message
    } = req.body;

    if (!entity_id) {

      return res.status(400).json({
        ok: false,
        error: "entity_id requerido"
      });

    }

    const key = `followup:${entity_id}`;

    const data = {

      entity_id,

      contact_id:
        contact_id || null,

      property_id:
        property_id || null,

      last_role,

      last_message_at:
        Number(last_message_at || Date.now()),

      followup_enabled:
        followup_enabled ?? true,

      followup_reason:
        followup_reason || null,

      followup_sent: false,

      followup_message:
        followup_message ||
        "Hola, solo quería darle seguimiento. ¿La propiedad sigue siendo de su interés?"
    };

    await redis.set(
      key,
      JSON.stringify(data),
      "EX",
      60 * 60 * 24
    );

    res.json({
      ok: true
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      ok: false,
      error: error.message
    });

  }

});

/*
|--------------------------------------------------------------------------
| TEST REDIS
|--------------------------------------------------------------------------
*/

app.get("/followup/test", async (req, res) => {

  try {

    const keys =
      await redis.keys("followup:*");

    const result = [];

    for (const key of keys) {

      const value =
        await redis.get(key);

      result.push({
        key,
        value: JSON.parse(value)
      });

    }

    res.json(result);

  } catch (error) {

    res.status(500).json({
      ok: false,
      error: error.message
    });

  }

});

/*
|--------------------------------------------------------------------------
| FOLLOWUP AUTOMATICO
|--------------------------------------------------------------------------
*/

cron.schedule("* * * * *", async () => {

  try {

    const keys =
      await redis.keys("followup:*");

    const now = Date.now();

    for (const key of keys) {

      const raw =
        await redis.get(key);

      if (!raw) continue;

      const data =
        JSON.parse(raw);

      if (data.followup_sent)
        continue;

      if (data.followup_enabled === false)
        continue;

      if (data.last_role !== "agent")
        continue;

      const diff =
        now -
        Number(data.last_message_at);

      if (diff < THIRTY_MIN)
        continue;

      console.log(
        "FOLLOWUP:",
        data.entity_id
      );

      /*
       * AQUÍ DESPUÉS
       * LLAMAREMOS A N8N O KOMMO
       */

      data.followup_sent = true;

      data.followup_sent_at = now;

      await redis.set(
        key,
        JSON.stringify(data),
        "EX",
        60 * 60 * 24
      );

    }

  } catch (error) {

    console.error(
      "Followup error:",
      error
    );

  }

});

/*
|--------------------------------------------------------------------------
| 404
|--------------------------------------------------------------------------
*/

app.use((req, res) => {

  res.status(404).json({
    ok: false,
    error: "Route not found"
  });

});

app.listen(PORT, () => {

  console.log(
    `Server running on port ${PORT}`
  );

});
