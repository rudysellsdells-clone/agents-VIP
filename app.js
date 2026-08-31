const http = require("http");

const port = process.env.PORT || 3000;

async function checkSupabase() {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    return { configured: false, connected: false };
  }

  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/`, {
      headers: {
        apikey: key
      }
    });

    return {
      configured: true,
      connected: response.ok,
      status: response.status
    };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      error: error.message
    };
  }
}

async function checkOpenAI() {
  const key = process.env.OPENAI_API_KEY;

  if (!key) {
    return { configured: false, connected: false };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: {
        Authorization: `Bearer ${key}`
      }
    });

    return {
      configured: true,
      connected: response.ok,
      status: response.status
    };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      error: error.message
    };
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  if (req.url === "/health") {
    const [supabase, openai] = await Promise.all([
      checkSupabase(),
      checkOpenAI()
    ]);

    const healthy = supabase.connected && openai.connected;

    res.writeHead(healthy ? 200 : 503);
    res.end(
      JSON.stringify(
        {
          status: healthy ? "ok" : "degraded",
          service: "VIP Prospecting Agents",
          node: {
            connected: true,
            version: process.version,
            environment: process.env.NODE_ENV || "unknown"
          },
          supabase,
          openai
        },
        null,
        2
      )
    );
    return;
  }

  res.writeHead(200);
  res.end(
    JSON.stringify(
      {
        status: "ok",
        service: "VIP Prospecting Agents",
        version: "0.1.0",
        message: "Node.js is running successfully.",
        health: "/health"
      },
      null,
      2
    )
  );
});

server.listen(port, () => {
  console.log(`VIP Prospecting Agents running on port ${port}`);
});
