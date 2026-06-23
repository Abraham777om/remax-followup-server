const express = require("express");
const path = require("path");

const Redis = require("ioredis");
const cron = require("node-cron");
const axios = require("axios");

const indexRouter = require("./routes/index");

const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use(express.static(path.join(__dirname, "public")));

app.use("/", indexRouter);

const redis = new Redis(process.env.REDIS_URL);

const THIRTY_MIN = 30 * 60 * 1000;

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

    const existingRaw = await redis.get(key);
    const existing = existingRaw ? JSON.parse(existingRaw) : null;

    const incomingTime = Number(last_message_at || Date.now());
    const existingTime = Number(existing?.last_message_at || 0);

    if (existing && incomingTime < existingTime) {
      return res.json({
        ok: true,
        ignored: true,
        reason: "older_event",
        key,
        existing,
        received: req.body
      });
    };

    const data = {
      entity_id,

      contact_id:
        contact_id || existing?.contact_id || null,

      property_id:
        property_id || existing?.property_id || null,

      last_role,

      last_message_at: incomingTime,

      followup_enabled:
        followup_enabled ?? existing?.followup_enabled ?? true,

      followup_reason:
        followup_reason || existing?.followup_reason || null,

      followup_sent: false,

      followup_message:
        followup_message ||
        existing?.followup_message ||
        "Hola, ¿cómo puedo ayudarle? ¿La propiedad sigue siendo de su interés o hay alguna duda que pueda ayudarle a resolver?"
    };

    await redis.set(
      key,
      JSON.stringify(data),
      "EX",
      60 * 60 * 24
    );

    res.json({
      ok: true,
      key,
      received: req.body,
      data
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
      
      const kommoResponse = await axios.post(
        `${process.env.KOMMO_BASE_URL}/api/v2/salesbot/run`,
        [
          {
            bot_id: Number(process.env.FOLLOWUP_BOT_ID),
            entity_id: Number(data.entity_id),
            entity_type: 2
          }
        ],
        {
          headers: {
            accept: "application/json",
            authorization: `Bearer ${process.env.KOMMO_TOKEN}`
          }
        }
      );
      
      console.log(
        "KOMMO FOLLOWUP OK:",
        kommoResponse.data
      );
      
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
